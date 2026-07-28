/**
 * Central Cloudflare Worker configuration for web + Electron.
 * Never fall back to the SPA origin (pos.engaz.tech) — that is not the D1 worker.
 */

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

export function getWorkerUrl(): string {
  const fromEnv = cleanUrl(import.meta.env.VITE_CLOUDFLARE_WORKER_URL as string | undefined);
  if (fromEnv) return fromEnv;

  if (typeof window !== 'undefined') {
    try {
      const stored = cleanUrl(localStorage.getItem('brewmaster_d1_worker_url'));
      if (stored) return stored;
    } catch {
      // ignore
    }
  }
  return '';
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
    if (!base) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    // No credential ⇒ cannot mint (no anonymous sessions). Ride any existing cookie.
    if (!sessionCredential) return false;
    try {
      const res = await fetch(`${base}${SESSION_PATH}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: sessionCredential }),
      });
      if (!res.ok) {
        advanceMintCooldown();
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
      return true;
    } catch (err) {
      console.warn('[cloud] session mint failed:', err);
      advanceMintCooldown();
      return false;
    }
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
 * Immediate upsert to D1 (Cloud-first path).
 * Returns true on success, false on offline/failure (caller should queue).
 */
export async function cloudUpsert(
  collection: string,
  id: string,
  data: Record<string, any>
): Promise<boolean> {
  if (!id) return false;
  const payload: Record<string, any> = { ...data, id };
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
    if (!res) return false;
    if (!res.ok) {
      console.warn(`[cloud] UPSERT ${collection}/${id} failed: HTTP ${res.status}`);
      return false;
    }
    // Best-effort: clear pending queue rows for this entity so SyncStatus stays honest
    void ackSyncQueueForEntity(id);
    return true;
  } catch (err) {
    console.warn(`[cloud] UPSERT ${collection}/${id} error:`, err);
    return false;
  }
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
    return res.ok;
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
  /** Newest write timestamp the worker can see, when known. */
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
        lastWriteAt: body.lastWriteAt ?? null,
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
