import { withDB, SyncRecord } from '../repositories/indexeddb/db';
import {
  getWorkerUrl,
  getBranchIdHeader,
  getCsrfToken,
  ensureCloudSession,
  resetCloudSession,
  isCloudConfigured,
  roleIntentHeaders,
  reconcileSessionRole,
  getSessionRole,
  getRoleIntent,
} from './cloudConfig';
import { getRefundPin } from '../utils/refundPin';

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
          // Picks WHICH role-scoped session cookie the Worker authenticates
          // with, so a cashier tab in the same browser cannot make this
          // manager's queued writes execute as a cashier (403 → retired).
          ...roleIntentHeaders(),
        };
        const csrf = getCsrfToken();
        if (csrf) headers['X-CSRF-Token'] = csrf;
        // Refund escalation: an order record carries the held PIN so the Worker
        // permits refundedAt / refundReason changes (refund_requires_escalation).
        if (normalizeSyncType(record.type) === 'order') {
          const pin = (getRefundPin() || '').trim();
          if (pin) headers['X-Refund-PIN'] = pin;
        }
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
        // A 200 is NOT proof the row was written. When the Worker's freshness
        // guard rejects the conflict update it answers
        // `200 { success: true, stale: true }` and D1 keeps the OLD row. Acking
        // the queue row here retired writes that never landed — a cash payment
        // stayed "Unpaid" in the cloud forever while the till showed it paid.
        // The direct-upsert path already reported this (cloudUpsertWithOutcome);
        // the queue path did not. Keep it retryable and surface it instead.
        const stale = await response
          .clone()
          .json()
          .then((b: any) => b?.stale === true)
          .catch(() => false);
        if (stale) {
          const msg =
            'الكتابة اترفضت من السيرفر لوجود نسخة أحدث — لسه بيحاول (لم تُحفظ في السحاب)';
          this.lastError = msg;
          console.warn(
            '[SyncService] Write discarded by the server freshness guard:',
            record.type,
            record.action,
            record.data?.id
          );
          await this.scheduleRetry(record, msg);
          return;
        }
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

      // A 403 that is NOT a CSRF failure is a DETERMINISTIC, per-record permission
      // denial from the server-side matrix (cloudflare-worker/src/permissions.ts):
      // retrying the identical payload can only fail again. Retire it immediately
      // with an operator-readable reason instead of burning retries and stalling
      // every legitimate record queued behind it. (CSRF-failed 403s were already
      // re-minted + retried above and fall through to normal backoff here.)
      const csrfFailed = response.headers.get('X-CSRF-Failed') === '1';
      if (response.status === 403 && !csrfFailed) {
        const reason = this.extractServerMessage(errBody);
        const msg = reason || 'العملية غير مسموحة بصلاحيتك الحالية (403)';
        this.lastError = msg;
        console.warn(
          '[SyncService] Write refused by server permissions:',
          record.type,
          record.action,
          msg
        );
        // settled_order_immutable is NOT a true permission denial: it means the
        // order was settled on ANOTHER device (e.g. paid at the cashier) while
        // this device still holds an older pending edit. Killing the record here
        // would silently drop the local change forever. Keep it retryable as a
        // conflict instead — once hydration pulls the settled remote row,
        // mergeOrderRecords latches the Paid/Refunded state and the stale write
        // becomes a harmless no-op (or is legitimately re-pushable if the order
        // is re-opened). Every other 403 stays a deterministic per-record denial.
        const code = this.extractServerCode(errBody);
        if (code === 'settled_order_immutable') {
          await this.scheduleRetry(record, msg);
          return;
        }

        // A denial is only "deterministic" if we were authenticated as the role
        // the operator is actually signed in as. Cookies are per-DOMAIN, so a
        // cashier login in a sibling tab (or a lapsed manager cookie, or the
        // legacy shared cookie) could make a MANAGER's queued write execute as a
        // cashier — the till then reported
        //   "تعديل المنيو والوصفات غير مسموح لصلاحية الكاشير"
        // and this branch retired the record forever, so the manager's menu
        // delete never reached D1 and no other device ever learned about it.
        // Reconcile the session against the declared role first: if it was wrong
        // and we repaired it, this record is retryable, not dead.
        const intent = getRoleIntent();
        if (intent) {
          const roleBefore = getSessionRole();
          const repaired = await reconcileSessionRole();
          if (repaired && roleBefore !== intent && getSessionRole() === intent) {
            console.warn(
              '[SyncService] 403 was a role mismatch (session was',
              roleBefore,
              '→ re-minted as',
              intent,
              ') — keeping the record queued for retry.'
            );
            await this.scheduleRetry(record, msg);
            return;
          }
        }

        await this.retirePermanently(record, msg);
        return;
      }

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

  /** Pull the worker's machine-readable `code` out of a JSON error body. */
  private extractServerCode(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      const code = parsed?.code;
      return typeof code === 'string' && code.trim() ? code.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Retire a record that can never succeed as-is (a permission denial).
   *
   * Marked dead WITHOUT consuming retry attempts, so it shows up in the `failed`
   * count in getHealth() and the operator can see exactly why in `lastError`,
   * while the rest of the queue keeps flowing. A manual reset can re-arm it once
   * the device is authenticated with the right role.
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
