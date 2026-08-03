/**
 * Cloud-durable settings: localStorage cache + Cloudflare D1 source of truth.
 * Keys are namespaced per branch: `${branchId}::${key}`
 */
import {
  cloudGetCollection,
  cloudUpsert,
  cloudSyncNow,
  getBranchIdHeader,
  getSessionRole,
  isCloudConfigured,
  refreshCloudSessionRole,
} from './cloudConfig';
import { withDB, enqueueWrite, SyncRecord } from '../repositories/indexeddb/db';
import { syncService } from './syncService';

/**
 * Settings that must survive browser wipe (synced to Cloudflare D1).
 *
 * TELEGRAM: `brewmaster_telegram_config` is deliberately NOT here. It embeds
 * the bot token, and the generic persist/hydrate path stores values verbatim
 * — so it would land in D1 as PLAINTEXT readable (server-side) by any manager
 * session. Instead it flows through a dedicated encrypted channel
 * (services/telegramCloudService + utils/secretBox): setTelegramConfig calls
 * persistTelegramConfigToCloud (encrypt-then-push) and cloudHydrate calls
 * hydrateTelegramConfigFromCloud (pull-then-decrypt). The legacy flat keys
 * (_bot_token / _chat_id) stay device-local mirrors.
 *
 * The credential HASHES (admin/manager creds, admin PIN) DO stay here: the Worker
 * needs them in D1 to verify passwords server-side (auth.ts resolvePasswordRole)
 * and other devices hydrate them to log in. They are PBKDF2-100k hashes, and the
 * Worker blocks cashier reads of them (permissions.ts read filter).
 */
export const DURABLE_SETTING_KEYS = [
  'brewmaster_tax_rate',
  'brewmaster_admin_creds_v2',
  'brewmaster_manager_creds_v1',
  'brewmaster_admin_pin',
  'brewmaster_branch_config',
  'brewmaster_store_config',
  'brewmaster_language',
  'pos_tables_list',
  'pos_staff_list',
  'removed_menu_categories',
  'custom_menu_categories',
] as const;


export type DurableSettingKey = (typeof DURABLE_SETTING_KEYS)[number];

/**
 * Settings keys the server refuses to let a non-manager write.
 *
 * MUST stay in sync with CASHIER_FORBIDDEN_SETTING_KEYS in
 * cloudflare-worker/src/permissions.ts. The Worker returns a hard 403
 * (`cashier_sensitive_setting`) for any of these written by a cashier session,
 * so a cashier till that keeps pushing them only spams the console with 403s and
 * fills the sync queue with dead, un-retryable rows — which then light up the
 * SyncStatus "failed" badge even though real order/payment sync is perfectly
 * healthy. We gate them client-side so only a manager session ever tries.
 */
export const MANAGER_ONLY_SETTING_KEYS: readonly string[] = [
  'brewmaster_admin_creds_v2',
  'brewmaster_manager_creds_v1',
  'brewmaster_admin_pin',
  'brewmaster_tax_rate',
  'brewmaster_store_config',
  'brewmaster_branch_config',
  'brewmaster_telegram_config',
  'brewmaster_telegram_bot_token',
  'brewmaster_telegram_chat_id',
];

/**
 * May the CURRENT session push this setting key to the cloud?
 *
 * Manager-only keys are pushed only when the established session role is
 * `manager`. A cashier session — or one that has not minted a role yet (null) —
 * skips them: the server would answer 403 regardless, and a manager device owns
 * that write. Non-sensitive keys (language, tables, categories) are always
 * allowed. The value is still written to localStorage by the caller; we only
 * suppress the doomed cloud round-trip.
 */
export function canPushSettingKey(key: string): boolean {
  if (!MANAGER_ONLY_SETTING_KEYS.includes(key)) return true;
  return getSessionRole() === 'manager';
}

