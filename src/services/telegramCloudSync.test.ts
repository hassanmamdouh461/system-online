/**
 * Regression tests for the cloud-synced Telegram config.
 *
 * Security invariant: the bot token must NEVER reach D1 (or a snapshot) as
 * plaintext. It flows through a dedicated encrypted channel
 * (telegramCloudService + secretBox): setTelegramConfig encrypts-then-pushes,
 * cloudHydrate pulls-then-decrypts. These tests pin that the generic
 * plaintext settings path does NOT carry the config, and that the encrypted
 * channel is wired at both the save and hydrate ends.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getTelegramConfig, setTelegramConfig } from '../utils/settingsConfig';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf-8');
const cloudServiceSrc = read('settingsCloudService.ts');
const snapshotSrc = read('snapshotService.ts');
const settingsConfigSrc = readFileSync(
  join(__dirname, '../utils/settingsConfig.ts'),
  'utf-8',
);
const cloudHydrateSrc = read('cloudHydrate.ts');

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

describe('telegram config — no plaintext in the generic cloud path', () => {
  it('brewmaster_telegram_config is NOT a durable (verbatim-synced) setting', () => {
    const arrMatch = /DURABLE_SETTING_KEYS\s*=\s*\[([\s\S]*?)\] as const/.exec(cloudServiceSrc);
    expect(arrMatch).toBeTruthy();
    const keysBlock = arrMatch![1];
    // The config (and its embedded plaintext token) must NOT ride the generic
    // persist/hydrate path — that would store it verbatim in D1.
    expect(keysBlock).not.toContain("'brewmaster_telegram_config'");
    expect(keysBlock).not.toContain("'brewmaster_telegram_bot_token'");
    expect(keysBlock).not.toContain("'brewmaster_telegram_chat_id'");
  });

  it('snapshot collector only iterates DURABLE keys (so no plaintext token in snapshots)', () => {
    // The snapshot collector loops DURABLE_SETTING_KEYS only; with the config
    // excluded from that list, no plaintext token can land in a snapshot.
    expect(snapshotSrc).toContain('for (const key of DURABLE_SETTING_KEYS)');
    // And it must not special-case the telegram key back in.
    expect(snapshotSrc).not.toMatch(/out\[['"]brewmaster_telegram/);
  });
});

describe('telegram config — encrypted channel is wired', () => {
  it('setTelegramConfig persists via the encrypted cloud service', () => {
    expect(settingsConfigSrc).toContain("import('../services/telegramCloudService')");
    expect(settingsConfigSrc).toContain('persistTelegramConfigToCloud');
    // …and must NOT push the raw config through the generic cloudPersist path.
    expect(settingsConfigSrc).not.toContain("cloudPersist(LS_TELEGRAM_CONFIG_KEY");
  });

  it('cloudHydrate restores via the encrypted hydrate service', () => {
    expect(cloudHydrateSrc).toContain('hydrateTelegramConfigFromCloud');
  });
});

describe('telegram config — local save + flat mirrors', () => {
  it('setTelegramConfig keeps localStorage + flat mirrors in one write', () => {
    setTelegramConfig({ botToken: 'tok123', chatId: '555', enabled: true, reportTime: '22:00' });

    // The config object (local cache)…
    const config = getTelegramConfig();
    expect(config.botToken).toBe('tok123');
    expect(config.chatId).toBe('555');
    // …and the flat mirrors the sender service reads.
    expect(localStorage.getItem('brewmaster_telegram_bot_token')).toBe('tok123');
    expect(localStorage.getItem('brewmaster_telegram_chat_id')).toBe('555');
  });

  it('clearing the token removes the flat mirror too', () => {
    setTelegramConfig({ botToken: '', chatId: '', enabled: false, reportTime: '23:00' });
    expect(localStorage.getItem('brewmaster_telegram_bot_token')).toBeNull();
    expect(localStorage.getItem('brewmaster_telegram_chat_id')).toBeNull();
  });
});
