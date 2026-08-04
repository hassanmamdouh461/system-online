import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guard: re-using a deleted customer's phone number must NOT bring
 * that customer back to life.
 *
 * THE OUTAGE THIS PREVENTS
 * `save` matched an incoming customer by phone. When the match carried a
 * tombstone and the payload had a real name, the old code simply cleared
 * `deletedAt`:
 *
 *   deletedAt: existing?.deletedAt && !isPlaceholderName(name) && !!customerData.name
 *     ? undefined
 *     : existing?.deletedAt
 *
 * The row therefore came back under its ORIGINAL id, carrying its original
 * `points` and `createdAt`. That id is the foreign key every historical order
 * and every OnAccount receivable was written against — so typing an old
 * customer's number into the POS silently reopened a debt ledger that belonged
 * to an account the manager had deliberately closed, and handed whoever owns
 * that recycled number a stranger's loyalty balance.
 *
 * The decision taken (option A): a deletion ends an IDENTITY, not just a row.
 * The number may be reused, but the re-add mints a NEW id with zero points and
 * a fresh createdAt, and the tombstone is left exactly where it is — locally and
 * in D1 — so the dead account keeps its own history.
 *
 * Two saves must still target the dead row instead of forking, and both are
 * asserted below: the delete path itself (an explicit `deletedAt`), and a save
 * that names an explicit `id` (customersService.lookupByPhone caching a live D1
 * document — forking there would duplicate the cloud's own record).
 */

// ── in-memory IndexedDB stand-in ────────────────────────────────────────────
const stores: Record<string, Map<string, any>> = {
  customers: new Map(),
  sync_queue: new Map(),
};

const fakeDb = {
  get: async (store: string, id: string) => stores[store].get(id),
  getAll: async (store: string) => [...stores[store].values()],
  // Mirrors a real IndexedDB index: it returns SOME matching row, not
  // necessarily a live one. That ambiguity is the whole reason the repository
  // has to rescan and prefer the live row.
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

const cloudUpsertWithOutcome = vi.fn(async () => ({ kind: 'ok' }));
const ackSyncQueueForEntity = vi.fn();

vi.mock('../../services/cloudConfig', () => ({
  cloudGetCollection: vi.fn(async () => null),
  cloudUpsert: vi.fn(async () => true),
  cloudUpsertWithOutcome: (...args: unknown[]) => cloudUpsertWithOutcome(...(args as [])),
  ackSyncQueueForEntity: (...args: unknown[]) => ackSyncQueueForEntity(...(args as [])),
  describeCloudWriteFailure: (outcome: { kind: string }) =>
    outcome.kind === 'denied' ? 'السيرفر رفض العملية' : 'مفيش اتصال بالسحاب',
  getSessionRole: () => 'manager',
}));

import { IndexedDbCustomerRepository } from './IndexedDbCustomerRepository';

const customers = new IndexedDbCustomerRepository();

const PHONE = '01001234567';

/** A customer who was deleted after building up points and a debt history. */
function seedDeletedCustomer() {
  stores.customers.set('cust_old', {
    id: 'cust_old',
    name: 'محمد القديم',
    phone: PHONE,
    points: 250,
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    deletedAt: '2025-06-01T00:00:00.000Z',
  });
}

beforeEach(() => {
  for (const store of Object.values(stores)) store.clear();
  cloudUpsertWithOutcome.mockClear();
  cloudUpsertWithOutcome.mockResolvedValue({ kind: 'ok' } as any);
  ackSyncQueueForEntity.mockClear();
});

describe('re-adding a deleted customer’s phone', () => {
  it('creates a NEW customer instead of reviving the tombstoned one', async () => {
    seedDeletedCustomer();

    const outcome = await customers.saveWithOutcome({ name: 'أحمد الجديد', phone: PHONE });

    expect(outcome.startedNewIdentity).toBe(true);
    expect(outcome.record.id).not.toBe('cust_old');
    expect(outcome.record.name).toBe('أحمد الجديد');
    expect(outcome.record.deletedAt).toBeUndefined();
  });

  it('starts the new customer at zero points, not the dead account’s balance', async () => {
    // The concrete harm: 250 points earned by an account the manager closed
    // used to transfer to whoever re-used the number.
    seedDeletedCustomer();

    const { record } = await customers.saveWithOutcome({ name: 'أحمد الجديد', phone: PHONE });

    expect(record.points).toBe(0);
  });

  it('gives the new customer a fresh createdAt, not the dead one’s', async () => {
    seedDeletedCustomer();

    const { record } = await customers.saveWithOutcome({ name: 'أحمد الجديد', phone: PHONE });

    expect(record.createdAt).not.toBe('2024-01-01T00:00:00.000Z');
  });

  it('leaves the tombstone in place so old orders and debts stay with the dead id', async () => {
    seedDeletedCustomer();

    await customers.saveWithOutcome({ name: 'أحمد الجديد', phone: PHONE });

    const dead = stores.customers.get('cust_old');
    expect(dead, 'the tombstone row must not be deleted').toBeTruthy();
    expect(dead.deletedAt, 'the tombstone must not be cleared').toBe('2025-06-01T00:00:00.000Z');
    expect(dead.points, 'the dead account keeps its own history').toBe(250);
    // Two rows now share the phone number: that is intended, and is why the
    // lookups below have to prefer the live one.
    expect(stores.customers.size).toBe(2);
  });

  it('never pushes a delete of the tombstone to the cloud', async () => {
    seedDeletedCustomer();

    await customers.saveWithOutcome({ name: 'أحمد الجديد', phone: PHONE });

    // Only the NEW customer may be written. Touching cust_old at all risks
    // clearing its tombstone in D1, which is the original resurrection bug.
    for (const call of cloudUpsertWithOutcome.mock.calls) {
      expect((call as unknown[])[1]).not.toBe('cust_old');
    }
  });

  it('getByPhone returns the new customer, never the dead row', async () => {
    seedDeletedCustomer();
    const { record } = await customers.saveWithOutcome({ name: 'أحمد الجديد', phone: PHONE });

    const found = await customers.getByPhone(PHONE);

    // The by-phone index may hand back either row. Returning null here (or the
    // tombstone) would make the live customer unreachable and the till would
    // mint a duplicate on every lookup.
    expect(found).not.toBeNull();
    expect(found!.id).toBe(record.id);
  });

  it('a SECOND save on the same number updates the new customer, it does not fork again', async () => {
    seedDeletedCustomer();
    const first = await customers.saveWithOutcome({ name: 'أحمد الجديد', phone: PHONE });

    const second = await customers.saveWithOutcome({ name: 'أحمد الجديد', phone: PHONE, points: 10 });

    expect(second.record.id).toBe(first.record.id);
    expect(second.startedNewIdentity).toBeFalsy();
    // Still exactly the tombstone + the one live customer.
    expect(stores.customers.size).toBe(2);
  });

  it('the delete path still tombstones the existing row rather than forking', async () => {
    stores.customers.set('cust_live', {
      id: 'cust_live',
      name: 'عميل حي',
      phone: PHONE,
      points: 5,
      tags: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    // An explicit deletedAt in the payload IS the delete path writing a
    // tombstone. It must land on the same row, not create a second one.
    const { record, startedNewIdentity } = await customers.saveWithOutcome({
      id: 'cust_live',
      phone: PHONE,
      deletedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(startedNewIdentity).toBeFalsy();
    expect(record.id).toBe('cust_live');
    expect(record.deletedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(stores.customers.size).toBe(1);
  });

  it('an explicit id still addresses that row — the D1 cache path must not duplicate', async () => {
    // customersService.lookupByPhone caches a LIVE cloud document by its id
    // while a stale local tombstone for the same phone may still exist. Forking
    // there would create a second copy of a record the cloud already owns.
    seedDeletedCustomer();

    const { record, startedNewIdentity } = await customers.saveWithOutcome({
      id: 'cust_old',
      name: 'محمد القديم',
      phone: PHONE,
    });

    expect(startedNewIdentity).toBeFalsy();
    expect(record.id).toBe('cust_old');
    expect(stores.customers.size).toBe(1);
  });

  it('reports the save as unconfirmed when the cloud refused it', async () => {
    // Same honesty rule as the delete path: a new customer that only reached
    // IndexedDB dies with the site data, and the operator must be told.
    seedDeletedCustomer();
    cloudUpsertWithOutcome.mockResolvedValue({
      kind: 'denied',
      status: 403,
      code: null,
      message: null,
    } as any);

    const outcome = await customers.saveWithOutcome({ name: 'أحمد الجديد', phone: PHONE });

    expect(outcome.synced).toBe(false);
    expect(outcome.reason).toBeTruthy();
    // Never ack a queue row for a write that did not land — an ack retires the
    // pending change and loses it for good.
    expect(ackSyncQueueForEntity).not.toHaveBeenCalled();
  });

  it('reports synced when D1 confirmed the new customer', async () => {
    seedDeletedCustomer();

    const outcome = await customers.saveWithOutcome({ name: 'أحمد الجديد', phone: PHONE });

    expect(outcome.synced).toBe(true);
    expect(outcome.reason).toBeUndefined();
  });

  it('an ordinary first-time customer is not flagged as a new identity', async () => {
    // No tombstone in play: nothing unusual to report to the operator.
    const outcome = await customers.saveWithOutcome({ name: 'زبون جديد', phone: '01555555555' });

    expect(outcome.startedNewIdentity).toBe(false);
    expect(outcome.record.points).toBe(0);
  });
});
