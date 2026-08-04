/**
 * Regression guard for the automatic-snapshot storm that filled the console
 * with 403s and evicted real restore points from D1's 10-slot ring.
 *
 * Three separate defects, all reachable from `createSnapshot('auto')`:
 *   1. It fired with no session at all (App.tsx starts the scheduler in the
 *      not-signed-in branch), so the first thing a fresh tab did was POST a
 *      snapshot that could only 403.
 *   2. It uploaded EMPTY payloads taken before the cloud hydrate had populated
 *      IndexedDB. restoreFromSnapshotIfNeeded restores the *latest* snapshot,
 *      so an empty one is not merely useless — it is the one that gets restored.
 *   3. It had no cross-tab floor, so N tabs × every reload = N backups a minute.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cloudUpsert = vi.fn(async () => true);
let roleIntent: string | null = 'manager';
let csrf = 'csrf-token';

vi.mock('./cloudConfig', () => ({
  cloudUpsert: (...args: unknown[]) => cloudUpsert(...(args as [])),
  cloudGetCollection: vi.fn(async () => []),
  getBranchIdHeader: () => 'main_branch',
  getCsrfToken: () => csrf,
  getRoleIntent: () => roleIntent,
  isCloudConfigured: () => true,
  normalizeBranchId: (b?: string) => b || 'main_branch',
}));

const rows: Record<string, unknown[]> = {
  orders: [],
  menu_items: [],
  customers: [],
  companies: [],
  inventory: [],
};

vi.mock('../repositories/indexeddb/db', () => ({
  withDB: async (fn: (db: unknown) => Promise<unknown>) =>
    fn({ getAll: async (store: string) => rows[store] ?? [] }),
}));

vi.mock('./settingsCloudService', () => ({ DURABLE_SETTING_KEYS: [] as string[] }));

const LS_LAST_SNAPSHOT = 'brewmaster_last_snapshot_at';

// Tests run in the Node environment (see vitest.config.ts) — provide the
// minimal localStorage the cross-tab cooldown stamp needs.
const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
(globalThis as unknown as { localStorage: unknown }).localStorage = localStorage;

// Node's `navigator` has no `onLine`, and createSnapshot short-circuits on it.
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

function populate() {
  rows.orders = [{ id: 'ord_1', grandTotal: 10 }];
  rows.menu_items = [{ id: 'item_1', name: 'قهوة' }];
}

function emptyAll() {
  for (const k of Object.keys(rows)) rows[k] = [];
}

describe('createSnapshot — automatic backup guards', () => {
  beforeEach(() => {
    vi.resetModules();
    cloudUpsert.mockClear();
    cloudUpsert.mockResolvedValue(true);
    localStorage.clear();
    roleIntent = 'manager';
    csrf = 'csrf-token';
    emptyAll();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does not attempt an automatic snapshot before a session exists', async () => {
    populate();
    roleIntent = null;
    csrf = '';
    const { createSnapshot } = await import('./snapshotService');

    const res = await createSnapshot('auto');

    expect(res.ok).toBe(false);
    expect(res.error).toBe('no session');
    expect(cloudUpsert).not.toHaveBeenCalled();
  });

  it('refuses to upload an empty payload, so a fresh device never restores nothing', async () => {
    const { createSnapshot } = await import('./snapshotService');

    const res = await createSnapshot('auto');

    expect(res.ok).toBe(false);
    expect(res.error).toBe('empty');
    expect(cloudUpsert).not.toHaveBeenCalled();
  });

  it('an empty payload is refused for a manual snapshot too', async () => {
    const { createSnapshot } = await import('./snapshotService');

    const res = await createSnapshot('manual');

    expect(res.error).toBe('empty');
    expect(cloudUpsert).not.toHaveBeenCalled();
  });

  it('uploads once and then holds off sibling tabs via the shared cooldown', async () => {
    populate();
    const { createSnapshot } = await import('./snapshotService');

    const first = await createSnapshot('auto');
    expect(first.ok).toBe(true);
    expect(cloudUpsert).toHaveBeenCalledTimes(1);

    // A second tab firing its own post-boot timer moments later.
    const second = await createSnapshot('auto');
    expect(second.ok).toBe(false);
    expect(second.error).toBe('too soon');
    expect(cloudUpsert).toHaveBeenCalledTimes(1);
  });

  it('a manual snapshot ignores the cooldown', async () => {
    populate();
    const { createSnapshot } = await import('./snapshotService');

    await createSnapshot('auto');
    const manual = await createSnapshot('manual');

    expect(manual.ok).toBe(true);
    expect(cloudUpsert).toHaveBeenCalledTimes(2);
  });

  it('a failed upload does not consume the cooldown, so the next tick retries', async () => {
    populate();
    localStorage.setItem(LS_LAST_SNAPSHOT, new Date(Date.now() - 60 * 60_000).toISOString());
    const previous = localStorage.getItem(LS_LAST_SNAPSHOT);
    cloudUpsert.mockResolvedValueOnce(false);
    const { createSnapshot } = await import('./snapshotService');

    const failed = await createSnapshot('auto');
    expect(failed.ok).toBe(false);
    expect(localStorage.getItem(LS_LAST_SNAPSHOT)).toBe(previous);

    const retried = await createSnapshot('auto');
    expect(retried.ok).toBe(true);
  });

  it('resumes automatically once the cooldown has elapsed', async () => {
    populate();
    localStorage.setItem(LS_LAST_SNAPSHOT, new Date(Date.now() - 31 * 60_000).toISOString());
    const { createSnapshot } = await import('./snapshotService');

    const res = await createSnapshot('auto');

    expect(res.ok).toBe(true);
    expect(cloudUpsert).toHaveBeenCalledTimes(1);
  });
});
