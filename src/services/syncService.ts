import { IDBPDatabase } from 'idb';
import { getDB, SyncRecord, BrewMasterDBSchema } from '../repositories/indexeddb/db';

const CLOUDFLARE_WORKER_URL = import.meta.env.VITE_CLOUDFLARE_WORKER_URL || '';

type DB = IDBPDatabase<BrewMasterDBSchema>;

// Exponential backoff config — bounded so we don't hammer a broken/dead endpoint.
const BASE_RETRY_MS = 60_000;      // first retry after ~60s
const MAX_RETRY_MS = 60 * 60_000;  // cap at 60 minutes between attempts
const MAX_ATTEMPTS = 10;           // give up after 10 tries

const SYNCED_RETENTION_MS = 24 * 60 * 60_1000; // 24 hours

function computeBackoff(attempts: number): number {
  const ms = BASE_RETRY_MS * Math.pow(2, attempts);
  return Math.min(ms, MAX_RETRY_MS);
}

export class SyncService {
  private isSyncing = false;
  private workerDisabled = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.workerDisabled = false;
        this.syncPendingData();
      });

      // Periodic trigger (every 2 minutes)
      setInterval(() => {
        this.syncPendingData();
      }, 120_000);
    }
  }

  public async syncPendingData(): Promise<void> {
    if (!CLOUDFLARE_WORKER_URL || this.workerDisabled || this.isSyncing || typeof navigator === 'undefined' || !navigator.onLine) {
      return;
    }
    this.isSyncing = true;

    try {
      const db = await getDB();
      const allRecords: SyncRecord[] = await db.getAll('sync_queue');

      const now = Date.now();
      const due = allRecords.filter(r => {
        if (r.synced === 1) return false;
        if (!r.nextRetryAt) return true;
        return new Date(r.nextRetryAt).getTime() <= now;
      });

      if (due.length === 0) {
        this.maybeCleanup(db, allRecords);
        return;
      }

      for (const record of due) {
        await this.uploadRecord(db, record);
      }

      this.maybeCleanup(db, allRecords);
    } catch (err) {
      // Quiet catch
    } finally {
      this.isSyncing = false;
    }
  }

  private async uploadRecord(db: DB, record: SyncRecord): Promise<void> {
    if (!CLOUDFLARE_WORKER_URL) return;

    try {
      const response = await fetch(`${CLOUDFLARE_WORKER_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: record.type,
          action: record.action,
          data: record.data,
          timestamp: record.timestamp,
        }),
      });

      if (response.ok) {
        record.synced = 1;
        record.syncedAt = new Date().toISOString();
        record.lastError = undefined;
        await db.put('sync_queue', record);
        this.workerDisabled = false;
        return;
      }

      const body = await response.text().catch(() => '');
      await this.scheduleRetry(db, record, `HTTP ${response.status}: ${body.slice(0, 100)}`);
    } catch (err: any) {
      // CORS / Network failure — mark worker temporarily disabled to stop spamming console
      this.workerDisabled = true;
      await this.scheduleRetry(db, record, err?.message || 'Cloudflare D1 sync endpoint unavailable');
    }
  }

  private async scheduleRetry(db: DB, record: SyncRecord, errorMessage: string): Promise<void> {
    const attempts = (record.attempts || 0) + 1;
    record.attempts = attempts;
    record.lastError = errorMessage;

    if (attempts >= MAX_ATTEMPTS) {
      record.nextRetryAt = undefined;
    } else {
      const backoff = computeBackoff(attempts);
      record.nextRetryAt = new Date(Date.now() + backoff).toISOString();
    }

    await db.put('sync_queue', record);
  }

  private async maybeCleanup(db: DB, allRecords: SyncRecord[]): Promise<void> {
    try {
      const cutoff = Date.now() - SYNCED_RETENTION_MS;
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');

      for (const r of allRecords) {
        if (r.synced !== 1) continue;
        const when = r.syncedAt ? new Date(r.syncedAt).getTime() : new Date(r.timestamp).getTime();
        if (when < cutoff) {
          await store.delete(r.id);
        }
      }
      await tx.done;
    } catch {
      // Ignore cleanup error
    }
  }
}

export const syncService = new SyncService();
