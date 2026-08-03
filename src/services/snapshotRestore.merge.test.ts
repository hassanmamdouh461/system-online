import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Restore is a RECOVERY path, not a merge-conflict resolver. A snapshot row is
 * attacker-influenced input (any till may write a snapshot) and is frequently
 * stale, so it must never destroy current work on a device.
 *
 * The guard used to be written as `incomingT >= existingT` over
 * `Date.parse(...) || 0`. A missing or unparseable timestamp collapses to 0 on
 * BOTH sides, so `0 >= 0` was true and a timestamp-less snapshot row overwrote
 * a live local row whose own updatedAt was missing or corrupt — the opposite of
 * what the code's own comment promised.
 */

// ── in-memory stand-in for the IndexedDB layer ───────────────────────────────
const stores: Record<string, Map<string, any>> = {};

function resetStores() {
  for (const name of ['orders', 'menu_items', 'customers', 'companies', 'inventory']) {
    stores[name] = new Map();
  }
}

vi.mock('../repositories/indexeddb/db', () => ({
  withDB: async (fn: (db: any) => Promise<any>) =>
    fn({
      transaction: (name: string) => ({
        store: {
          get: async (id: string) => stores[name].get(id),
          put: async (row: any) => void stores[name].set(row.id, row),
        },
        done: Promise.resolve(),
      }),
    }),
}));

vi.mock('./cloudConfig', () => ({
  cloudGetCollection: async () => null,
  cloudUpsert: async () => true,
  getBranchIdHeader: () => 'main_branch',
  isCloudConfigured: () => false,
  normalizeBranchId: (b: string) => b,
}));

// snapshotService pulls in settingsCloudService → syncService, which registers
// window listeners at import time. Only the key list matters here.
vi.mock('./settingsCloudService', () => ({
  DURABLE_SETTING_KEYS: ['brewmaster_language'] as const,
}));

const { applySnapshotPayload } = await import('./snapshotService');

const payload = (orders: any[]) =>
  ({ version: 1, createdAt: '2026-08-03T00:00:00Z', orders, menu_items: [] }) as any;

describe('applySnapshotPayload merge guard', () => {
  beforeEach(resetStores);

  it('writes a row whose id does not exist locally', async () => {
    await applySnapshotPayload(payload([{ id: 'o1', total: 5 }]));
    expect(stores.orders.get('o1')).toMatchObject({ id: 'o1', total: 5 });
  });

  it('never overwrites an existing row when the incoming row has NO timestamp', async () => {
    stores.orders.set('o1', { id: 'o1', total: 100, updatedAt: '2026-08-03T10:00:00Z' });
    await applySnapshotPayload(payload([{ id: 'o1', total: 1 }]));
    expect(stores.orders.get('o1').total).toBe(100);
  });

  // The exact case the old arithmetic got wrong: both sides collapse to 0.
  it('never overwrites when NEITHER side has a timestamp', async () => {
    stores.orders.set('o1', { id: 'o1', total: 100 });
    await applySnapshotPayload(payload([{ id: 'o1', total: 1 }]));
    expect(stores.orders.get('o1').total).toBe(100);
  });

  it('never overwrites when the LOCAL timestamp is corrupt (cannot be proven older)', async () => {
    stores.orders.set('o1', { id: 'o1', total: 100, updatedAt: 'not-a-date' });
    await applySnapshotPayload(payload([{ id: 'o1', total: 1, updatedAt: '2026-08-03T10:00:00Z' }]));
    expect(stores.orders.get('o1').total).toBe(100);
  });

  it('never overwrites when the INCOMING timestamp is corrupt', async () => {
    stores.orders.set('o1', { id: 'o1', total: 100, updatedAt: '2026-08-01T10:00:00Z' });
    await applySnapshotPayload(payload([{ id: 'o1', total: 1, updatedAt: 'garbage' }]));
    expect(stores.orders.get('o1').total).toBe(100);
  });

  it('still restores a genuinely newer row (the whole point of a restore)', async () => {
    stores.orders.set('o1', { id: 'o1', total: 100, updatedAt: '2026-08-01T10:00:00Z' });
    await applySnapshotPayload(payload([{ id: 'o1', total: 1, updatedAt: '2026-08-03T10:00:00Z' }]));
    expect(stores.orders.get('o1').total).toBe(1);
  });

  it('leaves a newer local row alone when the snapshot is stale', async () => {
    stores.orders.set('o1', { id: 'o1', total: 100, updatedAt: '2026-08-03T10:00:00Z' });
    await applySnapshotPayload(payload([{ id: 'o1', total: 1, updatedAt: '2026-08-01T10:00:00Z' }]));
    expect(stores.orders.get('o1').total).toBe(100);
  });

  it('skips tombstoned rows so a restore never resurrects a deletion', async () => {
    await applySnapshotPayload(payload([{ id: 'gone', deletedAt: '2026-08-02T00:00:00Z' }]));
    expect(stores.orders.has('gone')).toBe(false);
  });
});
