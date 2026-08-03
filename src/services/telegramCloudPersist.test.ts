import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * After a page reload the in-memory session role is gone, but the 12h HttpOnly
 * session cookie is not. `persistTelegramConfigToCloud` used to bail on the
 * in-memory value alone, so a signed-in manager who had refreshed the page saw
 * "saved" while nothing was ever pushed to D1 — the cloud silently kept the old
 * Telegram config. The role is now recovered from the cookie first.
 *
 * The bot TOKEN is a separate matter: encrypting it needs the manager's actual
 * password, which genuinely cannot survive a reload. That case is now reported
 * (tokenSynced: false) instead of being indistinguishable from success.
 */

const state = {
  role: null as 'manager' | 'cashier' | null,
  credential: null as string | null,
  cookieRole: null as 'manager' | 'cashier' | null,
  upserts: [] as { id: string; data: any }[],
};

vi.mock('./cloudConfig', () => ({
  cloudGetCollection: async () => [],
  cloudFetch: async () => null,
  cloudUpsert: async (_c: string, id: string, data: any) => {
    state.upserts.push({ id, data });
    return true;
  },
  getBranchIdHeader: () => 'main_branch',
  getSessionRole: () => state.role,
  getSessionCredential: () => state.credential,
  isCloudConfigured: () => true,
  refreshCloudSessionRole: async () => state.cookieRole,
}));

vi.mock('../repositories/indexeddb/db', () => ({
  withDB: async (fn: (db: any) => Promise<any>) => fn({ put: async () => undefined }),
  enqueueWrite: async (fn: () => Promise<any>) => fn(),
}));

vi.mock('./syncService', () => ({ syncService: { syncPendingData: async () => undefined } }));

const { persistTelegramConfigToCloud } = await import('./telegramCloudService');

const config = (over: Record<string, unknown> = {}) =>
  ({ botToken: '', chatId: '555', reportTime: '22:00', enabled: true, ...over }) as any;

describe('persistTelegramConfigToCloud', () => {
  beforeEach(() => {
    state.role = null;
    state.credential = null;
    state.cookieRole = null;
    state.upserts = [];
  });

  it('pushes when the in-memory role is manager', async () => {
    state.role = 'manager';
    state.credential = 'mgr-pw';
    const out = await persistTelegramConfigToCloud(config());
    expect(out).toEqual({ pushed: true, tokenSynced: true });
    expect(state.upserts).toHaveLength(1);
  });

  // The regression: role lost to a reload, cookie still valid.
  it('recovers the role from the session cookie after a page reload', async () => {
    state.role = null;
    state.cookieRole = 'manager';
    const out = await persistTelegramConfigToCloud(config());
    expect(out.pushed).toBe(true);
    expect(state.upserts).toHaveLength(1);
    expect(JSON.parse(state.upserts[0].data.value).chatId).toBe('555');
  });

  it('reports that the token was not re-encrypted when no live password is held', async () => {
    state.role = null;
    state.cookieRole = 'manager';
    state.credential = null; // gone with the reload
    const out = await persistTelegramConfigToCloud(config({ botToken: 'tok123' }));
    expect(out).toEqual({ pushed: true, tokenSynced: false });
  });

  it('still refuses to push for a cashier', async () => {
    state.role = 'cashier';
    const out = await persistTelegramConfigToCloud(config());
    expect(out).toEqual({ pushed: false, reason: 'not_manager' });
    expect(state.upserts).toHaveLength(0);
  });

  it('refuses when there is no session at all (cookie probe returns null)', async () => {
    const out = await persistTelegramConfigToCloud(config());
    expect(out).toEqual({ pushed: false, reason: 'not_manager' });
    expect(state.upserts).toHaveLength(0);
  });
});