/**
 * Async form of canPushSettingKey — use this on any real save path.
 *
 * The synchronous version reads the IN-MEMORY session role, which is null after
 * every page reload: the 12h HttpOnly cookie survives a refresh but the role
 * does not. A manager who reloaded and then edited the tax rate therefore hit
 * `getSessionRole() === null` and the cloud push was skipped SILENTLY — the
 * value stayed in localStorage, D1 kept the old copy, and the next hydrate
 * reverted the field. Ask the Worker (GET /v1/session reads the cookie) before
 * concluding that this session may not push.
 */
export async function ensureCanPushSettingKey(key: string): Promise<boolean> {
  if (!MANAGER_ONLY_SETTING_KEYS.includes(key)) return true;
  const known = getSessionRole();
  if (known === 'manager') return true;
  if (known === 'cashier') return false;
  // Role not established in this page-load — probe the cookie instead of
  // assuming the worst.
  return (await refreshCloudSessionRole()) === 'manager';
}

/**
 * How a persistSetting call actually ended up. The UI must be able to tell
 * "saved everywhere" from "saved on this device only", because the two behave
 * very differently on the next hydrate.
 */
export type PersistOutcome =
  /** Written to D1 and confirmed. */
  | 'synced'
  /** Cloud write failed/deferred; the durable sync queue will retry it. */
  | 'queued'
  /** No cloud configured, or offline — localStorage only. */
  | 'local_only'
  /** This session's role may not write this key (manager-only). */
  | 'forbidden';

/**
 * Timestamp of the last LOCAL write of a setting, per key.
 *
 * hydrateSettingsFromCloud used to overwrite localStorage with the cloud copy
 * unconditionally. Combined with the 10s manager-dashboard refresh, a local edit
 * that had not reached D1 yet was reverted within seconds, which is exactly what
 * "the value changes back by itself" looked like. Keeping the local write time
 * lets hydrate leave a newer local value alone.
 */
const LOCAL_WRITE_STAMP_PREFIX = 'brewmaster_setting_localts::';

function markLocalSettingWrite(key: string): void {
  try {
    localStorage.setItem(LOCAL_WRITE_STAMP_PREFIX + key, new Date().toISOString());
  } catch {
    // ignore quota
  }
}

function localSettingWriteAt(key: string): number {
  try {
    const raw = localStorage.getItem(LOCAL_WRITE_STAMP_PREFIX + key);
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

/** Clear the local-write marker once the cloud has confirmed the value. */
function clearLocalSettingWrite(key: string): void {
  try {
    localStorage.removeItem(LOCAL_WRITE_STAMP_PREFIX + key);
  } catch {
    // ignore
  }
}

/** Setting keys with an unsynced row still sitting in the durable sync queue. */
async function pendingSettingKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    await withDB(async (db) => {
      const all = await db.getAll('sync_queue');
      for (const rec of all) {
        if (rec.synced === 1) continue;
        if (String(rec.type) !== 'settings') continue;
        const key =
          (rec.data && (rec.data.key as string)) || settingKeyFromDocId(rec.data?.id) || '';
        if (key) keys.add(key);
      }
    });
  } catch {
    // ignore — an unreadable queue must not block hydration
  }
  return keys;
}

/** Recover the setting key from a namespaced sync-queue doc id (`global::<key>`). */
function settingKeyFromDocId(id: unknown): string | null {
  if (!id) return null;
  const s = String(id);
  const idx = s.indexOf('::');
  return idx >= 0 ? s.slice(idx + 2) : s;
}

function settingDocId(key: string, branchId?: string): string {
  // System-wide durable settings use a unified prefix so all devices read and write the exact same document
  if (DURABLE_SETTING_KEYS.includes(key as DurableSettingKey)) {
    return `global::${key}`;
  }
  const b = branchId || getBranchIdHeader() || 'default';
  return `${b}::${key}`;
}

