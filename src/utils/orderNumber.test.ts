import { describe, it, expect } from 'vitest';
import {
  parseOrderSeq,
  orderSeqSortValue,
  formatOrderNumber,
  nextOrderSeq,
  preferTicketNumber,
  mergeOrderRecords,
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
});
