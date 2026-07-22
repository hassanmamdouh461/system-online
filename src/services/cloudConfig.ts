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
  const fromEnv = String(import.meta.env.VITE_CLOUDFLARE_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined') {
    try {
      return String(localStorage.getItem('brewmaster_d1_api_key') || '').trim();
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Branch header for cloud requests.
 * Manager sessions must send "manager" so the worker returns ALL branches.
 * Cashier / default config normalize to main_branch (D1 source of truth).
 */
export function getBranchIdHeader(): string {
  if (typeof window === 'undefined') return 'main_branch';
  try {
    // Prefer live auth session (manager vs cashier)
    const sessionRaw =
      localStorage.getItem('auth_session_system_online') ||
      sessionStorage.getItem('auth_session_system_online');
    if (sessionRaw) {
      const session = JSON.parse(sessionRaw);
      const bid = session?.branch?.branchId || session?.user?.role;
      if (bid === 'manager' || session?.user?.role === 'manager') return 'manager';
      if (bid && bid !== 'all') {
        return normalizeBranchId(String(bid));
      }
    }

    const standalone = localStorage.getItem('branch_id');
    if (standalone) return normalizeBranchId(standalone);

    const raw = localStorage.getItem('brewmaster_branch_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.branchId) return normalizeBranchId(String(parsed.branchId));
    }
  } catch {
    // ignore
  }
  return 'main_branch';
}

/** Map legacy aliases so default/branch_1 write & read as main_branch family */
export function normalizeBranchId(branchId: string): string {
  const b = String(branchId || '').trim();
  if (!b || b === 'default' || b === 'branch_1') return 'main_branch';
  return b;
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

export async function cloudGetCollection(collection: string): Promise<any[] | null> {
  try {
    const res = await cloudFetch(
      `/v1/databases/default/collections/${collection}/documents`,
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
 * Immediate upsert to D1 (Cloud-first path).
 * Returns true on success, false on offline/failure (caller should queue).
 */
export async function cloudUpsert(
  collection: string,
  id: string,
  data: Record<string, any>
): Promise<boolean> {
  if (!id) return false;
  // Never persist manager/all as a real branch on write payloads
  const payload: Record<string, any> = { ...data, id };
  const bid = payload.branchId || payload.branch_id;
  if (bid === 'manager' || bid === 'all' || bid === '*') {
    delete payload.branchId;
    delete payload.branch_id;
  }
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
        // Match entity id, or queue ids like sync_<entityId> / sync_menu_<entityId>_...
        const related =
          rid === entityId ||
          rec.id === `sync_${entityId}` ||
          rec.id.includes(`_${entityId}`) ||
          rec.id.includes(`${entityId}_`);
        if (!related) continue;
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
