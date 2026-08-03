/**
 * Central Cloudflare Worker configuration for web + Electron.
 * Never fall back to the SPA origin (pos.engaz.tech) — that is not the D1 worker.
 */

import { getRefundPin } from '../utils/refundPin';

const PLACEHOLDER_MARKERS = [
  'YOUR_SUBDOMAIN',
  'your-username',
  'your-worker',
  'example.com',
];

const DEFAULT_TIMEOUT_MS = 8000;

function cleanUrl(raw: string | undefined | null): string {
  if (!raw) return '';
  const url = String(raw).trim().replace(/^["']|["']$/g, '').replace(/\/$/, '');
  if (!url) return '';
  if (PLACEHOLDER_MARKERS.some((m) => url.includes(m))) return '';
  if (typeof window !== 'undefined') {
    try {
      const origin = window.location.origin.replace(/\/$/, '');
      if (url === origin || url.startsWith(origin + '/')) return '';
    } catch {
      // ignore
    }
  }
  if (url === 'https://pos.engaz.tech' || url === 'http://pos.engaz.tech') return '';
  return url;
}

/**
 * The production Worker, used as a last-resort fallback in production builds only.
 *
 * WHY THIS IS NOT SIMPLY THE DEFAULT ANY MORE
 * This constant used to be returned before the localStorage override was even
 * consulted, in every mode including `npm run dev`. Two consequences:
 *
 *   1. A developer running the app locally with no VITE_CLOUDFLARE_WORKER_URL set
 *      was silently pointed at the LIVE production D1 database. Local
 *      experimentation — creating test orders, editing the menu, triggering a
 *      sync — wrote to real business data, with nothing in the UI indicating it.
 *      The only reason this had not already caused damage is that CORS on the
 *      production Worker rejects unknown origins: an unrelated safety net in a
 *      different system was the sole thing standing between a dev session and the
 *      real till's data.
 *   2. Because it was checked BEFORE localStorage, the operator-facing worker-URL
 *      override could never take effect — whatever was stored, this constant won.
 *
 * Resolution order is now: env var → stored override → (production only) this
 * built-in. Dev never reaches for production.
 */
const BUILTIN_PRODUCTION_WORKER = 'https://api.engaz.tech';

/** True under `npm run dev` and vitest; false in a production `vite build`. */
function isDevEnvironment(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

let warnedAboutMissingWorkerUrl = false;

/**
 * Resolve the Cloudflare Worker base URL.
 *
 * Order: VITE_CLOUDFLARE_WORKER_URL → stored operator override → built-in
 * production Worker (production builds only). Returns '' when nothing resolves,
 * which callers already treat as "stay local-only".
 */
export function getWorkerUrl(): string {
  const fromEnv = cleanUrl(import.meta.env.VITE_CLOUDFLARE_WORKER_URL as string | undefined);
  if (fromEnv) return fromEnv;

  // The operator's stored override now outranks the built-in constant, so the
  // setting actually does something.
  if (typeof window !== 'undefined') {
    try {
      const stored = cleanUrl(localStorage.getItem('brewmaster_d1_worker_url'));
      if (stored) return stored;
    } catch {
      // ignore
    }
  }

  if (isDevEnvironment()) {
    // Loud, once per session: an unconfigured dev build stays local instead of
    // silently attaching itself to the production database.
    if (!warnedAboutMissingWorkerUrl) {
      warnedAboutMissingWorkerUrl = true;
      console.error(
        '[cloudConfig] VITE_CLOUDFLARE_WORKER_URL is not set. Cloud sync is DISABLED for this ' +
          'dev session (the app stays local-only).\n' +
          'This is deliberate: dev builds no longer fall back to the production Worker, because ' +
          'that pointed local testing at the live D1 database.\n' +
          'To use a Worker locally, set VITE_CLOUDFLARE_WORKER_URL in .env.local — point it at ' +
          'your own `wrangler dev` instance or a staging Worker.'
      );
    }
    return '';
  }

  // Production build with no explicit configuration: keep an existing deployment
  // working, but say so clearly, because a hardcoded hostname is not a
  // configuration anyone actually chose.
  const fromBuiltin = cleanUrl(BUILTIN_PRODUCTION_WORKER);
  if (fromBuiltin) {
    if (!warnedAboutMissingWorkerUrl) {
      warnedAboutMissingWorkerUrl = true;
      console.warn(
        '[cloudConfig] VITE_CLOUDFLARE_WORKER_URL was not set at build time; falling back to the ' +
          `built-in Worker ${fromBuiltin}. Set VITE_CLOUDFLARE_WORKER_URL when building so the ` +
          'backend is an explicit deployment choice rather than a hardcoded default.'
      );
    }
    return fromBuiltin;
  }

  return '';
}

/** Test-only: reset the once-per-session warning latch. */
export function resetWorkerUrlWarningForTests(): void {
  warnedAboutMissingWorkerUrl = false;
}

/**
 * Cloud session (role-bearing, credential-gated cookie auth).
 *
 * The Worker mints an HttpOnly session cookie at POST /v1/session, but ONLY when
 * the caller presents a valid credential — there is no anonymous session. The
 * browser POS presents the operator's login password; the Worker verifies it
 * against the credential hashes already stored in D1 and bakes the resulting
 * ROLE ("manager" | "cashier") into the signed cookie. The client never declares
 * its own role, and it never sees the cookie (HttpOnly) — it only holds the
 * password in memory for the current page-load so it can (re-)mint silently.
 *
 * Reload behaviour: after a refresh the in-memory password is gone but the 12h
 * cookie is still valid, so requests keep working. ensureCloudSession then
 * becomes a no-op (no credential to mint with) and we simply ride the existing
 * cookie; only when the cookie truly lapses (401 with no credential) does the
 * app need a fresh login.
 */
const SESSION_PATH = '/v1/session';
let sessionPromise: Promise<boolean> | null = null;

/** The operator password used to (re-)mint a session. Memory only — never persisted. */
let sessionCredential: string | null = null;
/** Role reported by the Worker at the last successful mint. */
let sessionRole: 'manager' | 'cashier' | null = null;

/**
 * CSRF double-submit token from the last mint. The HttpOnly session cookie is
 * invisible to JS and cross-origin, so this token — bound server-side to the
 * session — is what we echo in X-CSRF-Token on writes. Persisted to localStorage
 * so it survives a reload while the 12h cookie is still valid (the token stays
 * valid as long as the session's sid does), and read back on startup.
 */
const CSRF_STORAGE_KEY = 'brewmaster_csrf_token';
let csrfToken: string | null = readStoredCsrf();

function readStoredCsrf(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(CSRF_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function storeCsrf(token: string | null): void {
  csrfToken = token || null;
  if (typeof window === 'undefined') return;
  try {
    if (token) localStorage.setItem(CSRF_STORAGE_KEY, token);
    else localStorage.removeItem(CSRF_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** The CSRF token to send with writes, or '' when none is established. */
export function getCsrfToken(): string {
  return csrfToken || '';
}

/**
 * Provide the credential used to mint a role-scoped session. Call this on login
 * with the password the operator just authenticated with. Kept in memory only.
 */
export function setSessionCredential(password: string): void {
  sessionCredential = password ? String(password) : null;
  // A new credential invalidates any cached mint so the next call re-mints.
  sessionPromise = null;
  // A fresh credential resets the mint cooldown so the login attempt goes
  // through immediately instead of waiting for a stale backoff window.
  resetMintCooldown();
}

/** Forget the in-memory credential, role and CSRF token (called on logout). */
export function clearSessionCredential(): void {
  sessionCredential = null;
  sessionRole = null;
  storeCsrf(null);
  sessionPromise = null;
}

/** The role the Worker granted this session, if a mint has succeeded. */
export function getSessionRole(): 'manager' | 'cashier' | null {
  return sessionRole;
}

/**
 * The operator's raw password, held in memory only since login (never
 * persisted). Used to derive the AES key that encrypts/decrypts cloud-stored
 * secrets (e.g. the Telegram bot token) so only the manager can read them.
 * Returns null when no live credential is held (e.g. after a reload where only
 * the HttpOnly cookie survives).
 */
export function getSessionCredential(): string | null {
  return sessionCredential;
}

/**
 * Resolve the session role from the Worker WITHOUT a password.
 *
 * After a page reload the in-memory credential and role are gone, but the 12h
 * HttpOnly session cookie is still valid — so getSessionRole() returns null even
 * though the operator is a signed-in manager. This probes GET /v1/session (which
 * reads the cookie and reports { authenticated, role }), caches the result in
 * memory, and returns it, so a role-gated action (e.g. a refund) can be authorized
 * on the existing cookie alone. Returns null when there is no valid session.
 */
export async function refreshCloudSessionRole(): Promise<'manager' | 'cashier' | null> {
  const base = getWorkerUrl();
  if (!base) return null;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  try {
    const res = await fetch(`${base}${SESSION_PATH}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const json = await res.json();
    const role = json?.role;
    if (role === 'manager' || role === 'cashier') {
      sessionRole = role;
      return role;
    }
    return null;
  } catch (err) {
    console.warn('[cloud] session role probe failed:', err);
    return null;
  }
}

// ─── Mint-failure cooldown ──────────────────────────────────────────────────
// After consecutive mint failures (wrong password, missing creds, network
// error), pause further mint attempts for a cooldown window instead of retrying
// on every cloudFetch / setInterval / hydrate cycle. This kills the "401 storm"
// — tens of rapid POST /v1/session per second visible in the F12 console.
const MINT_COOLDOWN_BASE_MS = 5_000; // 5s initial cooldown
const MINT_COOLDOWN_MAX_MS = 120_000; // 2min cap
const MINT_RATE_LIMIT_COOLDOWN_MS = 60_000; // 1min after an explicit 429
let mintConsecutiveFailures = 0;
let mintCooldownUntil = 0;

/** Reset the cooldown (called on successful mint or fresh login credential). */
function resetMintCooldown(): void {
  mintConsecutiveFailures = 0;
  mintCooldownUntil = 0;
}

/** Advance the cooldown after a failed mint. */
function advanceMintCooldown(): void {
  mintConsecutiveFailures++;
  const delay = Math.min(
    MINT_COOLDOWN_BASE_MS * Math.pow(2, mintConsecutiveFailures - 1),
    MINT_COOLDOWN_MAX_MS
  );
  mintCooldownUntil = Date.now() + delay;
}

/** The Worker rate-limits POST /v1/session per IP (429). Back off a full
 *  window — the exponential failure cooldown above (5s → …) would otherwise
 *  retry inside the same rate-limit window and stay blocked. */
function advanceMintCooldownForRateLimit(): void {
  mintConsecutiveFailures++;
  mintCooldownUntil = Date.now() + MINT_RATE_LIMIT_COOLDOWN_MS;
}

// ─── Cross-tab session-mint coordination ────────────────────────────────────
// Every open tab shares the same per-IP rate limit on POST /v1/session. When
// several tabs re-mint at once (reload storm, iOS tab restore), they race the
// limiter and all get 429s — the console shows exactly that burst. A single
// leader (Web Locks API, with a localStorage fallback) performs the mint; the
// other tabs wait for its outcome instead of firing their own requests.
const MINT_LOCK_NAME = 'pos_session_mint';
const MINT_RESULT_KEY = 'pos_session_mint_result';

interface MintResult {
  ok: boolean;
  at: number;
  status?: number;
}

/**
 * Why the last session mint failed.
 *
 * The login screen used to report EVERY failure as "كلمة المرور غير صحيحة",
 * because ensureCloudSession() collapses every outcome into a boolean. A cashier
 * locked out by the per-IP rate limit (429), or hitting a Worker with no
 * SESSION_SECRET set (503), or simply offline, was told his password was wrong —
 * so he would retry and reset it, and every retry extended the lockout. The mint
 * already knows the status; it just never surfaced it.
 */
export type SessionMintOutcome =
  /** Nothing was attempted (no worker URL configured, or no credential held). */
  | { kind: 'no_attempt' }
  | { kind: 'ok' }
  /** The Worker refused the password (401/403). */
  | { kind: 'rejected'; status: number }
  /** Per-IP rate limit on POST /v1/session. Waiting is the fix, not a new password. */
  | { kind: 'rate_limited'; status: number }
  /** Worker reachable but refusing to mint — e.g. SESSION_SECRET unset (503). */
  | { kind: 'server_misconfigured'; status: number }
  | { kind: 'server_error'; status: number }
  /** Network failure, offline, or the request never got an answer. */
  | { kind: 'unreachable' };

let lastMintOutcome: SessionMintOutcome = { kind: 'no_attempt' };

function recordMintOutcome(outcome: SessionMintOutcome): void {
  lastMintOutcome = outcome;
}

/** Classify an HTTP status from POST /v1/session. */
function classifyMintStatus(status: number): SessionMintOutcome {
  if (status === 429) return { kind: 'rate_limited', status };
  if (status === 401 || status === 403) return { kind: 'rejected', status };
  if (status === 503) return { kind: 'server_misconfigured', status };
  if (status >= 500) return { kind: 'server_error', status };
  return { kind: 'rejected', status };
}

/**
 * Why the most recent session mint failed, so callers can tell the operator
 * something true instead of blaming his password.
 */
export function getLastSessionMintOutcome(): SessionMintOutcome {
  return lastMintOutcome;
}

function readMintResult(): MintResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(MINT_RESULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MintResult;
    return typeof parsed?.at === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

function writeMintResult(result: MintResult): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MINT_RESULT_KEY, JSON.stringify(result));
  } catch {
    // ignore
  }
}

/** Wait for another tab's in-flight mint to settle (poll the shared result). */
async function waitForPeerMint(timeoutMs = 15_000): Promise<MintResult | null> {
  const started = Date.now();
  const priorAt = readMintResult()?.at ?? 0;
  while (Date.now() - started < timeoutMs) {
    const result = readMintResult();
    if (result && result.at > priorAt) return result;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/**
 * Ensure a cloud session cookie exists. Concurrent callers share one in-flight
 * mint. Best-effort: with no in-memory credential this resolves false WITHOUT
 * erroring, so an existing (valid) cookie from a prior page-load still rides the
 * request. Pass force=true to discard any cached result and mint anew (used
 * after a 401 / right after login).
 *
 * After consecutive failures the function enters a capped exponential cooldown
 * (5s → 10s → … → 2min) and short-circuits until the window elapses, preventing
 * the 401 storm that fills the F12 console and saturates the Worker when a
 * cashier session repeatedly fails to mint.
 */
export function ensureCloudSession(force = false): Promise<boolean> {
  if (force) sessionPromise = null;
  if (sessionPromise) return sessionPromise;

  // Respect cooldown unless this is a force-mint (fresh login credential).
  if (!force && mintCooldownUntil > Date.now()) {
    return Promise.resolve(false);
  }

  const p = (async (): Promise<boolean> => {
    const base = getWorkerUrl();
    if (!base) {
      recordMintOutcome({ kind: 'no_attempt' });
      return false;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      recordMintOutcome({ kind: 'unreachable' });
      return false;
    }
    // No credential ⇒ cannot mint (no anonymous sessions). Ride any existing cookie.
    if (!sessionCredential) {
      recordMintOutcome({ kind: 'no_attempt' });
      return false;
    }

    // One leader tab performs the actual mint; every other tab waits for its
    // result instead of firing a competing POST /v1/session (the burst that
    // trips the per-IP 429 rate limit when several tabs are open).
    const doMint = async (): Promise<boolean> => {
      try {
        const res = await fetch(`${base}${SESSION_PATH}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: sessionCredential }),
        });
        if (!res.ok) {
          if (res.status === 429) advanceMintCooldownForRateLimit();
          else advanceMintCooldown();
          recordMintOutcome(classifyMintStatus(res.status));
          writeMintResult({ ok: false, at: Date.now(), status: res.status });
          return false;
        }
        try {
          const json = await res.json();
          if (json && (json.role === 'manager' || json.role === 'cashier')) {
            sessionRole = json.role;
          }
          if (json && typeof json.csrfToken === 'string') {
            storeCsrf(json.csrfToken);
          }
        } catch {
          // role/csrf are best-effort; cookie is what actually authenticates
        }
        resetMintCooldown();
        recordMintOutcome({ kind: 'ok' });
        writeMintResult({ ok: true, at: Date.now(), status: res.status });
        return true;
      } catch (err) {
        console.warn('[cloud] session mint failed:', err);
        advanceMintCooldown();
        recordMintOutcome({ kind: 'unreachable' });
        writeMintResult({ ok: false, at: Date.now() });
        return false;
      }
    };

    const navLocks = (typeof navigator !== 'undefined' ? (navigator as any).locks : undefined);
    if (navLocks && typeof navLocks.request === 'function') {
      let becameLeader = false;
      try {
        return await navLocks.request(
          MINT_LOCK_NAME,
          { ifAvailable: true },
          async (lock: any) => {
            if (!lock) {
              // Another tab holds the mint lock: wait for its published result.
              const peer = await waitForPeerMint();
              if (peer) {
                if (peer.ok) {
                  // The peer minted the SHARED cookie — verify it actually landed
                  // for this tab before declaring the session established.
                  const role = await refreshCloudSessionRole();
                  if (role !== null) recordMintOutcome({ kind: 'ok' });
                  else recordMintOutcome({ kind: 'unreachable' });
                  return role !== null;
                }
                if (peer.status === 429) advanceMintCooldownForRateLimit();
                // Inherit the leader tab's reason — this tab never sent a request
                // of its own, so without this it would report a bare failure and
                // the login screen would fall back to blaming the password.
                recordMintOutcome(
                  typeof peer.status === 'number'
                    ? classifyMintStatus(peer.status)
                    : { kind: 'unreachable' }
                );
                return false;
              }
              recordMintOutcome({ kind: 'unreachable' });
              return false;
            }
            becameLeader = true;
            return await doMint();
          }
        );
      } catch (err) {
        // Lock API rejected (unsupported edge case) — fall through to a plain mint.
        if (becameLeader) throw err;
        return doMint();
      }
    }

    return doMint();
  })();

  sessionPromise = p;
  // Don't cache a failure — allow a later attempt to retry the mint.
  void p.then((ok) => { if (!ok && sessionPromise === p) sessionPromise = null; })
        .catch(() => { if (sessionPromise === p) sessionPromise = null; });
  return p;
}

/** Forget the cached session so the next request re-mints (used on 401). */
export function resetCloudSession(): void {
  sessionPromise = null;
}

/** Drop the server session cookie and in-memory credential (called on logout). */
export async function clearCloudSession(): Promise<void> {
  clearSessionCredential();
  const base = getWorkerUrl();
  if (!base) return;
  try {
    await fetch(`${base}${SESSION_PATH}`, { method: 'DELETE', credentials: 'include' });
  } catch {
    // ignore — cookie will lapse on its own
  }
}

/** Persist the Cloudflare Worker URL to localStorage only. */
export function setWorkerUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('brewmaster_d1_worker_url', String(url || '').trim());
  } catch {
    // ignore
  }
}

