/**
 * Cookie-based session authentication for the POS Worker.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous design required an operator to paste a shared API key into a
 * Settings → Cloud Sync box. That box (CloudSyncModal) was deleted in 53f908d /
 * ec257c7, so `setApiKey()` was never called again: `getApiKey()` returned "",
 * every Worker request 401'd, and cloud backup was 100% dead — all data lived
 * only in the tablet's browser. There was no way to re-enter the key from the UI.
 *
 * THE FIX
 * -------
 * There is NO operator-entered key anymore. The browser calls `POST /v1/session`
 * (no credentials required) and the Worker mints a short-lived, HMAC-signed,
 * HttpOnly session cookie. Every subsequent request rides that cookie, and the
 * gate is simply: valid cookie → allowed, missing/invalid → 401. The client
 * establishes the session automatically on first cloud contact and re-mints it
 * on a 401, so backup "just works" on any device with zero setup.
 *
 * WHY STATELESS (no D1 table / no migration)
 * ------------------------------------------
 * The session carries no user identity — it is an anonymous device session that
 * grants the same full access the single shared key used to. Validity is proven
 * purely by the HMAC signature and the `exp` claim, so there is nothing to store
 * server-side: no `auth_users` table, no schema migration, no per-request DB read.
 *
 * SECURITY POSTURE (deliberate, owner-approved tradeoff)
 * ------------------------------------------------------
 * Because the mint endpoint takes no secret, anyone who can reach the Worker can
 * obtain a cookie — the barrier for browsers is the fail-closed CORS allowlist
 * (only pos.engaz.tech may read responses), and forging a cookie without going
 * through /v1/session is infeasible without SESSION_SECRET. This is a working
 * backup with a light barrier, chosen over the prior state of NO backup at all.
 * Set a strong SESSION_SECRET (wrangler.toml [vars] or `wrangler secret put
 * SESSION_SECRET`) so cookies cannot be forged by anyone reading this source.
 */

export interface AuthEnv {
  DB: D1Database;
  /** Legacy shared key. Still honored (Authorization/X-API-Key) IF set, so a
   *  half-migrated fleet keeps working; no longer required for the Worker to run. */
  API_KEY?: string;
  /** HMAC signing secret for session cookies. */
  SESSION_SECRET?: string;
  /** Legacy alias for SESSION_SECRET (older deploys used this name). */
  AUTH_TOKEN_SECRET?: string;
}

/** Session cookie name. Plain (not __Host-) so it works on http localhost dev too. */
export const SESSION_COOKIE = "pos_session";

/** 12h — comfortably covers a shift; the client re-mints silently when it lapses. */
const SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * Fallback secret so a fresh deploy authenticates out of the box ("works by
 * itself"). Override it in production — anyone who reads this repo can forge a
 * cookie while the default is in use. Precedence: SESSION_SECRET → AUTH_TOKEN_SECRET
 * → this default.
 */
const DEFAULT_SESSION_SECRET = "pos-online-anon-session-v1-please-set-SESSION_SECRET";

function sessionSecret(env: AuthEnv): string {
  return env.SESSION_SECRET || env.AUTH_TOKEN_SECRET || DEFAULT_SESSION_SECRET;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
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

// ─── HMAC-signed tokens ──────────────────────────────────────────────────────
interface SessionPayload {
  /** issued-at (unix seconds) */
  iat: number;
  /** expiry (unix seconds) */
  exp: number;
  /** payload version, for forward-compat */
  v: number;
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

/** Mint a fresh signed session token. */
export async function mintSessionToken(env: AuthEnv): Promise<{ token: string; exp: number }> {
  const iat = nowSec();
  const exp = iat + SESSION_TTL_SECONDS;
  const token = await signPayload({ iat, exp, v: 1 }, sessionSecret(env));
  return { token, exp };
}

/** Verify a session token: signature valid AND not expired. */
export async function verifySessionToken(token: string, env: AuthEnv): Promise<SessionPayload | null> {
  const payload = await verifyPayload(token, sessionSecret(env));
  if (!payload || typeof payload.exp !== "number") return null;
  if (payload.exp <= nowSec()) return null;
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
 * never be sent on the cross-origin XHRs. HttpOnly keeps it out of JS (no XSS
 * exfiltration). Path=/ so every route sees it.
 */
export function buildSetCookie(token: string, maxAge: number = SESSION_TTL_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
}

/** Build the Set-Cookie that clears the session (logout). */
export function buildClearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`;
}

// ─── Request authentication ──────────────────────────────────────────────────
/**
 * True when the request carries a valid session cookie. During migration we also
 * accept the legacy shared API_KEY (Authorization: Bearer / X-API-Key) IF the
 * secret is still configured on the Worker — this lets any device that has not
 * yet re-minted a cookie keep syncing. Remove API_KEY from the Worker to disable.
 */
export async function hasValidSession(request: Request, env: AuthEnv): Promise<boolean> {
  const cookieToken = readSessionCookie(request);
  if (cookieToken) {
    const payload = await verifySessionToken(cookieToken, env);
    if (payload) return true;
  }

  // Legacy shared-key fallback (only if the secret is still set on the Worker).
  if (env.API_KEY) {
    const authHeader = request.headers.get("Authorization");
    const apiKeyHeader = request.headers.get("X-API-Key");
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : apiKeyHeader || "";
    if (token && token === env.API_KEY) return true;
  }

  return false;
}

// ─── Session endpoints ───────────────────────────────────────────────────────
/**
 * Handle the session lifecycle routes. Returns a Response for a session route,
 * or null to let normal routing continue. MUST be called BEFORE the auth gate,
 * because minting a session is exactly what an unauthenticated client does first.
 *
 *   POST   /v1/session  → mint cookie      (200 + Set-Cookie)
 *   DELETE /v1/session  → clear cookie      (200 + cleared Set-Cookie)
 *   GET    /v1/session  → status probe      (200 {authenticated:true} | 401)
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
    const { token, exp } = await mintSessionToken(env);
    return new Response(JSON.stringify({ ok: true, expiresAt: exp }), {
      status: 200,
      headers: { ...jsonHeaders, "Set-Cookie": buildSetCookie(token) },
    });
  }

  if (request.method === "DELETE") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...jsonHeaders, "Set-Cookie": buildClearCookie() },
    });
  }

  if (request.method === "GET") {
    const ok = await hasValidSession(request, env);
    return new Response(JSON.stringify({ authenticated: ok }), {
      status: ok ? 200 : 401,
      headers: jsonHeaders,
    });
  }

  return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
    status: 405,
    headers: jsonHeaders,
  });
}
