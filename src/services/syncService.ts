import { IDBPDatabase } from 'idb';
import { getDB, SyncRecord, BrewMasterDBSchema } from '../repositories/indexeddb/db';

const CLOUDFLARE_WORKER_URL = import.meta.env.VITE_CLOUDFLARE_WORKER_URL || 'https://system333.hassanmamdouh461.workers.dev';

type DB = IDBPDatabase<BrewMasterDBSchema>;

// Exponential backoff config — bounded so we don't hammer a broken/dead endpoint.
const BASE_RETRY_MS = 30_000;      // first retry after ~30s
const MAX_RETRY_MS = 30 * 60_000;  // cap at 30 minutes between attempts
const MAX_ATTEMPTS = 50;           // give up after this many tries (records stay on disk)
// Keep successfully-synced records for this long before cleanup (audit window).
const SYNCED_RETENTION_MS = 24 * 60 * 60_1000; // 24 hours
// Run the cleanup sweep roughly every N sync cycles.
const CLEANUP_EVERY_N_RUNS = 10;

function computeBackoff(attempts: number): number {
  // 30s, 60s, 2m, 4m, ... capped at MAX_RETRY_MS
  const ms = BASE_RETRY_MS * Math.pow(2, attempts);
  return Math.min(ms, MAX_RETRY_MS);
}

export class SyncService {
  private isSyncing = false;
  private runCount = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      // Fire immediately when connectivity returns — orders that piled up
      // while offline start uploading as soon as the network is back.
      window.addEventListener('online', () => {
        console.log('[SyncService] Network restored. Triggering auto-sync...');
        this.syncPendingData();
      });

      // Periodic sweep — in addition to the online event, so background tabs
      // and full-page-refresh states still eventually drain the queue.
      setInterval(() => {
        if (navigator.onLine) {
          this.syncPendingData();
        }
      }, 30000);

      // Also flush right before the tab closes so any pending order that was
      // created just before navigation gets at least one upload attempt.
      window.addEventListener('pagehide', () => {
        // Best-effort; navigator.sendBeacon could be used for a pure-fire path
        // but we don't have a single-batch endpoint, so we just let the 30s
        // timer / next load handle it. The data is already safe on disk.
        this.syncPendingData();
      });

      // React to the document becoming visible again (e.g. user returns to the
      // tab after leaving it backgrounded for a while).
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) {
          this.syncPendingData();
        }
      });
    }
  }

  /**
   * Upload all due pending records. Safe to call repeatedly — concurrent calls
   * are guarded by `isSyncing`. Records that recently failed are skipped until
   * their `nextRetryAt` has passed (exponential backoff).
   */
  public async syncPendingData(): Promise<void> {
    if (this.isSyncing || typeof navigator === 'undefined' || !navigator.onLine) return;
    this.isSyncing = true;

    try {
      const db = await getDB();
      const allRecords: SyncRecord[] = await db.getAll('sync_queue');

      const now = Date.now();
      const due = allRecords.filter(r => {
        if (r.synced === 1) return false;            // already uploaded
        if (!r.nextRetryAt) return true;             // never tried — go now
        return new Date(r.nextRetryAt).getTime() <= now; // backoff elapsed
      });

      if (due.length === 0) {
        // Nothing to upload, but still run periodic cleanup.
        this.maybeCleanup(db, allRecords);
        return;
      }

      console.log(`[SyncService] Syncing ${due.length} pending items to Cloudflare D1...`);

      for (const record of due) {
        await this.uploadRecord(db, record);
      }

      this.maybeCleanup(db, allRecords);
    } catch (err) {
      console.error('[SyncService] Sync failed:', err);
    } finally {
      this.isSyncing = false;
    }
  }

  private async uploadRecord(db: DB, record: SyncRecord): Promise<void> {
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
        // Success — mark synced and stamp the time so cleanup can age it out later.
        record.synced = 1;
        record.syncedAt = new Date().toISOString();
        record.lastError = undefined;
        await db.put('sync_queue', record);
        return;
      }

      // Non-2xx — schedule a backoff retry rather than hammering every 30s.
      const body = await response.text().catch(() => '');
      await this.scheduleRetry(db, record, `HTTP ${response.status}: ${body.slice(0, 200)}`);
    } catch (err: any) {
      // Network failure (offline, DNS, CORS, etc.) — schedule a retry.
      await this.scheduleRetry(db, record, err?.message || String(err));
    }
  }

  private async scheduleRetry(db: DB, record: SyncRecord, errorMessage: string): Promise<void> {
    const attempts = (record.attempts || 0) + 1;
    record.attempts = attempts;
    record.lastError = errorMessage;

    if (attempts >= MAX_ATTEMPTS) {
      // Exhausted retries — leave it on disk (do NOT delete) so it can be
      // audited / retried manually later. Stop auto-scheduling, though.
      record.nextRetryAt = undefined; // picked up again only on a manual trigger
      console.warn(`[SyncService] Record ${record.id} gave up after ${attempts} attempts. Keeping on disk for audit. Last error: ${errorMessage}`);
    } else {
      const backoff = computeBackoff(attempts);
      record.nextRetryAt = new Date(Date.now() + backoff).toISOString();
      console.warn(`[SyncService] Record ${record.id} failed (attempt ${attempts}). Retry in ${Math.round(backoff / 1000)}s. Error: ${errorMessage}`);
    }

    await db.put('sync_queue', record);
  }

  /**
   * Periodically delete successfully-synced records older than the retention
   * window. Keeps `sync_queue` from growing unbounded (every order update
   * historically wrote a new row that was never removed).
   */
  private async maybeCleanup(db: DB, allRecords: SyncRecord[]): Promise<void> {
    this.runCount++;
    if (this.runCount % CLEANUP_EVERY_N_RUNS !== 0) return;

    const cutoff = Date.now() - SYNCED_RETENTION_MS;
    const tx = db.transaction('sync_queue', 'readwrite');
    const store = tx.objectStore('sync_queue');

    let removed = 0;
    for (const r of allRecords) {
      if (r.synced !== 1) continue;
      const when = r.syncedAt ? new Date(r.syncedAt).getTime() : new Date(r.timestamp).getTime();
      if (when < cutoff) {
        await store.delete(r.id);
        removed++;
      }
    }
    await tx.done;
    if (removed > 0) {
      console.log(`[SyncService] Cleanup: removed ${removed} old synced record(s).`);
    }
  }
}

export const syncService = new SyncService();