async function enqueueSettingSync(
  key: string,
  value: string,
  branchId?: string
): Promise<PersistOutcome> {
  // Never enqueue a write the current role is forbidden from performing: it can
  // only 403 on the server and leave a dead sync-queue row behind. A manager
  // device will own manager-only keys. See ensureCanPushSettingKey.
  if (!(await ensureCanPushSettingKey(key))) return 'forbidden';
  const id = settingDocId(key, branchId);
  const now = new Date().toISOString();
  const data = {
    id,
    key,
    value,
    branchId: branchId || getBranchIdHeader() || 'default',
    updatedAt: now,
  };

  try {
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        const rec: SyncRecord = {
          id: `sync_setting_${id}_${Date.now()}`,
          type: 'settings',
          action: 'update',
          data,
          timestamp: now,
          synced: 0,
        };
        await db.put('sync_queue', rec);
      });
    });
  } catch (e) {
    console.warn('[settingsCloud] queue failed:', e);
  }

  // Immediate cloud-first attempt (cloudUpsert acks matching queue rows on success)
  const ok = await cloudUpsert('settings', id, data);
  if (ok) {
    clearLocalSettingWrite(key);
    return 'synced';
  }
  const fallbackOk = await cloudSyncNow({
    type: 'settings',
    action: 'update',
    data,
    timestamp: now,
  });
  if (fallbackOk) {
    clearLocalSettingWrite(key);
    return 'synced';
  }
  void syncService.syncPendingData();
  return 'queued';
}

/**
 * Persist a durable setting: localStorage first, then D1 immediately.
 */
export async function persistSetting(
  key: string,
  value: string,
  branchId?: string
): Promise<PersistOutcome> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      // Stamp the local write BEFORE attempting the cloud round-trip so a
      // concurrent hydrate cannot revert it mid-flight.
      markLocalSettingWrite(key);
    }
  } catch {
    // ignore quota
  }

  if (!DURABLE_SETTING_KEYS.includes(key as DurableSettingKey)) {
    return 'local_only';
  }

  if (!isCloudConfigured()) return 'local_only';
  // Awaited (was fire-and-forget): the caller needs the real outcome to tell the
  // operator whether the change actually left this device.
  return await enqueueSettingSync(key, value, branchId);
}

/**
 * Remove a durable setting locally and queue cloud delete.
 */
export async function removeSetting(key: string, branchId?: string): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }

  if (!DURABLE_SETTING_KEYS.includes(key as DurableSettingKey)) return;
  if (!isCloudConfigured()) return;
  // A cashier session cannot delete a manager-only setting on the server either
  // (same 403). Keep the local removal, skip the doomed cloud delete.
  if (!(await ensureCanPushSettingKey(key))) return;

  const id = settingDocId(key, branchId);
  const now = new Date().toISOString();
  try {
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        await db.put('sync_queue', {
          id: `sync_setting_del_${id}_${Date.now()}`,
          type: 'settings',
          action: 'delete',
          data: { id },
          timestamp: now,
          synced: 0,
        } as SyncRecord);
      });
    });
  } catch {
    // ignore
  }
  void cloudSyncNow({ type: 'settings', action: 'delete', data: { id }, timestamp: now });
  void syncService.syncPendingData();
}

/**
 * Pull all settings from D1 and write into localStorage.
 * Returns number of keys restored.
 */
