/**
 * Role-bearing, credential-gated session authentication for the POS Worker.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * The previous cookie-session design (fix/cookie-session-backup) minted an
 * HttpOnly cookie at `POST /v1/session` with NO credentials at all — the comment
 * even called it an "anonymous device session". Combined with a SESSION_SECRET
 * committed to wrangler.toml, that meant anyone who could reach the Worker could
 * POST /v1/session and walk away with a full-access cookie. That is strictly
 * worse than the old "no key = no access" posture.
 *
 * A parallel branch (fix/server-side-authorization) derived a ROLE from which
 * API key was presented and enforced field-level rules in permissions.ts — but
 * it had no session layer, so the two were never wired together and the role
 * never reached the cookie. permissions.ts was dead code.
 *
 * THIS FILE UNIFIES THE TWO:
 *   1. Minting a session REQUIRES a credential. No credential ⇒ 401. There is
 *      no anonymous path anymore.
 *   2. The credential resolves to a ROLE ("manager" | "cashier"), which is baked
 *      into the HMAC-signed cookie. The client can never declare its own role;
 *      forging a role means forging the signature, which needs SESSION_SECRET.
 *   3. If SESSION_SECRET is not configured the Worker fails CLOSED (503) — it
 *      never falls back to a hardcoded default.
 *
 * CREDENTIALS ACCEPTED AT MINT (in order):
 *   a. A role-scoped API key (Authorization: Bearer / X-API-Key), matched by
 *      resolveKeyRole against MANAGER_API_KEY / CASHIER_API_KEY / legacy API_KEY.
 *      This serves headless clients and the documented two-key deploy model.
 *   b. The operator's POS login password (JSON body { password }), verified in
 *      the Worker against the PBKDF2 credential hashes already stored in D1
 *      `settings` (brewmaster_manager_creds_v1 ⇒ manager,
 *      brewmaster_admin_creds_v2 ⇒ cashier). This is what the browser POS uses:
 *      the manager/cashier password the operator already sets becomes the mint
 *      credential, so there is no new key to distribute.
 *
 * The password is verified, never stored, by the Worker. The role lives only in
 * the signed cookie.
 */

export type Role = "manager" | "cashier";

export interface AuthEnv {
  DB: D1Database;
  /** Legacy shared key. Still honored (⇒ manager) IF set, so a half-migrated
   *  fleet keeps working during rollout; delete it once real roles are live. */
  API_KEY?: string;
  /** Role-scoped keys for headless callers / the documented deploy model. */
  MANAGER_API_KEY?: string;
  CASHIER_API_KEY?: string;
  /** HMAC signing secret for session cookies. REQUIRED — no default. */
  SESSION_SECRET?: string;
  /** Legacy alias for SESSION_SECRET (older deploys used this name). */
  AUTH_TOKEN_SECRET?: string;
}

/** Session cookie name. Plain (not __Host-) so it works on http localhost dev too. */
export const SESSION_COOKIE = "pos_session";

/** Header carrying the double-submit CSRF token (see csrfTokenFor / verifyCsrf). */
export const CSRF_HEADER = "X-CSRF-Token";

/** 12h — comfortably covers a shift; the client re-mints silently when it lapses. */
const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** D1 settings keys holding the PBKDF2 credential records (see settingsConfig.ts). */
const MANAGER_CREDS_KEY = "brewmaster_manager_creds_v1";
const CASHIER_CREDS_KEY = "brewmaster_admin_creds_v2";

/** Mirror of the client KDF (settingsConfig.hashPassword). MUST stay in sync. */
const PBKDF2_ITERATIONS = 100000;

/**
 * Resolve the signing secret. Returns null when nothing is configured, which the
 * caller MUST treat as fail-closed (503). There is deliberately no built-in
 * default: a known default is a forgeable secret.
 * Precedence: SESSION_SECRET → AUTH_TOKEN_SECRET.
 */