/**
 * This POS runs as a SINGLE branch installation.
 *
 * Every record — regardless of which device or role wrote it — belongs to the
 * one and only branch. `MAIN_BRANCH_ID` is the single source of truth; the
 * legacy ids ('default', 'branch_1', 'branch_2', 'branch_3', 'manager', 'all')
 * only survive as inputs to normalizeBranchId() so historical rows still map
 * onto the single branch.
 */
export const MAIN_BRANCH_ID = 'main_branch';

/**
 * Branch header for cloud requests.
 * Single-branch system: always the one branch, for every role and device.
 */
export function getBranchIdHeader(): string {
  return MAIN_BRANCH_ID;
}

/**
 * Collapse any historical branch id onto the single branch.
 * Kept as a function (rather than inlined) so legacy rows read from D1 or
 * IndexedDB are folded into the single branch instead of being filtered out.
 */
export function normalizeBranchId(_branchId?: string): string {
  return MAIN_BRANCH_ID;
}

export function isCloudConfigured(): boolean {
  return !!getWorkerUrl();
}

/**
 * Base headers for cloud requests. Authentication is carried by the HttpOnly
 * session cookie (via credentials: 'include'), NOT by a header — so there is no
 * Authorization / X-API-Key here anymore.
 */
export function cloudHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Branch-ID': getBranchIdHeader(),
    ...extra,
  };
}

