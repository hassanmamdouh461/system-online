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

export function getApiKey(): string {
  // SECURITY: API key must NEVER be read from import.meta.env (VITE_* vars are
  // inlined into the client bundle and would leak to any user opening devtools).
  // The key is stored only in localStorage and entered by the operator via
  // Settings → Cloud Sync. Electron reads it directly from the .env file.
  if (typeof window !== 'undefined') {
    try {
      return String(localStorage.getItem('brewmaster_d1_api_key') || '').trim();
    } catch {
      return '';
    }
  }
  return '';
}

/** Persist the Cloudflare Worker API key to localStorage only (never bundled). */
export function setApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = String(key || '').trim();
    if (trimmed) {
      localStorage.setItem('brewmaster_d1_api_key', trimmed);
    } else {
      localStorage.removeItem('brewmaster_d1_api_key');
    }
  } catch {
    // ignore
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
 * SINGLE-BRANCH SYSTEM.
 * One store: the cashier side and the manager dashboard read the exact same
 * data. There is no branch selection, no per-branch scoping, and no "manager
 * sees all branches" special case — there is only ever one branch.
 *
 * This constant is the single source of truth for the branch_id column that
 * still exists in the schema for back-compat.
 */
export const BRANCH_ID = 'main_branch';

/** Branch header for cloud requests — always the one constant. */
export function getBranchIdHeader(): string {
  return BRANCH_ID;
}

export function isCloudConfigured(): boolean {
  return !!getWorkerUrl();
}

export function buildCloudHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Branch-ID': getBranchIdHeader(),
    ...extra,
  };
  const key = getApiKey();
  if (key) {
    headers['Authorization'] = `Bearer ${key}`;
    headers['X-API-Key'] = key;
  }
  return headers;
}

/** Parse number from cloud payloads without turning null into 0. */
export function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function cloudFetch(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response | null> {
  const base = getWorkerUrl();
  if (!base) return null;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    ...buildCloudHeaders(),
    ...(init?.headers as Record<string, string> | undefined),
  };

  try {
    const { timeoutMs: _t, signal: _s, ...rest } = init || {};
    return await fetch(url, {
      ...rest,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    console.warn('[cloudFetch] failed:', path, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Page size requested per round-trip; must be <= the worker's MAX_PAGE_LIMIT. */
const CLOUD_PAGE_SIZE = 1000;
/** Hard stop so a bad `hasMore` can never spin forever. */
const CLOUD_MAX_PAGES = 200;

/**
 * Fetch a whole collection, following the worker's pagination.
 *
 * The worker caps every response (it will not dump an entire table anymore), so
 * we loop until it reports `hasMore: false`. Older workers that return no
 * pagination metadata simply yield one page and stop — same behaviour as before.
 */
export async function cloudGetCollection(collection: string): Promise<any[] | null> {
  const all: any[] = [];
  let offset = 0;

  for (let page = 0; page < CLOUD_MAX_PAGES; page++) {
    try {
      const res = await cloudFetch(
        `/v1/databases/default/collections/${collection}/documents?limit=${CLOUD_PAGE_SIZE}&offset=${offset}`,
        { method: 'GET', timeoutMs: DEFAULT_TIMEOUT_MS }
      );
      if (!res) return page === 0 ? null : all;
      if (!res.ok) {
        console.warn(`[cloud] GET ${collection} failed: HTTP ${res.status}`);
        return page === 0 ? null : all;
      }
      const json = await res.json();
      const docs = Array.isArray(json?.documents) ? json.documents : [];
      all.push(...docs);

      // Stop when the worker says there is nothing left, or when it returned a
      // short/unpaginated page (legacy worker, or final page).
      if (json?.hasMore !== true || docs.length === 0) return all;
      offset += docs.length;
    } catch (err) {
      console.warn(`[cloud] GET ${collection} error:`, err);
      return offset === 0 ? null : all;
    }
  }

  console.warn(`[cloud] GET ${collection} hit page cap (${CLOUD_MAX_PAGES})`);
  return all;
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
  // Single-branch: always stamp the one constant. The worker enforces this too.
  payload.branch_id = BRANCH_ID;
  payload.branchId = BRANCH_ID;
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
        // EXACT match on the queued payload id only.
        //
        // This used to also substring-match the queue row's own id
        // (`rec.id.includes('_' + entityId)`), which meant syncing order
        // "ord_12" would also mark "ord_123"'s pending row as synced — that row
        // then never reached D1 and was pruned after 24h, silently losing a
        // paid order. Never widen this condition.
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
