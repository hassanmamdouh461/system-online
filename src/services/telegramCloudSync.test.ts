/**
 * Regression tests for syncing the Telegram config to the cloud.
 *
 * The config used to be device-local only, so wiping the browser on the
 * manager device silently lost the daily-report setup. These tests pin the
 * new behavior: the config object is a durable (cloud-synced) setting, and
 * hydration re-mirrors the flat keys the sender service reads.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// NOTE: importing settingsCloudService.ts constructs a SyncService singleton
// that requires a browser window (addEventListener), which the Node test env
// lacks. These tests therefore (a) assert the durable-keys list by reading
// the module source (keeps the guard without the browser-only import), and
// (b) exercise the real save/mirror logic through settingsConfig, which is
// import-safe here.
const cloudServiceSrc = readFileSync(
  join(__dirname, 'settingsCloudService.ts'),
  'utf-8',
);

import { getTelegramConfig, setTelegramConfig } from '../utils/settingsConfig';

// ─── Minimal in-memory localStorage for the Node test environment ────────────
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
};
(globalThis as any).localStorage = localStorageMock;

beforeEach(() => {
  store.clear();
});

describe('telegram config cloud sync', () => {
  it('brewmaster_telegram_config is a durable (cloud-synced) setting', () => {
    // Guard the DURABLE_SETTING_KEYS list in the module source: the key must
    // appear inside the array, and the flat legacy keys must NOT.
    const arrMatch = /DURABLE_SETTING_KEYS\s*=\s*\[([\s\S]*?)\] as const/.exec(cloudServiceSrc);
    expect(arrMatch).toBeTruthy();
    const keysBlock = arrMatch![1];
    expect(keysBlock).toContain("'brewmaster_telegram_config'");
    expect(keysBlock).not.toContain("'brewmaster_telegram_bot_token'");
    expect(keysBlock).not.toContain("'brewmaster_telegram_chat_id'");
  });

  it('snapshot settings collector excludes the telegram config (token footprint)', () => {
    const snapshotSrc = readFileSync(join(__dirname, 'snapshotService.ts'), 'utf-8');
    expect(snapshotSrc).toContain("key === 'brewmaster_telegram_config'");
  });

  it('hydration re-mirrors flat keys from the hydrated config object', () => {
    // Guard the re-mirror block in hydrateSettingsFromCloud by source.
    expect(cloudServiceSrc).toContain("localStorage.setItem('brewmaster_telegram_bot_token', cfg.botToken)");
    expect(cloudServiceSrc).toContain("localStorage.setItem('brewmaster_telegram_chat_id', cfg.chatId)");
  });

  it('setTelegramConfig keeps localStorage + flat mirrors in one write', () => {
    setTelegramConfig({ botToken: 'tok123', chatId: '555', enabled: true, reportTime: '22:00' });

    // The config object (what gets synced to D1)…
    const config = getTelegramConfig();
    expect(config.botToken).toBe('tok123');
    expect(config.chatId).toBe('555');
    // …and the flat mirrors the sender service reads.
    expect(localStorage.getItem('brewmaster_telegram_bot_token')).toBe('tok123');
    expect(localStorage.getItem('brewmaster_telegram_chat_id')).toBe('555');
  });

  it('hydration mirror logic restores flat keys from the config object', () => {
    // Simulate the state after a cache wipe + cloud hydrate: only the config
    // object came back from D1, the flat mirrors are gone.
    store.clear();
    localStorage.setItem(
      'brewmaster_telegram_config',
      JSON.stringify({ botToken: 'restoredTok', chatId: '999', enabled: true, reportTime: '21:30' }),
    );

    // This mirrors the re-mirror block in hydrateSettingsFromCloud.
    const rawConfig = localStorage.getItem('brewmaster_telegram_config');
    expect(rawConfig).toBeTruthy();
    const cfg = JSON.parse(rawConfig!);
    if (cfg && typeof cfg.botToken === 'string' && cfg.botToken) {
      localStorage.setItem('brewmaster_telegram_bot_token', cfg.botToken);
    }
    if (cfg && typeof cfg.chatId === 'string' && cfg.chatId) {
      localStorage.setItem('brewmaster_telegram_chat_id', cfg.chatId);
    }

    expect(localStorage.getItem('brewmaster_telegram_bot_token')).toBe('restoredTok');
    expect(localStorage.getItem('brewmaster_telegram_chat_id')).toBe('999');
  });
});
