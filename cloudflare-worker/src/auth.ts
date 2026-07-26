/**
 * Server-side authentication & authorization for the POS Worker.
 *
 * Design (see PR description for the full rationale):
 *  • Login is verified HERE, against the auth_users table in D1 — never in the
 *    browser. The browser only ever holds a short-lived, HMAC-signed session
 *    token scoped to the user's role.
 *  • The token is signed (integrity) AND checked against D1 on every request:
 *    the user must still exist and the token's iat must be >= the user's
 *    min_valid_iat. Bumping min_valid_iat (on password change / logout-all)
 *    revokes outstanding tokens INSTANTLY. The role is read from D1, so a
 *    tampered/forged role claim is meaningless.
 *  • Authorization is enforced per (table, method) AND, for orders, per FIELD —
 *    because a refund / void / delete is just an UPDATE on the order row, so a
 *    table/method check alone cannot tell "cashier completing a sale" apart from
 *    "cashier issuing a refund".
 */

export type Role = "manager" | "admin";

export interface AuthEnv {
  DB: D1Database;
  API_KEY?: string;
  AUTH_TOKEN_SECRET?: string;
  BOOTSTRAP_SECRET?: string;
  // When "true", the legacy shared API_KEY is no longer accepted — session
  // tokens are the ONLY way in. Flip this once every device has migrated.
  REQUIRE_SESSION_ONLY?: string;
}

export interface Session {
  username: string;
  role: Role;
  mustChange: boolean;
  /** True when authenticated via the legacy shared API_KEY (full access). */
  legacy?: boolean;
}

interface AuthUserRow {
  username: string;
  role: string;
  pass_hash: string;
  pass_salt: string;
  iterations: number;
  must_change: number;
  min_valid_iat: number;
}

// ─── Token / hashing parameters ────────────────────────────────────────────────
const TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8h — covers a shift; client refreshes silently
const PBKDF2_ITERATIONS = 210_000; // login is rare, so a high work factor is cheap
const RATE_LIMIT_MAX = 10; // failed attempts per window per (ip, username)
const RATE_LIMIT_WINDOW = 15 * 60; // seconds

// ─── Settings key classification (single source of truth for settings authz) ────
// Operational config a cashier device MUST be able to READ (tax rate drives every
// order total; store/branch config drive the printed receipt; tables/language/menu
// categories drive the POS UI). Writable by manager only.
const OPERATIONAL_SETTING_KEYS = new Set<string>([
  "brewmaster_tax_rate",
  "brewmaster_store_config",
  "brewmaster_branch_config",
  "brewmaster_language",
  "pos_tables_list",
  "removed_menu_categories",
  "custom_menu_categories",
]);

// Secrets: manager-only for BOTH read and write. (Credentials should be gone
// after the v10 cutover cleanup; telegram tokens ideally move to Worker secrets.)
const SECRET_SETTING_KEYS = new Set<string>([
  "brewmaster_admin_creds_v2",
  "brewmaster_manager_creds_v1",
  "brewmaster_admin_pin",
  "brewmaster_telegram_config",
  "brewmaster_telegram_bot_token",
  "brewmaster_telegram_chat_id",
]);

export function isSecretSettingKey(key: string | undefined | null): boolean {
  if (!key) return false;
  // Anything not on the operational allowlist is treated as secret (fail-safe):
  // an unknown/new key is hidden from cashiers until explicitly classified.
  return SECRET_SETTING_KEYS.has(key) || !OPERATIONAL_SETTING_KEYS.has(key);
}

// ─── Low-level encoding helpers ────────────────────────────────────────────────
const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 ? "0" + hex : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Constant-time string comparison for equal-length hex digests. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ─── PBKDF2 password hashing ───────────────────────────────────────────────────
async function pbkdf2Hex(password: string, saltHex: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex) as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bytesToHex(salt);
  const hash = await pbkdf2Hex(password, saltHex, PBKDF2_ITERATIONS);
  return { hash, salt: saltHex, iterations: PBKDF2_ITERATIONS };
}

async function verifyPassword(password: string, row: AuthUserRow): Promise<boolean> {
  const computed = await pbkdf2Hex(password, row.pass_salt, Number(row.iterations) || PBKDF2_ITERATIONS);
  return timingSafeEqual(computed, row.pass_hash);
}

