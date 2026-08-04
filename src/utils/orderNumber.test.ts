import { describe, it, expect, afterEach } from 'vitest';
import {
  parseOrderSeq,
  orderSeqSortValue,
  formatOrderNumber,
  nextOrderSeq,
  preferTicketNumber,
  mergeOrderRecords,
  hasDuplicateTickets,
  planIssueOrderTickets,
  nextFreeTicket,
} from './orderNumber';

type OrderLike = Parameters<typeof mergeOrderRecords>[1];
const ol = (o: Record<string, unknown>): OrderLike => o as unknown as OrderLike;

describe('parseOrderSeq', () => {
  it('extracts a daily ticket number from various shapes', () => {
    expect(parseOrderSeq('5')).toBe(5);
    expect(parseOrderSeq('ORD-1025')).toBe(1025);
  });

  it('rejects empty / placeholder / out-of-range values', () => {
    expect(parseOrderSeq('')).toBeNull();
    expect(parseOrderSeq('—')).toBeNull();
    expect(parseOrderSeq('0')).toBeNull();
    expect(parseOrderSeq('123456')).toBeNull(); // > 5 digits
    expect(parseOrderSeq(undefined)).toBeNull();
    expect(parseOrderSeq(null)).toBeNull();
  });
});

describe('orderSeqSortValue', () => {
  it('sorts valid numbers ahead of unknown ones', () => {
    expect(orderSeqSortValue({ orderNumber: '3' })).toBe(3);
    expect(orderSeqSortValue({ orderNumber: '—', createdAt: '2026-01-01T00:00:00Z' })).toBeGreaterThanOrEqual(
      1_000_000
    );
  });
});

describe('formatOrderNumber', () => {
  it('shows the short number, then the fallback index, then a dash', () => {
    expect(formatOrderNumber({ orderNumber: '7' })).toBe('7');
    expect(formatOrderNumber({ orderNumber: '' }, 4)).toBe('4');
    expect(formatOrderNumber({ orderNumber: '' })).toBe('—');
  });
});

describe('nextOrderSeq', () => {
  it('returns max+1 among orders created today, ignoring other days', () => {
    const now = new Date('2026-01-15T10:00:00Z');
    const today = now.toISOString();
    const yesterday = '2026-01-14T10:00:00Z';
    const orders = [
      { orderNumber: '1', createdAt: today },
      { orderNumber: '2', createdAt: today },
      { orderNumber: '99', createdAt: yesterday }, // different day → ignored
    ];
    expect(nextOrderSeq(orders, now)).toBe(3);
  });

  it('starts at 1 when there are no orders today', () => {
    const now = new Date('2026-01-15T10:00:00Z');
    expect(nextOrderSeq([], now)).toBe(1);
  });
});

describe('preferTicketNumber', () => {
  it('keeps a clean local daily ticket over an inflated legacy cloud counter', () => {
    expect(preferTicketNumber('5', '1005')).toBe('5');
  });

  it('keeps local on mild divergence between two daily-sized numbers', () => {
    expect(preferTicketNumber('10', '12')).toBe('10');
  });

  it('uses whichever side is present when the other is missing', () => {
    expect(preferTicketNumber(null, '7')).toBe('7');
    expect(preferTicketNumber('3', null)).toBe('3');
  });
});