function sessionSecret(env: AuthEnv): string | null {
  return env.SESSION_SECRET || env.AUTH_TOKEN_SECRET || null;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Constant-time string comparison. Workers have no crypto.timingSafeEqual, so
 * this compares every byte of the longer string to avoid leaking length/prefix
 * through response timing.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ─── Encoding helpers ──────────────────────────────────────────────────────────
const enc = new TextEncoder();
const dec = new TextDecoder();

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

function bytesToHex(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += b.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ─── HMAC-signed tokens ──────────────────────────────────────────────────────
interface SessionPayload {
  /** issued-at (unix seconds) */
  iat: number;
  /** expiry (unix seconds) */
  exp: number;
  /** payload version, for forward-compat */
  v: number;
  /** authenticated role — the whole point of the rework */
  role: Role;
  /** random session id; anchors the CSRF double-submit token (see csrfTokenFor) */
  sid: string;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Produce `payloadB64.sigB64`. */
async function signPayload(payload: SessionPayload, secret: string): Promise<string> {
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  return `${payloadB64}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Verify signature (constant-time via subtle.verify) and return the payload. */
async function verifyPayload(token: string, secret: string): Promise<SessionPayload | null> {
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
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", key, sigBytes as BufferSource, enc.encode(payloadB64));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    return JSON.parse(dec.decode(b64urlDecode(payloadB64))) as SessionPayload;
  } catch {
    return null;
  }
}

/** Cryptographically-random session id. */
function newSid(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Deterministic CSRF token for a session, = HMAC(secret, "csrf:" + sid). Returned
 * to the client at mint (readable, unlike the HttpOnly cookie) and echoed back in
 * the X-CSRF-Token header on writes. An attacker on another origin cannot read
 * the mint response (CORS) and cannot recompute this without SESSION_SECRET, so
 * they cannot forge the header — this is the "double submit" half of the CSRF
 * defense (the strict Origin allowlist in index.ts is the other half).
 */
export async function csrfTokenFor(sid: string, env: AuthEnv): Promise<string | null> {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`csrf:${sid}`));
  return b64urlEncode(new Uint8Array(sig));
}

/** Mint a fresh signed session token for a resolved role. */
export async function mintSessionToken(
  env: AuthEnv,
  role: Role
): Promise<{ token: string; exp: number; sid: string } | null> {
  const secret = sessionSecret(env);
  if (!secret) return null; // fail-closed: caller returns 503
  const iat = nowSec();
  const exp = iat + SESSION_TTL_SECONDS;
  const sid = newSid();
  const token = await signPayload({ iat, exp, v: 2, role, sid }, secret);
  return { token, exp, sid };
}

/** Verify a session token: signature valid AND not expired. Returns payload. */
export async function verifySessionToken(
  token: string,
  env: AuthEnv
): Promise<SessionPayload | null> {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const payload = await verifyPayload(token, secret);
  if (!payload || typeof payload.exp !== "number") return null;
  if (payload.exp <= nowSec()) return null;
  if (payload.role !== "manager" && payload.role !== "cashier") return null;
  return payload;
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────
function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function readSessionCookie(request: Request): string | null {
  const cookies = parseCookies(request.headers.get("Cookie"));
  return cookies[SESSION_COOKIE] || null;
}

/**
 * Build the Set-Cookie for a minted session.
 * SameSite=None; Secure is mandatory: the POS (pos.engaz.tech) and the Worker
 * (api.engaz.tech / *.workers.dev) are different origins, so a Lax cookie would
 * never ride the cross-origin XHRs. HttpOnly keeps it out of JS (no XSS
 * exfiltration). Path=/ so every route sees it. Because SameSite=None ships the
 * cookie on cross-site requests, CSRF is closed separately (see index.ts: strict
 * Origin allowlist + double-submit token).
 */
export function buildSetCookie(token: string, maxAge: number = SESSION_TTL_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
}

/** Build the Set-Cookie that clears the session (logout). */
export function buildClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`;
}

// ─── Credential → role resolution ────────────────────────────────────────────
/**
 * Resolve a role from a presented API key. Returns null when nothing matches —
 * there is no default role. Manager is checked first so that a misconfiguration
 * setting both keys the same is at least deterministic. The legacy shared
 * API_KEY maps to manager so live tills keep working during rollout.
 */
export function resolveKeyRole(
  presentedToken: string | null,
  env: AuthEnv
): { role: Role; viaLegacyKey: boolean } | null {
  if (!presentedToken) return null;
  const manager = (env.MANAGER_API_KEY || "").trim();
  const cashier = (env.CASHIER_API_KEY || "").trim();
  const legacy = (env.API_KEY || "").trim();

  if (manager && timingSafeEqual(presentedToken, manager)) return { role: "manager", viaLegacyKey: false };
  if (cashier && timingSafeEqual(presentedToken, cashier)) return { role: "cashier", viaLegacyKey: false };
  if (legacy && timingSafeEqual(presentedToken, legacy)) return { role: "manager", viaLegacyKey: true };
  return null;
}

/** Extract a Bearer / X-API-Key token from the request, or null. */
function presentedKey(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("X-API-Key");
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, "").trim() : (apiKeyHeader || "").trim();
  return token || null;
}

/**
 * Reproduce settingsConfig.hashPassword in the Worker: PBKDF2(100k, SHA-256)
 * deriving a 256-bit AES-GCM key, exported raw and hex-encoded. Kept byte-for-
 * byte compatible so a password typed in the POS verifies against the hash the
 * POS stored in D1.
 */
async function derivePasswordHashHex(password: string, saltHex: string): Promise<string> {
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  const derivedKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  return bytesToHex(new Uint8Array(exported));
}

/**
 * The canonical id prefix for credential (and other durable) settings rows.
 * The POS client writes these with id = `global::<key>` only — see
 * settingsCloudService.ts → settingDocId, which returns `global::<key>` for every
 * key in DURABLE_SETTING_KEYS (both credential keys are). Older code revisions
 * left per-branch rows (`main_branch::<key>`, `manager::<key>`) with DIFFERENT
 * hashes; reading by `WHERE key = ?` matched an arbitrary one and password
 * verification silently failed (the 401 storm fixed in
 * docs/fix-401-session-bootstrap.md). Pin the read to the exact id the client
 * writes so the source of truth is unambiguous.
 */
const GLOBAL_SETTING_ID_PREFIX = "global::";

/** Read the stored credential record for a settings key from D1 (deterministic). */
async function readCredsRecord(
  env: AuthEnv,
  settingsKey: string
): Promise<{ hash?: string; salt?: string; password?: string } | null> {
  try {
    // Bind the full id (`global::<key>`) so there is exactly one candidate row
    // and no ORDER BY tie can pick a stale orphan over the live credential.
    const row = (await env.DB.prepare(
      "SELECT value FROM settings WHERE id = ?"
    )
      .bind(`${GLOBAL_SETTING_ID_PREFIX}${settingsKey}`)
      .first()) as { value?: string } | null;
    if (!row || !row.value) return null;
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === "object") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Does a presented password match a stored credential record? */
async function passwordMatches(
  env: AuthEnv,
  password: string,
  creds: { hash?: string; salt?: string; password?: string } | null,
  settingsKey: string
): Promise<boolean> {
  if (!creds) return false;
  if (creds.hash && creds.salt) {
    const computed = await derivePasswordHashHex(password, creds.salt);
    const ok = timingSafeEqual(computed, creds.hash);
    // Self-healing: if the row still carries a legacy plaintext `password` field,
    // strip it now so the downgrade path cannot be re-armed by a stale client.
    if (ok && creds.password) {
      try {
        const { password: _drop, ...cleaned } = creds;
        await env.DB.prepare(
          "UPDATE settings SET value = ? WHERE id = ?"
        )
          .bind(JSON.stringify(cleaned), `${GLOBAL_SETTING_ID_PREFIX}${settingsKey}`)
          .run();
        console.warn(`[worker] stripped legacy plaintext password from ${settingsKey}`);
      } catch (e) {
        console.warn(`[worker] failed to strip legacy plaintext password from ${settingsKey}:`, e);
      }
    }
    return ok;
  }
  // Legacy plaintext credential (pre-hashing installs).
  if (creds.password) return timingSafeEqual(password, creds.password);
  return false;
}

/**
 * Resolve a role from the operator's POS password by verifying it against the
 * PBKDF2 credential hashes already stored in D1 `settings`. Manager is tried
 * first. Returns null when the password matches neither role.
 */
export async function resolvePasswordRole(env: AuthEnv, password: string): Promise<Role | null> {
  if (!password) return null;
  const managerCreds = await readCredsRecord(env, MANAGER_CREDS_KEY);
  if (await passwordMatches(env, password, managerCreds, MANAGER_CREDS_KEY)) return "manager";
  const cashierCreds = await readCredsRecord(env, CASHIER_CREDS_KEY);
  if (await passwordMatches(env, password, cashierCreds, CASHIER_CREDS_KEY)) return "cashier";
  return null;
}

// ─── Request authentication ──────────────────────────────────────────────────
/**
 * Authenticate a request and return its role, or null. A valid session cookie is
 * the primary path. During migration a legacy shared API_KEY (Authorization /
 * X-API-Key) is still accepted and mapped to manager IF that secret is set on the
 * Worker — this keeps any till that has not re-minted a cookie syncing. Remove
 * API_KEY from the Worker to disable.
 */
export async function authenticate(
  request: Request,
  env: AuthEnv
): Promise<{ role: Role; sid: string | null; viaCookie: boolean } | null> {
  const cookieToken = readSessionCookie(request);
  if (cookieToken) {
    const payload = await verifySessionToken(cookieToken, env);
    if (payload) return { role: payload.role, sid: payload.sid, viaCookie: true };
  }

  if (env.API_KEY) {
    const key = presentedKey(request);
    const resolved = resolveKeyRole(key, env);
    if (resolved) {
      if (resolved.viaLegacyKey) {
        console.warn(
          "[worker] SECURITY: legacy API_KEY used to authenticate as manager. " +
          "Delete it from Worker secrets once all tills have re-minted cookies: npx wrangler secret delete API_KEY"
        );
      }
      return { role: resolved.role, sid: null, viaCookie: false };
    }
  }

  return null;
}

/**
 * Verify the double-submit CSRF token for a cookie-authenticated request. Reads
 * the session cookie, recomputes the expected token from its sid, and compares
 * it (constant-time) to the X-CSRF-Token header. Header-key (non-cookie) callers
 * are not subject to CSRF — an attacker cannot make a browser attach a secret
 * header cross-origin — so this only guards the cookie path.
 */
export async function verifyCsrf(request: Request, env: AuthEnv): Promise<boolean> {
  const cookieToken = readSessionCookie(request);
  if (!cookieToken) return false;
  const payload = await verifySessionToken(cookieToken, env);
  if (!payload) return false;
  const expected = await csrfTokenFor(payload.sid, env);
  if (!expected) return false;
  const presented = (request.headers.get(CSRF_HEADER) || "").trim();
  if (!presented) return false;
  return timingSafeEqual(presented, expected);
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
/**
 * D1-backed sliding-window rate limiter. Stores attempt timestamps in the
 * `settings` table under `rate_limit::<key>` so no new table is needed.
 *
 * Not as precise as a dedicated rate-limiting service (timestamps are second-
 * resolution, and the read-modify-write is not atomic), but it is sufficient to
 * stop naive online brute-force against the POS password.
 */
export async function checkRateLimit(
  env: AuthEnv,
  key: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const id = `global::rate_limit::${key}`;
  try {
    const row = (await env.DB.prepare("SELECT value FROM settings WHERE id = ?")
      .bind(id)
      .first()) as { value?: string } | null;

    let attempts: number[] = [];
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) attempts = parsed;
      } catch {
        attempts = [];
      }
    }

    const cutoff = now - windowSeconds;
    attempts = attempts.filter((t) => t > cutoff);

    if (attempts.length >= maxAttempts) return false;

    attempts.push(now);
    await env.DB.prepare(
      "INSERT INTO settings (id, key, value, branch_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    )
      .bind(id, `rate_limit::${key}`, JSON.stringify(attempts), "main_branch", new Date().toISOString())
      .run();

    return true;
  } catch (e) {
    // Fail-open on D1 error: a broken rate limiter must not take down auth.
    console.warn("[worker] rate limit check failed, allowing request:", e);
    return true;
  }
}

// ─── Session endpoints ───────────────────────────────────────────────────────
/**
 * Session lifecycle routes. Returns a Response for a session route, or null to
 * let normal routing continue. MUST be called BEFORE the auth gate, because
 * minting a session is exactly what an unauthenticated client does first.
 *
 *   POST   /v1/session  → mint cookie (requires a credential)  200 + Set-Cookie
 *   DELETE /v1/session  → clear cookie                          200 + cleared
 *   GET    /v1/session  → status probe                          200 {authenticated,role} | 401
 *
 * `/auth/session` and `/session` are accepted as aliases.
 */
export async function handleSessionRoutes(
  request: Request,
  env: AuthEnv,
  cors: Record<string, string>
): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (path !== "/v1/session" && path !== "/auth/session" && path !== "/session") {
    return null;
  }

  const jsonHeaders = { "Content-Type": "application/json", ...cors };

  if (request.method === "POST") {
    // Fail closed if the Worker cannot sign cookies — never mint on a default.
    if (!sessionSecret(env)) {
      console.error("[worker] SESSION_SECRET is not configured — refusing to mint sessions.");
      return new Response(
        JSON.stringify({ error: "Service Unavailable", message: "Server is not configured for authenticated access." }),
        { status: 503, headers: jsonHeaders }
      );
    }

    // Rate limit: 5 password-mint attempts per IP per minute. The endpoint does a
    // real PBKDF2-100k verify per attempt; without a cap an attacker can brute-
    // force the POS password online. Keyed by CF-Connecting-IP, falling back to a
    // shared bucket when the header is absent (local dev).
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const allowed = await checkRateLimit(env, `session_mint:${clientIp}`, 5, 60);
    if (!allowed) {
      console.warn(`[worker] rate limit exceeded for session mint from ${clientIp}`);
      return new Response(
        JSON.stringify({ error: "Too Many Requests", message: "Too many attempts. Try again later." }),
        { status: 429, headers: jsonHeaders }
      );
    }

    // Resolve a role from a presented credential. NO anonymous path.
    let role: Role | null = null;

    // (a) role-scoped / legacy API key
    const keyResolved = resolveKeyRole(presentedKey(request), env);
    if (keyResolved) role = keyResolved.role;

    // (b) POS login password verified against the D1 credential hashes
    if (!role) {
      let password = "";
      try {
        const body = (await request.json()) as { password?: string } | null;
        password = (body?.password || "").trim();
      } catch {
        password = "";
      }
      if (password) role = await resolvePasswordRole(env, password);
    }

    if (!role) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", message: "Valid credentials required to start a session." }),
        { status: 401, headers: jsonHeaders }
      );
    }

    const minted = await mintSessionToken(env, role);
    if (!minted) {
      return new Response(
        JSON.stringify({ error: "Service Unavailable", message: "Server is not configured for authenticated access." }),
        { status: 503, headers: jsonHeaders }
      );
    }

    // The CSRF token rides in the JSON body (readable), not the cookie — the
    // client stores it and echoes it as X-CSRF-Token on every write.
    const csrfToken = await csrfTokenFor(minted.sid, env);

    return new Response(JSON.stringify({ ok: true, role, expiresAt: minted.exp, csrfToken }), {
      status: 200,
      headers: { ...jsonHeaders, "Set-Cookie": buildSetCookie(minted.token) },
    });
  }

  if (request.method === "DELETE") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...jsonHeaders, "Set-Cookie": buildClearCookie() },
    });
  }

  if (request.method === "GET") {
    const auth = await authenticate(request, env);
    return new Response(JSON.stringify({ authenticated: !!auth, role: auth?.role ?? null }), {
      status: auth ? 200 : 401,
      headers: jsonHeaders,
    });
  }

  return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
    status: 405,
    headers: jsonHeaders,
  });
}