/** Parse number from cloud payloads without turning null into 0. */
export function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// ─── Session-expiry signal ─────────────────────────────────────────────────────
/**
 * Dispatched (once per burst) when an AUTHENTICATED cloud request keeps
 * returning 401 and we cannot silently re-mint — i.e. the operator's session has
 * truly lapsed (the 12h cookie expired and there is no in-memory password to
 * re-mint with). The app listens for this to surface "Session expired — please
 * log in again" instead of silently rendering empty screens.
 *
 * Deliberately gated on EVIDENCE that a session once existed (a persisted CSRF
 * token, an in-memory role, or a live credential). A brand-new, never-signed-in
 * browser hitting a 401 must NOT see a spurious "expired" prompt.
 */
export const SESSION_EXPIRED_EVENT = 'pos:session-expired';

// ─── Refund escalation (X-Refund-PIN) ───────────────────────────────────────
// utils/refundPin has no service-side imports, so there is no cycle. When a
// manager (or a cashier who was handed the PIN) holds a valid PIN, order
// writes carry it: the Worker treats it as proven refund authority and permits
// refundedAt / refundReason changes.
function getRefundPinHeader(): string {
  try {
    return (getRefundPin() || '').trim();
  } catch {
    return '';
  }
}
let lastExpiryNotifyAt = 0;