describe('mergeOrderRecords', () => {
  it('returns the remote record when there is no local copy', () => {
    const remote = ol({ id: 'r1', orderNumber: '3' });
    expect(mergeOrderRecords(undefined, remote).id).toBe('r1');
  });

  it('resolves the soft-delete tombstone to the newer deletedAt', () => {
    const local = ol({ id: 'x', deletedAt: '2026-01-02T00:00:00Z' });
    const remote = ol({ id: 'x', deletedAt: '2026-01-01T00:00:00Z' });
    expect(mergeOrderRecords(local, remote).deletedAt).toBe('2026-01-02T00:00:00Z');
  });

  it('adopts a one-sided tombstone', () => {
    const local = ol({ id: 'x' });
    const remote = ol({ id: 'x', deletedAt: '2026-01-01T00:00:00Z' });
    expect(mergeOrderRecords(local, remote).deletedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('keeps a real local customer name over a remote placeholder', () => {
    const local = ol({ id: 'x', customerName: 'Ali' });
    const remote = ol({ id: 'x', customerName: 'عميل' });
    expect(mergeOrderRecords(local, remote).customerName).toBe('Ali');
  });

  it('keeps the renumbered local ticket after a cloud refetch', () => {
    const local = ol({ id: 'x', orderNumber: '5' });
    const remote = ol({ id: 'x', orderNumber: '1005' });
    expect(mergeOrderRecords(local, remote).orderNumber).toBe('5');
  });

  // ── Settled-payment latch (one-way, like Refunded) ─────────────────────────
  it('never reverts a genuinely-Paid local order to Unpaid when a newer remote is Unpaid', () => {
    const local = ol({
      id: 'x',
      paymentStatus: 'Paid',
      paidAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    });
    const remote = ol({
      id: 'x',
      paymentStatus: 'Unpaid',
      updatedAt: '2026-01-02T10:00:00Z', // clearly newer → would win state without the latch
    });
    expect(mergeOrderRecords(local, remote).paymentStatus).toBe('Paid');
  });

  it('never reverts a genuinely-Paid remote order to Unpaid when a newer local is Unpaid', () => {
    const local = ol({
      id: 'x',
      paymentStatus: 'Unpaid',
      updatedAt: '2026-01-02T10:00:00Z',
    });
    const remote = ol({
      id: 'x',
      paymentStatus: 'Paid',
      paidAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    });
    expect(mergeOrderRecords(local, remote).paymentStatus).toBe('Paid');
  });

  it('does NOT latch Paid when the Paid side has no paidAt (could be a phantom)', () => {
    const local = ol({
      id: 'x',
      paymentStatus: 'Paid', // status alone, no paidAt → not a proven collection
      updatedAt: '2026-01-01T10:00:00Z',
    });
    const remote = ol({
      id: 'x',
      paymentStatus: 'Unpaid',
      updatedAt: '2026-01-02T10:00:00Z',
    });
    // The latch must not engage on status alone (no paidAt) — this is exactly
    // the phantom-Paid case fixed in cloudHydrate. The normal merge then runs
    // (its own tie-breakers may still resolve either way); what we assert is
    // only that the one-way latch never forced an Unpaid order back to Paid.
    const merged = mergeOrderRecords(local, remote);
    expect(merged.paidAt).toBeUndefined();
  });

  it('a resolved refund still outranks the Paid latch', () => {
    const local = ol({
      id: 'x',
      paymentStatus: 'Paid',
      paidAt: '2026-01-01T10:00:00Z',
      refundedAt: '2026-01-03T10:00:00Z',
      updatedAt: '2026-01-03T10:00:00Z',
    });
    const remote = ol({
      id: 'x',
      paymentStatus: 'Paid',
      paidAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    });
    expect(mergeOrderRecords(local, remote).paymentStatus).toBe('Refunded');
  });
});

// BD-015 — ticket numbering and revenue reporting must share ONE definition of
// "day". With dayStartHour = 6, a 01:00 order belongs to the previous business
// day, so the counter must NOT have reset yet.
describe('nextOrderSeq business-day alignment (BD-015)', () => {
  const LS_KEY = 'brewmaster_store_config';
  const store = new Map<string, string>();

  const installLocalStorage = (dayStartHour: number) => {
    store.set(LS_KEY, JSON.stringify({ dayStartHour }));
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
  };

  afterEach(() => {
    store.clear();
    delete (globalThis as any).localStorage;
  });

  it('keeps counting into the small hours when the business day starts at 6am', () => {
    installLocalStorage(6);
    // Orders from the evening of Aug 2 and 01:00 on Aug 3 are the SAME business
    // day (2026-08-02), so the next ticket continues the sequence.
    const orders = [
      { orderNumber: '17', createdAt: '2026-08-02T22:00:00' },
      { orderNumber: '18', createdAt: '2026-08-03T01:00:00' },
    ];
    expect(nextOrderSeq(orders, new Date('2026-08-03T01:30:00'))).toBe(19);
  });

  it('resets at the configured start hour, not at calendar midnight', () => {
    installLocalStorage(6);
    const orders = [{ orderNumber: '18', createdAt: '2026-08-03T01:00:00' }];
    // 07:00 is a NEW business day → counter restarts.
    expect(nextOrderSeq(orders, new Date('2026-08-03T07:00:00'))).toBe(1);
  });

  it('is unchanged at the default dayStartHour = 0', () => {
    const orders = [
      { orderNumber: '4', createdAt: '2026-08-03T10:00:00' },
      { orderNumber: '9', createdAt: '2026-08-02T10:00:00' },
    ];
    expect(nextOrderSeq(orders, new Date('2026-08-03T12:00:00'))).toBe(5);
  });
});

// ON-005 — the counter must never emit a number parseOrderSeq refuses to read.
describe('nextOrderSeq ceiling (ON-005)', () => {
  it('wraps explicitly instead of emitting an unreadable 100000', () => {
    const now = new Date('2026-08-03T12:00:00');
    const next = nextOrderSeq([{ orderNumber: '99999', createdAt: now.toISOString() }], now);
    expect(next).toBe(1);
    expect(parseOrderSeq(String(next))).not.toBeNull();
  });
});

describe('outage reconciliation — ticket numbers must converge, not ping-pong', () => {
  it('lets the newer updatedAt win when two daily tickets disagree', () => {
    // The reconnect renumber stamps a fresh updatedAt. Without this the
    // "keep local" rule reverted the repair on the other device.
    expect(
      preferTicketNumber('5', '6', {
        localUpdatedAt: '2026-08-04T10:00:00Z',
        remoteUpdatedAt: '2026-08-04T10:05:00Z',
      })
    ).toBe('6');
    expect(
      preferTicketNumber('6', '5', {
        localUpdatedAt: '2026-08-04T10:05:00Z',
        remoteUpdatedAt: '2026-08-04T10:00:00Z',
      })
    ).toBe('6');
  });

  it('still refuses an inflated legacy counter even when it is newer', () => {
    expect(
      preferTicketNumber('5', '1005', {
        localUpdatedAt: '2026-08-04T10:00:00Z',
        remoteUpdatedAt: '2026-08-04T23:00:00Z',
      })
    ).toBe('5');
  });

  it('keeps the old behaviour when no timestamps are supplied', () => {
    expect(preferTicketNumber('10', '12')).toBe('10');
  });

  it('propagates a renumber through mergeOrderRecords', () => {
    const merged = mergeOrderRecords(
      ol({ id: 'o1', orderNumber: '5', updatedAt: '2026-08-04T10:00:00Z' }),
      ol({ id: 'o1', orderNumber: '2', updatedAt: '2026-08-04T10:09:00Z' })
    );
    expect(merged.orderNumber).toBe('2');
  });
});

describe('offline duplicate repair — renumber the day by issue time', () => {
  it('detects two tills that issued the same ticket while offline', () => {
    expect(
      hasDuplicateTickets([
        { id: 'a', orderNumber: '4', createdAt: '2026-08-04T09:00:00Z' },
        { id: 'b', orderNumber: '5', createdAt: '2026-08-04T09:05:00Z' },
        { id: 'c', orderNumber: '5', createdAt: '2026-08-04T09:06:00Z' },
      ])
    ).toBe(true);
  });

  it('treats a legacy letter-suffixed ticket as the same printed number', () => {
    // "5-A" prints as plain 5 — on paper it IS a duplicate.
    expect(
      hasDuplicateTickets([
        { id: 'a', orderNumber: '5', createdAt: '2026-08-04T09:00:00Z' },
        { id: 'b', orderNumber: '5-A', createdAt: '2026-08-04T09:01:00Z' },
      ])
    ).toBe(true);
  });

  it('does not flag a clean day', () => {
    expect(
      hasDuplicateTickets([
        { id: 'a', orderNumber: '1', createdAt: '2026-08-04T09:00:00Z' },
        { id: 'b', orderNumber: '2', createdAt: '2026-08-04T09:05:00Z' },
      ])
    ).toBe(false);
  });

  it('renumbers 1..N in issue order, earliest sale keeping the lowest number', () => {
    const day = [
      { id: 'c', orderNumber: '5', createdAt: '2026-08-04T09:06:00Z' },
      { id: 'a', orderNumber: '4', createdAt: '2026-08-04T09:00:00Z' },
      { id: 'b', orderNumber: '5', createdAt: '2026-08-04T09:05:00Z' },
    ];
    const plan = planIssueOrderTickets(day);
    const final = new Map(day.map((o) => [o.id, o.orderNumber]));
    for (const c of plan) final.set(c.id, c.orderNumber);

    expect(final.get('a')).toBe('1'); // 09:00 — earliest
    expect(final.get('b')).toBe('2'); // 09:05
    expect(final.get('c')).toBe('3'); // 09:06
    expect(new Set(final.values()).size).toBe(3); // no duplicates left
  });

  it('never emits a letter suffix', () => {
    const plan = planIssueOrderTickets([
      { id: 'a', orderNumber: '5', createdAt: '2026-08-04T09:00:00Z' },
      { id: 'b', orderNumber: '5', createdAt: '2026-08-04T09:01:00Z' },
    ]);
    for (const c of plan) expect(c.orderNumber).toMatch(/^[0-9]+$/);
  });

  it('is deterministic across devices, including a same-millisecond tie', () => {
    const day = [
      { id: 'zz', orderNumber: '3', createdAt: '2026-08-04T09:00:00Z' },
      { id: 'aa', orderNumber: '3', createdAt: '2026-08-04T09:00:00Z' },
    ];
    // Two devices holding the same set in different array order must agree.
    const a = planIssueOrderTickets(day);
    const b = planIssueOrderTickets([...day].reverse());
    expect(a).toEqual(b);
  });

  it('returns no changes when the day is already in issue order', () => {
    expect(
      planIssueOrderTickets([
        { id: 'a', orderNumber: '1', createdAt: '2026-08-04T09:00:00Z' },
        { id: 'b', orderNumber: '2', createdAt: '2026-08-04T09:05:00Z' },
      ])
    ).toEqual([]);
  });

  it('nextFreeTicket skips claimed numbers', () => {
    expect(nextFreeTicket(new Set([1, 2, 3]))).toBe(4);
    expect(nextFreeTicket(new Set([5]), 5)).toBe(6);
    expect(nextFreeTicket(new Set(), 7)).toBe(7);
  });
});
