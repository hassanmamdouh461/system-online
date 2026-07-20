import { getDB, SyncRecord } from '../repositories/indexeddb/db';

const CLOUDFLARE_WORKER_URL = import.meta.env.VITE_CLOUDFLARE_WORKER_URL || 'https://system333.hassanmamdouh461.workers.dev';

export class SyncService {
  private isSyncing = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[SyncService] Network restored. Triggering auto-sync...');
        this.syncPendingData();
      });

      // Periodically sync every 30 seconds if online
      setInterval(() => {
        if (navigator.onLine) {
          this.syncPendingData();
        }
      }, 30000);
    }
  }

  public async syncPendingData(): Promise<void> {
    if (this.isSyncing || !navigator.onLine) return;
    this.isSyncing = true;

    try {
      const db = await getDB();
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      const allRecords: SyncRecord[] = await store.getAll();

      const pending = allRecords.filter(r => r.synced === 0);
      if (pending.length === 0) {
        this.isSyncing = false;
        return;
      }

      console.log(`[SyncService] Syncing ${pending.length} pending items to Cloudflare D1...`);

      for (const record of pending) {
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
            await db.put('sync_queue', record);
          } else {
            console.warn(`[SyncService] Worker response not ok for record ${record.id}:`, await response.text());
          }
        } catch (err) {
          console.error(`[SyncService] Error syncing record ${record.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[SyncService] Sync failed:', err);
    } finally {
      this.isSyncing = false;
    }
  }
}

export const syncService = new SyncService();