function hadEstablishedSession(): boolean {
  return !!(csrfToken || sessionRole || sessionCredential);
}

function notifySessionExpired(): void {
  if (!hadEstablishedSession()) return;
  const now = Date.now();
  // Collapse a burst of parallel 401s (a boot hydrate reads several collections
  // at once) into a single notification.
  if (now - lastExpiryNotifyAt < 5000) return;
  lastExpiryNotifyAt = now;
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    } catch {
      // ignore — the toast is best-effort
    }
  }
}

export async function cloudFetch(
  path: string,
  init?: RequestInit & { timeoutMs?: number; skipSession?: boolean }
): Promise<Response | null> {
  const base = getWorkerUrl();
  if (!base) return null;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const skipSession = init?.skipSession === true;
  const method = (init?.method || 'GET').toUpperCase();
  const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  // Single attempt with its own abort timer. Credentials are included so the
  // HttpOnly session cookie rides along on every cloud request. Writes also
  // carry the CSRF double-submit token (read fresh each attempt so a re-mint
  // between attempts is picked up).
  const attempt = async (): Promise<Response | null> => {
    const headers = cloudHeaders(init?.headers as Record<string, string> | undefined);
    if (isWrite && csrfToken) headers['X-CSRF-Token'] = csrfToken;
    // Refund escalation: a held PIN authorizes refund-field writes server-side.
    if (isWrite && path.includes('/orders')) {
      const pin = getRefundPinHeader();
      if (pin) headers['X-Refund-PIN'] = pin;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const { timeoutMs: _t, signal: _s, skipSession: _skip, headers: _h, ...rest } = init || {};
      return await fetch(url, {
        ...rest,
        credentials: 'include',
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      console.warn('[cloudFetch] failed:', path, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // Public endpoints (the QR menu) need no session; everything else establishes
  // the session cookie first, then rides it.
  if (!skipSession) await ensureCloudSession();

  let res = await attempt();

  // Re-mint + retry once when the session lapsed (401) or the CSRF token was
  // stale/absent on a write (403 flagged X-CSRF-Failed). A plain 403 (role
  // denied by permissions.ts) is a real, permanent decision — never retried.
  const csrfFailed = !!res && res.status === 403 && res.headers.get('X-CSRF-Failed') === '1';
  if (!skipSession && res && (res.status === 401 || (isWrite && csrfFailed))) {
    resetCloudSession();
    const ok = await ensureCloudSession(true);
    if (ok) res = await attempt();
  }

  // Still 401 after a re-mint attempt on an authenticated path ⇒ the session is
  // genuinely gone (cookie expired, no credential to re-mint with). Signal the
  // app so it prompts a fresh login instead of leaving empty screens behind.
  if (!skipSession && res && res.status === 401) {
    notifySessionExpired();
  }

  return res;
}

/**
 * Reserve the next daily order ticket number on the SERVER so two tills can
 * never hand out the same invoice number for the same day.
 *
 * Returns null when offline / unconfigured / the endpoint is unavailable — the
 * caller then falls back to the local `nextOrderSeq` heuristic (single-device
 * behaviour, unchanged from before).
 */
export async function reserveServerOrderSeq(dayKey: string): Promise<number | null> {
  try {
    const res = await cloudFetch('/api/orders/next-seq', {
      method: 'POST',
      body: JSON.stringify({ dayKey }),
      timeoutMs: 4000,
    });
    if (!res || !res.ok) return null;
    const data: any = await res.json().catch(() => null);
    const seq = Number(data?.seq);
    return Number.isFinite(seq) && seq > 0 ? seq : null;
  } catch {
    return null;
  }
}

/**
 * Incremental-sync high-water marks. We persist the newest change timestamp we
 * have merged for a collection so the next read can ask the worker for ONLY the
 * rows changed since then (?since=), instead of pulling the whole table on every
 * poll. Two invariants callers must respect:
 *   1. A read that fails (returns null) MUST NOT advance the mark.
 *   2. A row being ABSENT from a ?since= response is NOT a deletion — the
 *      response is a partial delta. Deletions arrive as explicit deleted_at
 *      tombstone rows and must be applied from the payload, never inferred.
 */
const SYNC_SINCE_PREFIX = 'cloud_sync_since:';

export function getCloudSyncSince(collection: string): string | undefined {
  try {
    return localStorage.getItem(SYNC_SINCE_PREFIX + collection) || undefined;
  } catch {
    return undefined;
  }
}

export function setCloudSyncSince(collection: string, iso: string): void {
  try {
    const prev = localStorage.getItem(SYNC_SINCE_PREFIX + collection);
    // Only ever move the mark forward.
    if (!prev || new Date(iso).getTime() > new Date(prev).getTime()) {
      localStorage.setItem(SYNC_SINCE_PREFIX + collection, iso);
    }
  } catch {
    // ignore storage failures — we simply fall back to a full read next time
  }
}

/**
 * Newest change timestamp across a batch of remote docs (considers updated_at,
 * deleted_at and created_at in snake/camel form). Used to advance the ?since=
 * mark after a successful merge.
 */
export function newestRemoteTimestamp(docs: any[]): string | undefined {
  let maxMs = 0;
  let maxIso: string | undefined;
  for (const d of docs || []) {
    for (const v of [
      d?.updated_at,
      d?.updatedAt,
      d?.deleted_at,
      d?.deletedAt,
      d?.created_at,
      d?.createdAt,
    ]) {
      if (!v) continue;
      const ms = new Date(v).getTime();
      if (Number.isFinite(ms) && ms > maxMs) {
        maxMs = ms;
        maxIso = typeof v === 'string' ? v : new Date(ms).toISOString();
      }
    }
  }
  return maxIso;
}

/**
 * Read a collection's documents from the cloud.
 *
 * @param opts.since Return only rows updated after this ISO timestamp (delta /
 *        incremental sync). Omit for a full snapshot. The worker maps this to
 *        `WHERE updated_at > ?`, so the caller owns the high-water mark.
 * @param opts.limit Cap the number of rows returned (worker ceiling: 5000).
 */
export async function cloudGetCollection(
  collection: string,
  opts?: { since?: string; limit?: number }
): Promise<any[] | null> {
  try {
    let path = `/v1/databases/default/collections/${collection}/documents`;
    const qs = new URLSearchParams();
    if (opts?.since) qs.set('since', opts.since);
    if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0) {
      qs.set('limit', String(Math.floor(opts.limit)));
    }
    const query = qs.toString();
    if (query) path += `?${query}`;

    const res = await cloudFetch(
      path,
      { method: 'GET', timeoutMs: DEFAULT_TIMEOUT_MS }
    );
    if (!res) return null;
    if (!res.ok) {
      console.warn(`[cloud] GET ${collection} failed: HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    return Array.isArray(json?.documents) ? json.documents : [];
  } catch (err) {
    console.warn(`[cloud] GET ${collection} error:`, err);
    return null;
  }
}

/**
 * PUBLIC menu read for the customer-facing QR page (/public-menu).
 *
 * Anonymous visitors have no session cookie, so the authenticated collections
 * endpoint returns 401 and the menu renders empty. This hits the worker's
 * unauthenticated `/public/menu` route instead, which returns only the live,
 * available items. We pass skipSession so a guest never mints a session cookie;
 * the endpoint does not require one, so a guest gets a clean 200. Returns null
 * on failure so the caller can surface an error state instead of silently
 * showing an empty menu.
 */
export async function cloudGetPublicMenu(): Promise<any[] | null> {
  try {
    const res = await cloudFetch('/public/menu', {
      method: 'GET',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      // Anonymous QR guests: the /public/menu route is unauthenticated, so don't
      // mint a session cookie for a visitor who will never write anything.
      skipSession: true,
    });
    if (!res) return null;
    if (!res.ok) {
      console.warn(`[cloud] GET public menu failed: HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    return Array.isArray(json?.documents) ? json.documents : [];
  } catch (err) {
    console.warn('[cloud] GET public menu error:', err);
    return null;
  }
}

/**
 * The real outcome of a cloud write.
 *
 * `cloudUpsert` collapses everything into a boolean, which is fine for the
 * queue-and-retry paths: anything that is not success gets queued. It is NOT
 * fine for an action that must not be applied locally unless the server
 * accepted it — a refund. "The server REFUSED this write" (403, deterministic)
 * and "the server was unreachable" (offline, retryable) demand opposite
 * responses, and a boolean cannot tell them apart.
 */
/** A row payload on its way to D1 — shapes vary per collection. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CloudDocument = Record<string, any>;

export type CloudWriteOutcome =
  /** Written to D1 and confirmed. */
  | { kind: 'ok' }
  /** Server refused it (403). Retrying the same payload can only fail again. */
  | { kind: 'denied'; status: number; code: string | null; message: string | null }
  /** Session lapsed (401) — the caller may re-mint and retry. */
  | { kind: 'unauthenticated'; status: number }
  /** Rejected by the freshness guard: a newer row already exists. */
  | { kind: 'stale' }
  /** Offline / timeout / other HTTP error — safe to queue and retry. */
  | { kind: 'unreachable'; status: number | null };

/**
 * Immediate upsert to D1 (Cloud-first path), reporting the real outcome.
 * Prefer this over `cloudUpsert` whenever the caller must distinguish a server
 * REFUSAL from a network failure.
 */
export async function cloudUpsertWithOutcome(
  collection: string,
  id: string,
  data: CloudDocument
): Promise<CloudWriteOutcome> {
  if (!id) return { kind: 'unreachable', status: null };
  const payload: CloudDocument = { ...data, id };
  // Single-branch system: every row is stamped with the one branch id.
  payload.branch_id = MAIN_BRANCH_ID;
  payload.branchId = MAIN_BRANCH_ID;
  try {
    const res = await cloudFetch(
      `/v1/databases/default/collections/${collection}/documents`,
      {
        method: 'POST',
        timeoutMs: DEFAULT_TIMEOUT_MS,
        body: JSON.stringify({ documentId: id, data: payload }),
      }
    );
    if (!res) return { kind: 'unreachable', status: null };
    if (!res.ok) {
      console.warn(`[cloud] UPSERT ${collection}/${id} failed: HTTP ${res.status}`);
      if (res.status === 401) return { kind: 'unauthenticated', status: 401 };
      if (res.status === 403) {
        // A CSRF-stale 403 is a retryable session problem, not a permission
        // decision — the Worker flags it with X-CSRF-Failed.
        if (res.headers.get('X-CSRF-Failed') === '1') {
          return { kind: 'unauthenticated', status: 403 };
        }
        let code: string | null = null;
        let message: string | null = null;
        try {
          const body = (await res.clone().json()) as { code?: string; message?: string } | null;
          code = body?.code ?? null;
          message = body?.message ?? null;
        } catch {
          // non-JSON error body — the status alone still says "refused"
        }
        return { kind: 'denied', status: 403, code, message };
      }
      return { kind: 'unreachable', status: res.status };
    }
    // A 200 does NOT always mean the row was written. When the Worker's
    // last-writer-wins freshness guard rejects the conflict update it answers
    // `200 { success: true, stale: true }` and the stored row is NOT touched.
    // Treating that as success (and acking the queue row below) silently
    // DISCARDED the write: the value lived on in localStorage while D1 kept the
    // older copy, and the next hydrate pulled that older copy back over it.
    // Report failure instead, so the caller falls back to the retrying queue.
    try {
      const body: any = await res.clone().json();
      if (body && body.stale === true) {
        console.warn(
          `[cloud] UPSERT ${collection}/${id} discarded by the server freshness guard ` +
            `(a newer row already exists) — queue row NOT acked.`
        );
        return { kind: 'stale' };
      }
    } catch {
      // Non-JSON / empty body — nothing to inspect; treat the 200 as success.
    }
    // Best-effort: clear pending queue rows for this entity so SyncStatus stays honest
    void ackSyncQueueForEntity(id);
    return { kind: 'ok' };
  } catch (err) {
    console.warn(`[cloud] UPSERT ${collection}/${id} error:`, err);
    return { kind: 'unreachable', status: null };
  }
}

/**
 * Immediate upsert to D1 (Cloud-first path).
 * Returns true on success, false on offline/failure (caller should queue).
 */
export async function cloudUpsert(
  collection: string,
  id: string,
  data: CloudDocument
): Promise<boolean> {
  return (await cloudUpsertWithOutcome(collection, id, data)).kind === 'ok';
}

/** Mark open sync_queue rows for an entity id as synced (after successful cloud write). */
export async function ackSyncQueueForEntity(entityId: string): Promise<void> {
  if (!entityId || typeof window === 'undefined') return;
  try {
    const { withDB } = await import('../repositories/indexeddb/db');
    await withDB(async (db) => {
      const all = await db.getAll('sync_queue');
      const now = new Date().toISOString();
      const tx = db.transaction('sync_queue', 'readwrite');
      for (const rec of all) {
        if (rec.synced === 1) continue;
        const rid = rec.data?.id || rec.data?.documentId;
        // Exact payload-id match only.
        //
        // This previously used rec.id.includes(`_${entityId}`), which matched
        // by substring: acking "ord_123" also acked queue rows belonging to
        // "ord_1234". Those rows were marked synced without ever reaching D1
        // and were purged 24h later — a silent, permanent loss of an order or
        // payment. Substring matching is never safe for id comparison.
        if (rid !== entityId) continue;
        rec.synced = 1;
        rec.syncedAt = now;
        rec.lastError = undefined;
        delete rec.dead;
        await tx.store.put(rec);
      }
      await tx.done;
    });
  } catch {
    // never block POS
  }
}

export async function cloudDeleteDocument(
  collection: string,
  id: string
): Promise<boolean> {
  if (!id) return false;
  try {
    const res = await cloudFetch(
      `/v1/databases/default/collections/${collection}/documents/${id}`,
      { method: 'DELETE', timeoutMs: DEFAULT_TIMEOUT_MS }
    );
    if (!res) return false;
    if (!res.ok && res.status !== 404) {
      console.warn(`[cloud] DELETE ${collection}/${id} failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[cloud] DELETE ${collection}/${id} error:`, err);
    return false;
  }
}

/**
 * Fire-and-forget sync via /api/sync (same path as SyncService queue).
 * Useful when you already wrote sync_queue and want an immediate flush attempt.
 */
export async function cloudSyncNow(payload: {
  type: string;
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp?: string;
}): Promise<boolean> {
  try {
    const res = await cloudFetch('/api/sync', {
      method: 'POST',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      body: JSON.stringify({
        type: payload.type,
        action: payload.action,
        data: payload.data,
        timestamp: payload.timestamp || new Date().toISOString(),
      }),
    });
    if (!res) return false;
    if (!res.ok) return false;
    // `200 { success: true, stale: true }` means the freshness guard discarded
    // the write — the row in D1 was NOT changed. Reporting success here would
    // retire the queue row for a write that never landed (see cloudUpsert).
    try {
      const body: any = await res.clone().json();
      if (body && body.stale === true) {
        console.warn(
          `[cloud] syncNow ${payload.type}/${payload.data?.id} discarded by the server ` +
            `freshness guard (a newer row already exists).`
        );
        return false;
      }
    } catch {
      // Non-JSON body — treat the 200 as success.
    }
    return true;
  } catch (err) {
    console.warn('[cloud] syncNow error:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cloud health probe (honest backup-health indicator).
//
// Ported from the consolidation branch onto the session-auth client. Talks to
// the PUBLIC, unauthenticated GET /api/health worker route (in front of the
// session gate — see cloudflare-worker/src/index.ts), so an expired session can
// never masquerade as a dead database.
// ---------------------------------------------------------------------------
const HEALTH_TIMEOUT_MS = 5000;

const LAST_GOOD_HEALTH_KEY = 'cloud_health_last_good';

export interface CloudHealth {
  /** True only when the worker answered AND its D1 probe succeeded. */
  ok: boolean;
  /** 'ok' | 'error' | 'unconfigured' | 'unreachable' | 'unauthorized' */
  db: string;
  /**
   * Newest write timestamp the worker can see, when known.
   *
   * NEVER populated from /api/health: that endpoint is public and deliberately
   * carries no operational detail. It is filled from the authenticated
   * `fetchCloudLastWrite()` probe below.
   */
  lastWriteAt?: string | null;
  orderCount?: number | null;
  /** When the client completed this probe (ISO). */
  checkedAt: string;
  message?: string;
}

export async function checkCloudHealth(): Promise<CloudHealth> {
  const now = () => new Date().toISOString();
  const base = getWorkerUrl();

  if (!base) {
    return { ok: false, db: 'unconfigured', checkedAt: now() };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, db: 'unreachable', message: 'offline', checkedAt: now() };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    // No auth header on purpose: /api/health sits in front of the worker's
    // session gate so an expired session cannot masquerade as a dead database.
    const res = await fetch(`${base}/api/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON reply (HTML error page, proxy interstitial) — treat as down.
    }

    if (res.ok && body?.ok === true) {
      const health: CloudHealth = {
        ok: true,
        db: 'ok',
        // /api/health is public and returns no timestamp by design — the
        // marker comes from the authenticated fetchCloudLastWrite() probe.
        lastWriteAt: null,
        orderCount: typeof body.orderCount === 'number' ? body.orderCount : null,
        checkedAt: now(),
      };
      rememberGoodHealth(health);
      return health;
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, db: 'unauthorized', checkedAt: now() };
    }

    return {
      ok: false,
      db: body?.db || 'error',
      message: body?.message || `HTTP ${res.status}`,
      checkedAt: now(),
    };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      db: 'unreachable',
      message: aborted ? `timeout after ${HEALTH_TIMEOUT_MS}ms` : err?.message || 'fetch failed',
      checkedAt: now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Newest write the CLOUD can see, read from the session-protected /api/status.
 *
 * Why this exists: the settings badge and the red backup banner both fall back
 * to `syncService.getHealth().lastSuccessAt`, which is the high-water mark of
 * THIS device's local sync queue. A device that has only ever read — a freshly
 * opened page, a manager's phone — has an empty queue, so both surfaces read
 * "never" and, worse, the "backups are stale" branch could never be reached:
 * the alarm built to catch a silent backup failure only fired when the worker
 * was completely down.
 *
 * Returns null when the cloud is unreachable or the session is not valid. Null
 * means "unknown", never "fresh" — callers must not treat it as healthy.
 */
export async function fetchCloudLastWrite(): Promise<string | null> {
  try {
    const res = await cloudFetch('/api/status', { method: 'GET', timeoutMs: HEALTH_TIMEOUT_MS });
    if (!res || !res.ok) return null;
    const body: any = await res.json().catch(() => null);
    const value = body?.lastWriteAt;
    return typeof value === 'string' && value ? value : null;
  } catch (err) {
    console.warn('[cloud] last-write probe failed:', err);
    return null;
  }
}

function rememberGoodHealth(health: CloudHealth): void {
  try {
    localStorage.setItem(LAST_GOOD_HEALTH_KEY, JSON.stringify(health));
  } catch {
    // Storage full / disabled — the in-memory result is still returned.
  }
}

/**
 * The last probe that actually succeeded, or null.
 *
 * Persisted so a page reload does not reset the operator's view of when the
 * cloud was last confirmed healthy.
 */
export function getLastGoodHealth(): CloudHealth | null {
  try {
    const raw = localStorage.getItem(LAST_GOOD_HEALTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.checkedAt || Number.isNaN(new Date(parsed.checkedAt).getTime())) return null;
    return parsed as CloudHealth;
  } catch {
    return null;
  }
}