// ─── HMAC-signed tokens ────────────────────────────────────────────────────────
interface TokenPayload {
  sub: string; // username
  role: Role; // advisory only — the D1 role is authoritative on verify
  iat: number; // issued-at (unix seconds)
  exp: number; // expiry (unix seconds)
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function signToken(payload: TokenPayload, secret: string): Promise<string> {
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  return `${payloadB64}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Verify signature (constant-time via subtle.verify) and return the payload. */
async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  let sigBytes: Uint8Array;
  try {
    sigBytes = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes as BufferSource, enc.encode(payloadB64));
  if (!ok) return null;
  try {
    return JSON.parse(dec.decode(b64urlDecode(payloadB64))) as TokenPayload;
  } catch {
    return null;
  }
}

// ─── D1 access ─────────────────────────────────────────────────────────────────
async function getAuthUser(env: AuthEnv, username: string): Promise<AuthUserRow | null> {
  const row = await env.DB.prepare(
    "SELECT username, role, pass_hash, pass_salt, iterations, must_change, min_valid_iat FROM auth_users WHERE username = ?"
  )
    .bind(username)
    .first();
  return (row as unknown as AuthUserRow) || null;
}

async function countAuthUsers(env: AuthEnv): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_users").first();
  return Number((row as any)?.n || 0);
}

// ─── Rate limiting (D1-backed) ─────────────────────────────────────────────────
async function isRateLimited(env: AuthEnv, key: string): Promise<{ limited: boolean; retryAfter: number }> {
  const now = Math.floor(Date.now() / 1000);
  const row = (await env.DB.prepare(
    "SELECT count, window_start FROM login_attempts WHERE attempt_key = ?"
  )
    .bind(key)
    .first()) as any;
  if (!row) return { limited: false, retryAfter: 0 };
  const windowStart = Number(row.window_start) || 0;
  if (now - windowStart >= RATE_LIMIT_WINDOW) return { limited: false, retryAfter: 0 };
  if (Number(row.count) >= RATE_LIMIT_MAX) {
    return { limited: true, retryAfter: RATE_LIMIT_WINDOW - (now - windowStart) };
  }
  return { limited: false, retryAfter: 0 };
}

async function recordFailedAttempt(env: AuthEnv, key: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const row = (await env.DB.prepare(
    "SELECT count, window_start FROM login_attempts WHERE attempt_key = ?"
  )
    .bind(key)
    .first()) as any;
  if (!row || now - (Number(row.window_start) || 0) >= RATE_LIMIT_WINDOW) {
    await env.DB.prepare(
      "INSERT INTO login_attempts (attempt_key, count, window_start) VALUES (?1, 1, ?2) " +
        "ON CONFLICT(attempt_key) DO UPDATE SET count = 1, window_start = ?2"
    )
      .bind(key, now)
      .run();
  } else {
    await env.DB.prepare("UPDATE login_attempts SET count = count + 1 WHERE attempt_key = ?")
      .bind(key)
      .run();
  }
}

async function clearAttempts(env: AuthEnv, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").bind(key).run();
}

// ─── Response helper ───────────────────────────────────────────────────────────
function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

// ─── Public: authenticate an incoming request ──────────────────────────────────
/**
 * Resolve the caller's session from either a session token (preferred) or, during
 * the migration window, the legacy shared API_KEY. Returns null when neither is
 * valid — the caller should then return 401.
 */
export async function authenticate(request: Request, env: AuthEnv): Promise<Session | null> {
  const authHeader = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("X-API-Key");
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : apiKeyHeader || "";
  if (!token) return null;

  // Session-token path (a signed token always contains a '.').
  if (env.AUTH_TOKEN_SECRET && token.includes(".")) {
    const payload = await verifyToken(token, env.AUTH_TOKEN_SECRET);
    if (payload && payload.sub && typeof payload.exp === "number") {
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp > now) {
        const user = await getAuthUser(env, String(payload.sub));
        if (user && Number(payload.iat || 0) >= Number(user.min_valid_iat || 0)) {
          return {
            username: user.username,
            role: (user.role as Role) || "admin",
            mustChange: !!user.must_change,
          };
        }
      }
    }
    // fall through — not a valid session token
  }

  // Legacy shared-key path (full access) — only until REQUIRE_SESSION_ONLY.
  if (env.REQUIRE_SESSION_ONLY !== "true" && env.API_KEY && token === env.API_KEY) {
    return { username: "legacy", role: "manager", mustChange: false, legacy: true };
  }

  return null;
}

// ─── Public: /auth/* route handling ────────────────────────────────────────────
/**
 * Handle the unauthenticated-by-default auth endpoints. Returns a Response when
 * the path is an /auth/* route, or null to let the caller continue normal routing.
 * Must be invoked BEFORE the main auth gate.
 */
export async function handleAuthRoutes(
  request: Request,
  env: AuthEnv,
  cors: Record<string, string>
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (path !== "/auth/login" && path !== "/auth/change-password" && path !== "/auth/bootstrap" && path !== "/auth/me") {
    return null;
  }

  if (path === "/auth/me") {
    if (request.method !== "GET") return json(405, { error: "Method Not Allowed" }, cors);
    const session = await authenticate(request, env);
    if (!session) return json(401, { error: "Unauthorized" }, cors);
    return json(200, { username: session.username, role: session.role, mustChange: session.mustChange }, cors);
  }

  if (request.method !== "POST") return json(405, { error: "Method Not Allowed" }, cors);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Bad Request", message: "Invalid JSON body" }, cors);
  }

  if (path === "/auth/login") return handleLogin(request, env, cors, body);
  if (path === "/auth/change-password") return handleChangePassword(request, env, cors, body);
  if (path === "/auth/bootstrap") return handleBootstrap(request, env, cors, body);
  return json(404, { error: "Not Found" }, cors);
}

async function handleLogin(
  request: Request,
  env: AuthEnv,
  cors: Record<string, string>,
  body: any
): Promise<Response> {
  if (!env.AUTH_TOKEN_SECRET) {
    return json(503, { error: "Service Unavailable", message: "Auth is not configured on the server." }, cors);
  }
  // The client sends the username it wants to sign in as ('manager' | 'admin').
  // We accept `role` as a legacy alias, but the authoritative role always comes
  // from the D1 row — the client cannot self-assign privileges.
  const username = String(body.username || body.role || "").trim();
  const password = String(body.password || "");
  if (!username || !password) {
    return json(400, { error: "Bad Request", message: "username and password are required" }, cors);
  }

  const rlKey = `${clientIp(request)}:${username}`;
  const rl = await isRateLimited(env, rlKey);
  if (rl.limited) {
    return json(
      429,
      { error: "Too Many Requests", message: "Too many attempts. Try again later." },
      { ...cors, "Retry-After": String(rl.retryAfter) }
    );
  }

  const user = await getAuthUser(env, username);
  const ok = user ? await verifyPassword(password, user) : false;
  if (!user || !ok) {
    await recordFailedAttempt(env, rlKey);
    // Generic message — never reveal whether the username exists.
    return json(401, { error: "Unauthorized", message: "Invalid credentials" }, cors);
  }

  await clearAttempts(env, rlKey);
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: user.username,
    role: (user.role as Role) || "admin",
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const token = await signToken(payload, env.AUTH_TOKEN_SECRET);
  return json(
    200,
    { token, role: payload.role, mustChange: !!user.must_change, exp: payload.exp },
    cors
  );
}

async function handleChangePassword(
  request: Request,
  env: AuthEnv,
  cors: Record<string, string>,
  body: any
): Promise<Response> {
  if (!env.AUTH_TOKEN_SECRET) {
    return json(503, { error: "Service Unavailable", message: "Auth is not configured on the server." }, cors);
  }
  const session = await authenticate(request, env);
  if (!session || session.legacy) {
    return json(401, { error: "Unauthorized", message: "A valid session is required" }, cors);
  }
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (newPassword.length < 6) {
    return json(400, { error: "Bad Request", message: "New password must be at least 6 characters" }, cors);
  }
  const user = await getAuthUser(env, session.username);
  if (!user || !(await verifyPassword(currentPassword, user))) {
    return json(401, { error: "Unauthorized", message: "Current password is incorrect" }, cors);
  }

  const { hash, salt, iterations } = await hashPassword(newPassword);
  const now = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();
  // Bump min_valid_iat to `now` so EVERY previously-issued token is revoked...
  await env.DB.prepare(
    "UPDATE auth_users SET pass_hash = ?, pass_salt = ?, iterations = ?, must_change = 0, min_valid_iat = ?, updated_at = ? WHERE username = ?"
  )
    .bind(hash, salt, iterations, now, nowIso, user.username)
    .run();

  // ...then mint a fresh token (iat = now) so the CURRENT device stays signed in
  // while all other sessions are invalidated.
  const payload: TokenPayload = {
    sub: user.username,
    role: (user.role as Role) || "admin",
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const token = await signToken(payload, env.AUTH_TOKEN_SECRET);
  return json(200, { ok: true, token, role: payload.role, exp: payload.exp }, cors);
}

async function handleBootstrap(
  request: Request,
  env: AuthEnv,
  cors: Record<string, string>,
  body: any
): Promise<Response> {
  // Gated behind a dedicated secret (NOT the API key) so there is no public race
  // window. Doubles as the account-recovery path if an operator is locked out.
  if (!env.BOOTSTRAP_SECRET) {
    return json(503, { error: "Service Unavailable", message: "Bootstrap is not enabled." }, cors);
  }
  const provided = request.headers.get("X-Bootstrap-Secret") || "";
  if (provided !== env.BOOTSTRAP_SECRET) {
    return json(403, { error: "Forbidden", message: "Invalid bootstrap secret" }, cors);
  }

  const users: Array<{ username?: string; role?: string; password?: string; mustChange?: boolean }> = Array.isArray(
    body.users
  )
    ? body.users
    : [];
  if (users.length === 0) {
    return json(400, { error: "Bad Request", message: "Provide a non-empty users[] array" }, cors);
  }

  const now = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();
  const created: string[] = [];
  for (const u of users) {
    const username = String(u.username || "").trim();
    const role: Role = u.role === "manager" ? "manager" : "admin";
    const password = String(u.password || "");
    if (!username || password.length < 6) continue;
    const { hash, salt, iterations } = await hashPassword(password);
    await env.DB.prepare(
      "INSERT INTO auth_users (username, role, pass_hash, pass_salt, iterations, must_change, min_valid_iat, created_at, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) " +
        "ON CONFLICT(username) DO UPDATE SET role = ?2, pass_hash = ?3, pass_salt = ?4, iterations = ?5, must_change = ?6, min_valid_iat = ?7, updated_at = ?8"
    )
      .bind(username, role, hash, salt, iterations, u.mustChange ? 1 : 0, now, nowIso)
      .run();
    created.push(username);
  }

  return json(200, { ok: true, created, totalUsers: await countAuthUsers(env) }, cors);
}

// ─── Public: authorization for data routes ─────────────────────────────────────
export interface AuthzResult {
  ok: boolean;
  status?: number;
  message?: string;
}

/**
 * Decide whether `session` may perform `method`/`action` on `table` with `data`.
 * `data` is the RAW client payload (camelCase), so field-level order checks see
 * paymentStatus / refundedAt / deletedAt as the client sent them.
 */
export async function assertAuthorized(
  session: Session,
  table: string,
  method: string,
  action: string,
  data: any,
  env: AuthEnv
): Promise<AuthzResult> {
  // Legacy shared-key callers and managers have full access.
  if (session.legacy || session.role === "manager") return { ok: true };

  // ── Cashier (admin) ──────────────────────────────────────────────────────────
  const isDelete = method === "DELETE" || action === "delete";
  if (isDelete) {
    return { ok: false, status: 403, message: "Cashiers cannot delete records" };
  }

  // Manager-only writable tables.
  const MANAGER_ONLY_WRITE = new Set(["menu_items", "inventory", "recipes", "snapshots", "settings"]);
  if (MANAGER_ONLY_WRITE.has(table)) {
    return { ok: false, status: 403, message: `Cashiers cannot modify ${table}` };
  }

  if (table === "orders") {
    return assertOrderWriteAllowed(data, env);
  }

  // Cashiers may create/update customers & companies (needed for on-account sales).
  if (table === "customers" || table === "companies") {
    return { ok: true };
  }

  return { ok: false, status: 403, message: `Cashiers cannot modify ${table}` };
}

/**
 * Field-level guard for cashier order writes. A refund / void / delete is just an
 * UPDATE on the order, so we inspect the payload (and the existing row) rather
 * than trusting method/table alone.
 */
async function assertOrderWriteAllowed(data: any, env: AuthEnv): Promise<AuthzResult> {
  const d = data || {};
  const incomingStatus = d.paymentStatus ?? d.payment_status;
  const refundedAt = d.refundedAt ?? d.refunded_at;
  const deletedAt = d.deletedAt ?? d.deleted_at;

  // Refund / void / soft-delete are manager-only regardless of the row's state.
  // These are pure field checks (no lookup) so they can never be bypassed and
  // never interfere with a normal sale.
  if (incomingStatus === "Refunded" || (refundedAt != null && refundedAt !== "")) {
    return { ok: false, status: 403, message: "Refund/void is manager-only" };
  }
  if (deletedAt != null && deletedAt !== "") {
    return { ok: false, status: 403, message: "Deleting an order is manager-only" };
  }

  // A cashier may COMPLETE an unpaid order (…→ Paid/OnAccount) and may re-sync an
  // already-paid order idempotently, but may NOT flip the payment status of a
  // settled order away from Paid (that path is refund/void). We only pay for the
  // existing-row lookup when the payload actually carries a *non-Paid* status —
  // so the common create / complete-payment / retry paths stay a single write and
  // an idempotent re-push of a Paid order (status === "Paid") never 403s.
  const id = d.id || d.documentId;
  if (id && incomingStatus && incomingStatus !== "Paid") {
    try {
      const existing = (await env.DB.prepare("SELECT paymentStatus FROM orders WHERE id = ?")
        .bind(id)
        .first()) as any;
      if (existing && existing.paymentStatus === "Paid") {
        return { ok: false, status: 403, message: "Only a manager can change a settled order" };
      }
    } catch {
      // Transient lookup failure must not block a legitimate sale.
    }
  }
  return { ok: true };
}

/**
 * Drop secret settings rows for non-managers. Cashiers keep operational config
 * (tax, store/branch, tables, language, menu categories) so their receipts and
 * totals stay correct, but never see credentials / telegram tokens.
 */
export function filterSettingsForRole(role: Role, documents: any[]): any[] {
  if (role === "manager") return documents;
  return (documents || []).filter((doc) => !isSecretSettingKey(doc?.key));
}
