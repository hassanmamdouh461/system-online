/**
 * telegramCloudService — cloud persistence for the Telegram report config with
 * the bot token ENCRYPTED so only the manager can read it.
 *
 * This resolves the documented security constraint (settingsCloudService.ts:
 * the token must never sit in a shared D1 row readable by every authenticated
 * device) against the product requirement (the config must survive a browser
 * wipe and restore on any manager device).
 *
 * Design:
 *  - A single durable settings row, key `brewmaster_telegram_config_enc`,
 *    stores the NON-sensitive fields (enabled, reportTime, chatId) in the clear
 *    plus `encBotToken` — the token encrypted with a key derived from the
 *    manager's own password (see utils/secretBox). No plaintext token, and no
 *    legacy plaintext mirror keys (brewmaster_telegram_bot_token), ever reach
 *    the cloud.
 *  - The row is manager-only on the server (it is in MANAGER_ONLY_SETTING_KEYS
 *    and the Worker's CASHIER_FORBIDDEN_SETTING_KEYS), so a cashier cannot
 *    write it; even reading it yields only ciphertext the cashier cannot open.
 *  - Decryption needs the manager's raw password, held in memory since login
 *    (getSessionCredential). When only the HttpOnly cookie survives a reload
 *    (no live credential), the token stays locked until the manager signs in.
 */
import type { TelegramConfig } from '../utils/settingsConfig';
import {
  encryptSecret,
  decryptSecret,
  serializeSecretBox,
  parseSecretBox,
} from '../utils/secretBox';
import {
  cloudGetCollection,
  cloudUpsert,
  cloudFetch,
  getBranchIdHeader,
  getSessionRole,
  getSessionCredential,
  isCloudConfigured,
} from './cloudConfig';
import { withDB, enqueueWrite, SyncRecord } from '../repositories/indexeddb/db';
import { syncService } from './syncService';

/** Durable settings key carrying the (partially encrypted) Telegram config. */
export const TELEGRAM_CONFIG_KEY = 'brewmaster_telegram_config_enc';

/** Shape of the value stored in the D1 settings row (JSON string). */
interface StoredTelegramConfig {
  v: 1;
  enabled: boolean;
  reportTime?: string;
  chatId: string;
  /** secretBox JSON string of the bot token, or '' when no token was set. */
  encBotToken: string;
}

function settingDocId(_branchId?: string): string {
  // System-wide durable setting: one shared doc id across all devices (the
  // Telegram config is global, not per-branch), matching DURABLE_SETTING_KEYS.
  return `global::${TELEGRAM_CONFIG_KEY}`;
}

/** Read the live manager password, or null when no live credential is held. */
function managerPassword(): string | null {
  if (getSessionRole() !== 'manager') return null;
  return getSessionCredential();
}

/**
 * Build the stored (cloud-safe) config value. Non-sensitive fields are plain;
 * the token is encrypted when a manager password is available, else dropped
 * (we never push a plaintext token, and never overwrite a good cloud token
 * with an empty one just because this device cannot decrypt right now).
 */
async function buildStoredValue(
  config: TelegramConfig,
  existingEncToken: string,
): Promise<string> {
  const stored: StoredTelegramConfig = {
    v: 1,
    enabled: !!config.enabled,
    reportTime: config.reportTime,
    chatId: config.chatId || '',
    encBotToken: existingEncToken,
  };
  const pw = managerPassword();
  const token = (config.botToken || '').trim();
  if (pw && token) {
    stored.encBotToken = serializeSecretBox(await encryptSecret(token, pw));
  } else if (pw && !token) {
    // Manager explicitly cleared the token.
    stored.encBotToken = '';
  }
  // No live manager password: keep whatever encrypted token was already there.
  return JSON.stringify(stored);
}

/**
 * Persist the Telegram config: keep non-sensitive fields locally, encrypt the
 * token, and push the (ciphertext) row to D1 for restore on any manager device.
 * Local plaintext mirrors (localStorage) are written by the caller
 * (settingsConfig.setTelegramConfig) — this service owns only the cloud copy.
 */
export async function persistTelegramConfigToCloud(
  config: TelegramConfig,
  branchId?: string,
): Promise<void> {
  if (!isCloudConfigured()) return;
  if (getSessionRole() !== 'manager') return; // cashier must never push this

  // Preserve an existing cloud token when this device can't re-encrypt now.
  const existing = await readStoredTelegramConfig();
  const value = await buildStoredValue(config, existing?.encBotToken || '');

  const id = settingDocId(branchId);
  const now = new Date().toISOString();
  const data = {
    id,
    key: TELEGRAM_CONFIG_KEY,
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
    console.warn('[telegramCloud] queue failed:', e);
  }
  const ok = await cloudUpsert('settings', id, data);
  if (!ok) void syncService.syncPendingData();
}

/** Fetch the raw stored row from D1 (or null when absent / read failed). */
async function readStoredTelegramConfig(): Promise<StoredTelegramConfig | null> {
  if (!isCloudConfigured()) return null;
  try {
    const docs = await cloudGetCollection('settings');
    if (!docs) return null;
    const doc = docs.find((d: any) => String(d.key || '') === TELEGRAM_CONFIG_KEY);
    if (!doc) return null;
    const parsed = JSON.parse(String(doc.value || '{}'));
    if (parsed && parsed.v === 1) return parsed as StoredTelegramConfig;
    return null;
  } catch {
    return null;
  }
}

/**
 * Hydrate the Telegram config from the cloud into a TelegramConfig the app can
 * use. Non-sensitive fields restore always; the botToken is decrypted ONLY when
 * a live manager credential is present (otherwise it restores as '' and the
 * daily report simply cannot send until the manager signs in on this device).
 */
export async function hydrateTelegramConfigFromCloud(): Promise<TelegramConfig | null> {
  const stored = await readStoredTelegramConfig();
  if (!stored) return null;

  let botToken = '';
  if (stored.encBotToken) {
    const pw = managerPassword();
    if (pw) {
      const box = parseSecretBox(stored.encBotToken);
      if (box) {
        const plain = await decryptSecret(box, pw);
        botToken = plain || '';
        if (!plain) {
          console.warn('[telegramCloud] bot token present but decrypt failed (wrong/old password)');
        }
      }
    }
    // No live manager credential → leave botToken '' (locked) for now.
  }

  return {
    enabled: !!stored.enabled,
    reportTime: stored.reportTime,
    chatId: stored.chatId || '',
    botToken,
  };
}

/**
 * Claim the right to send today's automatic daily report, atomically, across
 * ALL manager devices (D1-backed). localStorage alone cannot coordinate two
 * different manager devices, so the first device to claim the business day on
 * the server wins; others receive claimed:false and skip their send.
 *
 * Fail-OPEN by design: when the cloud is unreachable or unconfigured, returns
 * true so a single/offline manager device still sends (the localStorage lock
 * in the hook remains the first layer). Only a definitive server 409
 * (already_claimed) returns false.
 */
export async function claimDailyReportLock(dayKey: string): Promise<boolean> {
  if (!isCloudConfigured()) return true;
  if (getSessionRole() !== 'manager') return false; // cashier never sends
  try {
    const res = await cloudFetch('/api/report/claim', {
      method: 'POST',
      body: JSON.stringify({ dayKey }),
    });
    if (!res) return true; // network/offline → let the local lock decide
    if (res.status === 409) return false; // another device already claimed today
    if (res.ok) return true;
    // 403 (not manager) or other: be conservative, do not double-send.
    return res.status !== 403;
  } catch {
    return true; // fail open — offline single device should still send
  }
}