export async function hydrateSettingsFromCloud(): Promise<number> {
  if (!isCloudConfigured()) return 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;

  try {
    const docs = await cloudGetCollection('settings');
    // Distinguish a FAILED/unauthorized read (null) from a genuinely EMPTY cloud
    // (length 0). Callers use -1 to avoid a bootstrap push after a read that only
    // failed because the session had not been established yet — pushing then would
    // spuriously re-upload local rows (and, before role-gating, 403 on manager keys).
    if (docs === null) return -1;
    if (docs.length === 0) return 0;

    // Filter to durable setting keys
    const durableDocs = docs.filter((doc) => {
      const key = String(doc.key || '');
      return key && DURABLE_SETTING_KEYS.includes(key as DurableSettingKey);
    });

    // Sort documents by timestamp (oldest first, so newest updates overwrite older ones)
    durableDocs.sort((a, b) => {
      const tA = new Date(a.updatedAt || a.updated_at || a.createdAt || 0).getTime();
      const tB = new Date(b.updatedAt || b.updated_at || b.createdAt || 0).getTime();
      return tA - tB;
    });

    // Never overwrite a local edit that is NEWER than the cloud copy, and never
    // overwrite a key whose write is still waiting in the sync queue.
    //
    // This blind overwrite was the second half of the "settings revert by
    // themselves" bug: hydrate runs on mount AND on every manager-dashboard
    // refresh (10s), so a value the operator had just typed was replaced by the
    // stale D1 row seconds later — silently, and even while its own sync-queue
    // row was still pending.
    const pending = await pendingSettingKeys();

    let n = 0;
    let skipped = 0;
    for (const doc of durableDocs) {
      const key = String(doc.key);
      const value = doc.value == null ? '' : String(doc.value);
      const cloudAt = new Date(
        doc.updatedAt || doc.updated_at || doc.createdAt || 0
      ).getTime();
      const localAt = localSettingWriteAt(key);

      if (pending.has(key)) {
        skipped++;
        continue;
      }
      if (localAt > 0 && Number.isFinite(cloudAt) && localAt > cloudAt) {
        skipped++;
        continue;
      }

      try {
        localStorage.setItem(key, value);
        // The cloud copy is authoritative for this key now, so the local-write
        // marker has served its purpose.
        if (localAt > 0) clearLocalSettingWrite(key);
        n++;
      } catch {
        // ignore
      }
    }
    if (skipped > 0) {
      console.info('[settingsCloud] kept', skipped, 'newer/pending local setting keys');
    }

    // NOTE: the telegram config is intentionally NOT restored here. It is not
    // in DURABLE_SETTING_KEYS (it would be stored as plaintext); it restores
    // through the dedicated encrypted channel — cloudHydrate calls
    // hydrateTelegramConfigFromCloud(), which decrypts the token and re-mirrors
    // the flat keys via setTelegramConfig(). See settingsCloudService header.

    console.info('[settingsCloud] hydrated', n, 'durable setting keys');
    return n;
  } catch (err) {
    console.warn('[settingsCloud] hydrate failed:', err);
    return 0;
  }
}


/**
 * Push all durable localStorage settings to D1 (bootstrap after wipe recovery reverse).
 */
export async function pushAllLocalSettingsToCloud(branchId?: string): Promise<number> {
  if (!isCloudConfigured()) return 0;
  if (typeof localStorage === 'undefined') return 0;
  let n = 0;
  for (const key of DURABLE_SETTING_KEYS) {
    try {
      // Skip keys the current role cannot push — otherwise a cashier bootstrap
      // pushes manager-only keys and the server 403s every one of them.
      if (!(await ensureCanPushSettingKey(key))) continue;
      const value = localStorage.getItem(key);
      if (value === null) continue;
      await enqueueSettingSync(key, value, branchId);
      n++;
    } catch {
      // ignore
    }
  }
  return n;
}

/**
 * One-time housekeeping: drop dead sync-queue rows for manager-only settings on
 * a cashier till.
 *
 * These rows can NEVER succeed as this role (the server denies them 403), so
 * syncService already retired them permanently — but they linger in the queue and
 * keep the SyncStatus "failed" badge red, making the operator think real data is
 * not backing up. Deleting them is safe: the value is still in localStorage, and
 * a manager device owns the authoritative cloud copy. Runs only for a CONFIRMED
 * cashier session (never null/manager) so a manager's transiently-failed write is
 * never discarded.
 */
export async function cleanupUnsyncableSettingQueue(): Promise<number> {
  if (getSessionRole() !== 'cashier') return 0;
  try {
    return await withDB(async (db) => {
      const all = await db.getAll('sync_queue');
      const tx = db.transaction('sync_queue', 'readwrite');
      let n = 0;
      for (const rec of all) {
        if (rec.synced === 1) continue;
        if (String(rec.type) !== 'settings') continue;
        const key =
          (rec.data && (rec.data.key as string)) ||
          settingKeyFromDocId(rec.data?.id) ||
          '';
        if (key && MANAGER_ONLY_SETTING_KEYS.includes(key)) {
          await tx.store.delete(rec.id);
          n++;
        }
      }
      await tx.done;
      if (n > 0) console.info('[settingsCloud] cleared', n, 'un-syncable manager-only setting rows');
      return n;
    });
  } catch {
    return 0;
  }
}
