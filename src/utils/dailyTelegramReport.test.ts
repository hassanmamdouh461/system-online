/**
 * Unit tests for the automatic daily Telegram report.
 *
 * Covers both halves of the original bug:
 *   1. reportTime / enabled saved by TelegramConfigModal round-trip through
 *      localStorage exactly (the "settings save works" half).
 *   2. The scheduler predicates and report builder actually consume those
 *      saved values (the "feature didn't exist" half).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeDailyReportStats,
  buildDailyReportMessage,
} from './dailyTelegramReport';
import { parseReportTime, isReportDue } from '../hooks/useDailyTelegramReport';
import { getTelegramConfig, setTelegramConfig } from './settingsConfig';
import type { Order } from '../types/order';

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

// ─── Fixtures ────────────────────────────────────────────────────────────────
const NOW = new Date('2026-07-28T23:05:00'); // local wall clock

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: overrides.id ?? `ord_${Math.random().toString(36).slice(2)}`,
    orderNumber: overrides.orderNumber ?? 'ORD-1',
    tableId: overrides.tableId ?? 'Table 1',
    status: overrides.status ?? 'Completed',
    paymentStatus: overrides.paymentStatus ?? 'Paid',
    paymentMethod: overrides.paymentMethod ?? 'Cash',
    items: overrides.items ?? [],
    totalAmount: overrides.totalAmount ?? 0,
    taxRate: overrides.taxRate,
    taxAmount: overrides.taxAmount,
    grandTotal: overrides.grandTotal,
    createdAt: overrides.createdAt ?? '2026-07-28T14:00:00',
    paidAt: overrides.paidAt,
    ...overrides,
  };
}

// ─── 1. localStorage round-trip (settings save path) ─────────────────────────
describe('telegram config localStorage round-trip', () => {
  it('persists reportTime and enabled exactly as saved', () => {
    setTelegramConfig({ botToken: 'tok', chatId: '123', enabled: true, reportTime: '21:30' });
    const read = getTelegramConfig();
    expect(read.enabled).toBe(true);
    expect(read.reportTime).toBe('21:30');
    expect(read.botToken).toBe('tok');
    expect(read.chatId).toBe('123');
  });

  it('restores the original default values when nothing is saved', () => {
    const read = getTelegramConfig();
    expect(read.enabled).toBe(false);
    expect(read.reportTime).toBe('23:00');
    expect(read.botToken).toBe('');
    expect(read.chatId).toBe('');
  });

  it('keeps reportTime when other fields change (no clobbering)', () => {
    setTelegramConfig({ botToken: 'a', chatId: 'b', enabled: true, reportTime: '08:15' });
    setTelegramConfig({ botToken: 'a2', chatId: 'b2', enabled: true, reportTime: '08:15' });
    expect(getTelegramConfig().reportTime).toBe('08:15');
  });
});

// ─── 2. Scheduler predicates ──────────────────────────────────────────────────
describe('parseReportTime', () => {
  it('parses a valid HH:MM string', () => {
    expect(parseReportTime('23:00')).toEqual({ h: 23, m: 0 });
    expect(parseReportTime('08:15')).toEqual({ h: 8, m: 15 });
  });
  it('rejects malformed or out-of-range values', () => {
    expect(parseReportTime('')).toBeNull();
    expect(parseReportTime(undefined)).toBeNull();
    expect(parseReportTime('25:00')).toBeNull();
    expect(parseReportTime('12:75')).toBeNull();
    expect(parseReportTime('not-a-time')).toBeNull();
  });
});

describe('isReportDue', () => {
  it('fires at the configured minute', () => {
    expect(isReportDue(new Date('2026-07-28T23:00:00'), { h: 23, m: 0 }, null)).toBe(true);
  });
  it('fires later in the evening if the page only opened after reportTime', () => {
    expect(isReportDue(new Date('2026-07-28T23:45:00'), { h: 23, m: 0 }, null)).toBe(true);
  });
  it('does not fire before reportTime', () => {
    expect(isReportDue(new Date('2026-07-28T22:59:00'), { h: 23, m: 0 }, null)).toBe(false);
  });
  it('does not fire twice for the same business day', () => {
    expect(isReportDue(new Date('2026-07-28T23:30:00'), { h: 23, m: 0 }, '2026-07-28')).toBe(false);
  });
  it('fires again the next day', () => {
    expect(isReportDue(new Date('2026-07-29T23:00:00'), { h: 23, m: 0 }, '2026-07-28')).toBe(true);
  });
});

// ─── 3. Report computation ────────────────────────────────────────────────────
describe('computeDailyReportStats', () => {
  const orders: Order[] = [
    // Today's paid orders
    makeOrder({ id: '1', paymentMethod: 'Cash', tableId: 'Takeaway', totalAmount: 100, grandTotal: 114, items: [{ id: 'i1', name: 'Latte', quantity: 2, price: 50 }] }),
    makeOrder({ id: '2', paymentMethod: 'Card', tableId: 'Table 3', totalAmount: 50, grandTotal: 57, items: [{ id: 'i2', name: 'Latte', quantity: 1, price: 50 }] }),
    // Today's unpaid order (counts toward volume + receivables, not revenue)
    makeOrder({ id: '3', paymentStatus: 'OnAccount', paymentMethod: 'OnAccount', totalAmount: 80, grandTotal: 91.2 }),
    // Yesterday's paid order — must be excluded
    makeOrder({ id: '4', createdAt: '2026-07-27T20:00:00', paidAt: '2026-07-27T20:05:00', totalAmount: 200, grandTotal: 228 }),
    // Cancelled order today — excluded from everything
    makeOrder({ id: '5', status: 'Cancelled', paymentStatus: 'Unpaid', totalAmount: 999, grandTotal: 999 }),
  ];

  const stats = computeDailyReportStats(orders, 14, NOW, 0);

  it('sums revenue from today’s PAID orders only', () => {
    expect(stats.totalRevenue).toBeCloseTo(171, 2); // 114 + 57
  });
  it('counts all non-cancelled orders created today', () => {
    expect(stats.totalOrdersCount).toBe(3);
  });
  it('splits cash/card with piaster-exact totals', () => {
    expect(stats.cashAmount).toBeCloseTo(114, 2);
    expect(stats.cardAmount).toBeCloseTo(57, 2);
    expect(stats.cashPercentage).toBe(67);
    expect(stats.cardPercentage).toBe(33);
  });
  it('counts takeaway vs dine-in among paid orders', () => {
    expect(stats.takeawayCount).toBe(1);
    expect(stats.dineInCount).toBe(1);
  });
  it('tracks outstanding on-account amounts', () => {
    expect(stats.unpaidAmount).toBeCloseTo(91.2, 2);
    expect(stats.unpaidCount).toBe(1);
  });
  it('aggregates top items by quantity across paid orders', () => {
    expect(stats.topItems[0]).toEqual({ name: 'Latte', count: 3 });
  });
});

// ─── 4. Message rendering ─────────────────────────────────────────────────────
describe('buildDailyReportMessage', () => {
  it('renders Arabic HTML report with escaped dynamic values', () => {
    const stats = computeDailyReportStats(
      [makeOrder({ id: '1', paymentMethod: 'Cash', totalAmount: 100, grandTotal: 114, items: [{ id: 'i1', name: 'A & B <Special>', quantity: 1, price: 114 }] })],
      14,
      NOW,
      0,
    );
    const msg = buildDailyReportMessage(stats, 'فرع & الرئيسي', NOW);
    expect(msg).toContain('التقرير اليومي التلقائي');
    expect(msg).toContain('فرع &amp; الرئيسي');
    expect(msg).toContain('A &amp; B &lt;Special&gt;');
    expect(msg).toContain('114.00');
    expect(msg).not.toContain('<Special>');
  });

  it('renders an honest zero-sale report instead of failing', () => {
    const stats = computeDailyReportStats([], 14, NOW, 0);
    const msg = buildDailyReportMessage(stats, 'Main Branch', NOW);
    expect(msg).toContain('0.00');
    expect(msg).toContain('<b>0</b> طلب');
  });
});
