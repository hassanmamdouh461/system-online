import { withDB, SyncRecord } from '../repositories/indexeddb/db';
import {
  getWorkerUrl,
  buildCloudHeaders,
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
        // this.lastSuccessAt only covers writes made since this tab loaded, so
        // after a refresh it is null and a caller cannot tell "never synced"
        // apart from "synced five minutes ago". syncedAt is already persisted on
        // every successful record, so recover the real high-water mark from the
        // queue and keep whichever is newer.
        let lastSuccessAt = this.lastSuccessAt;
        for (const r of all) {
          if (r.synced === 1 && r.syncedAt) {
            if (
              !lastSuccessAt ||
              new Date(r.syncedAt).getTime() > new Date(lastSuccessAt).getTime()
            ) {
              lastSuccessAt = r.syncedAt;
            }
          }
        }
        return {
          configured: !!workerUrl,
          workerUrl,
          online: typeof navigator !== 'undefined' ? navigator.onLine : false,
          pending,
          failed,
          lastError: lastErr || null,
          lastSuccessAt,
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
      const response = await fetch(`${workerUrl}/api/sync`, {
        method: 'POST',
        headers: buildCloudHeaders(),
        body: JSON.stringify({
          type: normalizeSyncType(record.type),
          action: record.action,
          data: record.data,
          timestamp: record.timestamp,
        }),
      });

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

      const body = await response.text().catch(() => '');

      // 403 = the server-side permission matrix refused this specific write
      // (see cloudflare-worker/src/permissions.ts). It is DETERMINISTIC and
      // per-record: retrying the identical payload can only fail again.
      //
      // Treating it like a transient error would be actively harmful — the old
      // branch below disables the worker for 5 minutes and burns 15 retries,
      // so one forbidden record would stall the sync of every LEGITIMATE
      // record behind it. Instead it is retired immediately with an
      // operator-readable reason, and the connection is left alone.
      if (response.status === 403) {
        const reason = this.extractServerMessage(body);
        const msg = reason || 'العملية غير مسموحة بصلاحيتك الحالية (403)';
        this.lastError = msg;
        console.warn('[SyncService] Write refused by server permissions:', record.type, record.action, msg);
        await this.retirePermanently(record, msg);
        return;
      }

      const msg = `HTTP ${response.status}: ${body.slice(0, 200)}`;
      this.lastError = msg;
      if (response.status === 401 || response.status === 404) {
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

  /** Pull the worker's Arabic `message` out of a JSON error body. */
  private extractServerMessage(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      const msg = parsed?.message;
      return typeof msg === 'string' && msg.trim() ? msg.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Retire a record that can never succeed as-is (a permission denial).
   *
   * Marked dead WITHOUT consuming retry attempts, so it shows up in the
   * `failed` count in getHealth() and the operator can see exactly why in
   * `lastError`, while the rest of the queue keeps flowing. `resetDeadRecords`
   * can re-arm it once the device is given the right key.
   */
  private async retirePermanently(record: SyncRecord, errorMessage: string): Promise<void> {
    await withDB(async (db) => {
      record.lastError = errorMessage;
      record.nextRetryAt = undefined;
      record.dead = true;
      await db.put('sync_queue', record);
    });
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
