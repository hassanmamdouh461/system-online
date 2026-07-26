import { withDB, SyncRecord } from '../repositories/indexeddb/db';
import {
  getWorkerUrl,
  getBranchIdHeader,
  getCsrfToken,
  ensureCloudSession,
  resetCloudSession,
  isCloudConfigured,
} from './cloudConfig';

const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 30 * 60_000;
const MAX_ATTEMPTS = 15;
const SYNCED_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Normalize legacy/singular type names to worker ALLOWED_TABLE_MAP keys */
function normalizeSyncType(type: string): string {
  const map: Record<string, string> = {
    order: 'order',
    orders: 'order',
    menu: 'menu',
    menu_items: 'menu',
    customer: 'customer',
    customers: 'customer',
    company: 'company',
    companies: 'company',
    inventory: 'inventory',
    setting: 'settings',
    settings: 'settings',
    recipe: 'recipes',
    recipes: 'recipes',
    inventory_transaction: 'inventory_transactions',
    inventory_transactions: 'inventory_transactions',
    snapshot: 'snapshots',
    snapshots: 'snapshots',
  };
  return map[type] || type;
}

function computeBackoff(attempts: number): number {
  const ms = BASE_RETRY_MS * Math.pow(2, Math.min(attempts, 8));
  return Math.min(ms, MAX_RETRY_MS);
}

export type SyncHealth = {
  configured: boolean;
  workerUrl: string;
  online: boolean;
  pending: number;
  failed: number;
  lastError: string | null;
  lastSuccessAt: string | null;
};

