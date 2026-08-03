import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guard: a delete must report whether the CLOUD confirmed it.
 *
 * THE OUTAGE THIS PREVENTS
 * Deleting a company (or customer) writes a soft-delete tombstone to IndexedDB
 * and then pushes it to D1. Every caller used to ignore the push result — the
 * repository ran `cloudUpsert(...)`, dropped the boolean, and returned void — so
 * the screen printed «تم حذف الشركة» even when the tombstone never left the
 * browser. The deletion then existed ONLY in this device's IndexedDB and its
 * sync_queue. Clearing browser data wiped both, the next hydrate pulled the
 * still-live row from D1, and the company reappeared with its OnAccount
 * receivables — the operator's exact complaint: "I delete it, I clear the cache,
 * and I find it back".
 *
 * The failure modes that trigger it are ordinary: an expired 12h session cookie
 * (the login password is held in memory only, so a reloaded tab cannot re-mint),
 * a cashier-role session (soft-delete is manager-only, server-side), or simply
 * being offline. All three answered "deleted" before this guard existed.
 *
 * These tests assert the repository now returns { synced } honestly, and that it
 * only acks the sync-queue row when the write actually landed — an ack on a
 * failed write retires the pending delete and loses it for good.
 */

// ── in-memory IndexedDB stand-in ────────────────────────────────────────────
const stores: Record<string, Map<string, any>> = {
  companies: new Map(),
  customers: new Map(),
  sync_queue: new Map(),
};

const fakeDb = {
  get: async (store: string, id: string) => stores[store].get(id),
  getAll: async (store: string) => [...stores[store].values()],
  // Only the 'by-phone' index is used by these paths.
  getFromIndex: async (store: string, _index: string, phone: string) =>
    [...stores[store].values()].find((row) => row.phone === phone),
  put: async (store: string, value: any) => {
    stores[store].set(value.id, value);
  },
};

vi.mock('./db', () => ({
  withDB: async (fn: (db: any) => any) => fn(fakeDb),
  enqueueWrite: async (fn: () => any) => fn(),
}));

vi.mock('../../services/syncService', () => ({
  syncService: { syncPendingData: vi.fn() },
}));

const cloudUpsertWithOutcome = vi.fn();
const ackSyncQueueForEntity = vi.fn();

vi.mock('../../services/cloudConfig', () => ({
  cloudGetCollection: vi.fn(async () => null),
  cloudUpsert: vi.fn(async () => true),
  cloudUpsertWithOutcome: (...args: unknown[]) => cloudUpsertWithOutcome(...args),
  ackSyncQueueForEntity: (...args: unknown[]) => ackSyncQueueForEntity(...args),
  describeCloudWriteFailure: (outcome: { kind: string }) =>
    outcome.kind === 'denied' ? 'السيرفر رفض العملية' : 'مفيش اتصال بالسحاب',
  getSessionRole: () => 'manager',
}));

import { IndexedDbCompanyRepository } from './IndexedDbCompanyRepository';
import { IndexedDbCustomerRepository } from './IndexedDbCustomerRepository';

const companies = new IndexedDbCompanyRepository();
const customers = new IndexedDbCustomerRepository();

beforeEach(() => {
  for (const store of Object.values(stores)) store.clear();
  cloudUpsertWithOutcome.mockReset();
  ackSyncQueueForEntity.mockReset();
  // Offline by default so getAll never attempts a remote merge.
  vi.stubGlobal('navigator', { onLine: false });
});

describe('company delete reports the cloud outcome', () => {
  it('returns synced:true and pushes a tombstone carrying deletedAt', async () => {
    stores.companies.set('co_1', {
      id: 'co_1',
      name: 'شركة تيست',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    cloudUpsertWithOutcome.mockResolvedValue({ kind: 'ok' });

    const outcome = await companies.delete('co_1');

    expect(outcome).toEqual({ synced: true });
    const [collection, id, payload] = cloudUpsertWithOutcome.mock.calls[0];
    expect(collection).toBe('companies');
    expect(id).toBe('co_1');
    // The tombstone must carry deletedAt AND the NOT NULL name, or the Worker
    // upsert fails and D1 keeps the row live.
    expect(payload.deletedAt).toBeTruthy();
    expect(payload.name).toBe('شركة تيست');
    expect(ackSyncQueueForEntity).toHaveBeenCalledWith('co_1');
  });

  it('returns synced:false with a reason when the server refuses the tombstone', async () => {
    stores.companies.set('co_2', { id: 'co_2', name: 'شركة', tags: [] });
    cloudUpsertWithOutcome.mockResolvedValue({
      kind: 'denied',
      status: 403,
      code: 'cashier_soft_delete_forbidden',
      message: null,
    });

    const outcome = await companies.delete('co_2');

    expect(outcome.synced).toBe(false);
    expect(outcome.reason).toBeTruthy();
    // Acking a queue row whose write never landed retires the pending delete and
    // loses it permanently — the row must stay pending.
    expect(ackSyncQueueForEntity).not.toHaveBeenCalled();
  });

  it('returns synced:false when the cloud is unreachable, and keeps hiding the row locally', async () => {
    stores.companies.set('co_3', { id: 'co_3', name: 'شركة', tags: [] });
    cloudUpsertWithOutcome.mockResolvedValue({ kind: 'unreachable', status: null });

    const outcome = await companies.delete('co_3');

    expect(outcome.synced).toBe(false);
    // Local tombstone still written: the operator must not keep seeing the row.
    expect(stores.companies.get('co_3').deletedAt).toBeTruthy();
    expect(await companies.getById('co_3')).toBeNull();
  });
});

describe('customer delete reports the cloud outcome', () => {
  it('returns synced:true when the tombstone lands', async () => {
    stores.customers.set('cust_1', {
      id: 'cust_1',
      name: 'حسن',
      phone: '01125377606',
      points: 0,
      tags: [],
    });
    cloudUpsertWithOutcome.mockResolvedValue({ kind: 'ok' });

    expect(await customers.delete('cust_1')).toEqual({ synced: true });
    const [, , payload] = cloudUpsertWithOutcome.mock.calls[0];
    expect(payload.deletedAt).toBeTruthy();
    // Phone is NOT NULL in D1 — the tombstone must keep it.
    expect(payload.phone).toBe('01125377606');
  });

  it('returns synced:false with a reason when the session lapsed', async () => {
    stores.customers.set('cust_2', {
      id: 'cust_2',
      name: 'عميل',
      phone: '0100',
      points: 0,
      tags: [],
    });
    cloudUpsertWithOutcome.mockResolvedValue({ kind: 'unauthenticated', status: 401 });

    const outcome = await customers.delete('cust_2');

    expect(outcome.synced).toBe(false);
    expect(outcome.reason).toBeTruthy();
    expect(ackSyncQueueForEntity).not.toHaveBeenCalled();
    // A tombstoned customer must never be handed back as a live account.
    expect(await customers.getByPhone('0100')).toBeNull();
  });
});
