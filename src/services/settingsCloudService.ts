/**
 * Cloud-durable settings: localStorage cache + Cloudflare D1 source of truth.
 * Keys are namespaced per branch: `${branchId}::${key}`
 */
import {
  cloudGetCollection,
  cloudUpsert,
  cloudSyncNow,
  getBranchIdHeader,
  isCloudConfigured,
} from './cloudConfig';
import { withDB, enqueueWrite, SyncRecord } from '../repositories/indexeddb/db';
import { syncService } from './syncService';

/** Settings that must survive browser wipe */
export const DURABLE_SETTING_KEYS = [
  'brewmaster_tax_rate',
  'brewmaster_admin_creds_v2',
  'brewmaster_manager_creds_v1',
  'brewmaster_admin_pin',
  'brewmaster_branch_config',
  'brewmaster_store_config',
  'brewmaster_telegram_config',
  'brewmaster_telegram_bot_token',
  'brewmaster_telegram_chat_id',
  'brewmaster_language',
  'pos_tables_list',
  'removed_menu_categories',
  'custom_menu_categories',
] as const;


export type DurableSettingKey = (typeof DURABLE_SETTING_KEYS)[number];

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
): Promise<void> {
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
  if (!ok) {
    void cloudSyncNow({ type: 'settings', action: 'update', data, timestamp: now });
    void syncService.syncPendingData();
  }
}

/**
 * Persist a durable setting: localStorage first, then D1 immediately.
 */
export async function persistSetting(
  key: string,
  value: string,
  branchId?: string
): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {
    // ignore quota
  }

  if (!DURABLE_SETTING_KEYS.includes(key as DurableSettingKey)) {
    return;
  }

  if (!isCloudConfigured()) return;
  void enqueueSettingSync(key, value, branchId);
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
    if (!docs || docs.length === 0) return 0;

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

    let n = 0;
    for (const doc of durableDocs) {
      const key = String(doc.key);
      const value = doc.value == null ? '' : String(doc.value);
      try {
        localStorage.setItem(key, value);
        n++;
      } catch {
        // ignore
      }
    }
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