export class SyncService {
  private isSyncing = false;
  private workerDisabled = false;
  private disabledUntil = 0;
  private resetDisabledTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.enableWorker();
        void this.syncPendingData();
      });
      setInterval(() => {
        void this.syncPendingData();
      }, 60_000);
    }
  }

  private enableWorker() {
    // Respect active backoff: a 401/403/404 sets disabledUntil 5min ahead.
    // Only re-enable once that window has elapsed OR a human forced online.
    if (this.disabledUntil > Date.now()) return;
    this.workerDisabled = false;
    this.disabledUntil = 0;
    if (this.resetDisabledTimer) {
      clearTimeout(this.resetDisabledTimer);
      this.resetDisabledTimer = null;
    }
  }

  private disableWorkerTemporarily(ms = 120_000) {
    this.workerDisabled = true;
    this.disabledUntil = Date.now() + ms;
    if (!this.resetDisabledTimer) {
      this.resetDisabledTimer = setTimeout(() => {
        this.enableWorker();
      }, ms);
    }
  }

  public isConfigured(): boolean {
    return isCloudConfigured();
  }

  public async getHealth(): Promise<SyncHealth> {
    const workerUrl = getWorkerUrl();
    try {
      return await withDB(async (db) => {
        const all = await db.getAll('sync_queue');
        const open = all.filter((r) => r.synced !== 1);
        const pending = open.filter((r) => !r.dead && (r.attempts || 0) < MAX_ATTEMPTS).length;
        const failed = open.filter((r) => r.dead || (r.attempts || 0) >= MAX_ATTEMPTS).length;
        const lastErr =
          open.map((r) => r.lastError).filter(Boolean).slice(-1)[0] || this.lastError;
        return {
          configured: !!workerUrl,
          workerUrl,
          online: typeof navigator !== 'undefined' ? navigator.onLine : false,
          pending,
          failed,
          lastError: lastErr || null,
          lastSuccessAt: this.lastSuccessAt,
        };
      });
    } catch {
      return {
        configured: !!workerUrl,
        workerUrl,
        online: typeof navigator !== 'undefined' ? navigator.onLine : false,
        pending: 0,
        failed: 0,
        lastError: this.lastError,
        lastSuccessAt: this.lastSuccessAt,
      };
    }
  }

  public async syncPendingData(): Promise<void> {
    const workerUrl = getWorkerUrl();
    if (
      !workerUrl ||
      this.workerDisabled ||
      this.isSyncing ||
      typeof navigator === 'undefined' ||
      !navigator.onLine
    ) {
      return;
    }
    this.isSyncing = true;

    try {
      const due = await withDB(async (db) => {
        const allRecords = await db.getAll('sync_queue');
        const now = Date.now();
        return allRecords.filter((r) => {
          if (r.synced === 1) return false;
          if (r.dead) return false;
          if (!r.nextRetryAt) return true;
          return new Date(r.nextRetryAt).getTime() <= now;
        });
      });

      if (due.length === 0) {
        await this.maybeCleanup();
        return;
      }

      for (const record of due) {
        await this.uploadRecord(record, workerUrl);
      }

      await this.maybeCleanup();
    } catch (err) {
      console.error('[SyncService] Background sync operation failed:', err);
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.isSyncing = false;
    }
  }

  private async uploadRecord(record: SyncRecord, workerUrl: string): Promise<void> {
    // Direct callers must also respect active backoff — don't hammer the worker
    // when we've just received 401/403/404.
    if (this.workerDisabled || this.disabledUntil > Date.now()) return;
    try {
      const body = JSON.stringify({
        type: normalizeSyncType(record.type),
        action: record.action,
        data: record.data,
        timestamp: record.timestamp,
      });
      // Auth rides an HttpOnly session cookie (credentials: 'include') — no key
      // header anymore. Writes also carry the CSRF double-submit token. Establish
      // the session first, and if it lapsed (401) or the CSRF token was stale
      // (403 X-CSRF-Failed) re-mint once and retry this record before backing off.
      const post = async () => {
        await ensureCloudSession();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Branch-ID': getBranchIdHeader(),
        };
        const csrf = getCsrfToken();
        if (csrf) headers['X-CSRF-Token'] = csrf;
        return fetch(`${workerUrl}/api/sync`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body,
        });
      };

      let response = await post();
      const csrfStale = response.status === 403 && response.headers.get('X-CSRF-Failed') === '1';
      if (response.status === 401 || csrfStale) {
        resetCloudSession();
        if (await ensureCloudSession(true)) {
          response = await post();
        }
      }

      if (response.ok) {
        await withDB(async (db) => {
          record.synced = 1;
          record.syncedAt = new Date().toISOString();
          record.lastError = undefined;
          delete record.dead;
          await db.put('sync_queue', record);
        });
        this.enableWorker();
        this.lastSuccessAt = record.syncedAt || new Date().toISOString();
        this.lastError = null;
        return;
      }

      const errBody = await response.text().catch(() => '');
      const msg = `HTTP ${response.status}: ${errBody.slice(0, 200)}`;
      this.lastError = msg;
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        this.disableWorkerTemporarily(300_000);
      }
      await this.scheduleRetry(record, msg);
    } catch (err: any) {
      this.disableWorkerTemporarily();
      const msg = err?.message || 'Cloudflare D1 sync endpoint unavailable';
      this.lastError = msg;
      await this.scheduleRetry(record, msg);
    }
  }

  private async scheduleRetry(record: SyncRecord, errorMessage: string): Promise<void> {
    await withDB(async (db) => {
      const attempts = (record.attempts || 0) + 1;
      record.attempts = attempts;
      record.lastError = errorMessage;
      if (attempts >= MAX_ATTEMPTS) {
        record.nextRetryAt = undefined;
        record.dead = true;
      } else {
        record.nextRetryAt = new Date(Date.now() + computeBackoff(attempts)).toISOString();
      }
      await db.put('sync_queue', record);
    });
  }

  public async resetDeadRecords(): Promise<number> {
    try {
      return await withDB(async (db) => {
        const allRecords = await db.getAll('sync_queue');
        const deadRecords = allRecords.filter(
          (r) => r.dead || (r.attempts && r.attempts >= MAX_ATTEMPTS)
        );
        for (const record of deadRecords) {
          record.attempts = 0;
          delete record.dead;
          record.nextRetryAt = new Date().toISOString();
          await db.put('sync_queue', record);
        }
        this.enableWorker();
        void this.syncPendingData();
        return deadRecords.length;
      });
    } catch (err) {
      console.error('[SyncService] Failed to reset dead sync records:', err);
      return 0;
    }
  }

  private async maybeCleanup(): Promise<void> {
    try {
      await withDB(async (db) => {
        const allRecords = await db.getAll('sync_queue');
        const cutoff = Date.now() - SYNCED_RETENTION_MS;
        const tx = db.transaction('sync_queue', 'readwrite');
        for (const r of allRecords) {
          if (r.synced !== 1) continue;
          const when = r.syncedAt
            ? new Date(r.syncedAt).getTime()
            : new Date(r.timestamp).getTime();
          if (when < cutoff) await tx.store.delete(r.id);
        }
        await tx.done;
      });
    } catch (err) {
      console.error('[SyncService] Cleanup error:', err);
    }
  }
}

export const syncService = new SyncService();
