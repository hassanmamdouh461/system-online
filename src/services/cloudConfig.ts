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
 * Cloud session (cookie-based auth).
 *
 * There is NO operator-entered API key anymore. The old key lived in
 * localStorage and was written by a Settings → Cloud Sync box that got deleted,
 * so the key went permanently blank and every request 401'd (backup 100% dead).
 *
 * Instead, the Worker mints an HttpOnly session cookie at POST /v1/session. We
 * establish it automatically on the first cloud call and re-mint on a 401, so
 * every request just carries the cookie via `credentials: 'include'`. Because
 * the cookie is HttpOnly it is invisible to this code — we only track whether a
 * mint has succeeded this page-load, and never touch the token itself.
 */
const SESSION_PATH = '/v1/session';
let sessionPromise: Promise<boolean> | null = null;

/**
 * Ensure a cloud session cookie exists. Concurrent callers share one in-flight
 * mint. A failed mint is not cached, so the next call retries. Pass force=true
 * to discard any cached result and mint anew (used after a 401 / on login).
 */
export function ensureCloudSession(force = false): Promise<boolean> {
  if (force) sessionPromise = null;
  if (sessionPromise) return sessionPromise;

  const p = (async (): Promise<boolean> => {
    const base = getWorkerUrl();
    if (!base) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    try {
      const res = await fetch(`${base}${SESSION_PATH}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      return res.ok;
    } catch (err) {
      console.warn('[cloud] session mint failed:', err);
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

/** Drop the server session cookie (called on logout). Best-effort. */
export async function clearCloudSession(): Promise<void> {
  sessionPromise = null;
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

  const headers = cloudHeaders(init?.headers as Record<string, string> | undefined);

  // Single attempt with its own abort timer. Credentials are included so the
  // HttpOnly session cookie rides along on every cloud request.
  const attempt = async (): Promise<Response | null> => {
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

  // Session missing/expired → re-mint once and retry the request a single time.
  if (!skipSession && res && res.status === 401) {
    resetCloudSession();
    const ok = await ensureCloudSession(true);
    if (ok) res = await attempt();
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
