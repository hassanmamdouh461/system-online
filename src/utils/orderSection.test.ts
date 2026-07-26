import { describe, it, expect } from 'vitest';
import { getItemSection, filterItemsBySection, getOrderStatusForSection } from './orderSection';
import type { Order, OrderItem } from '../types/order';

const item = (over: Partial<OrderItem>): OrderItem => ({
  id: 'i',
  name: 'x',
  quantity: 1,
  price: 1,
  ...over,
});

const order = (over: Partial<Order>): Order => ({
  id: 'o1',
  orderNumber: '1',
  tableId: 'T1',
  status: 'New',
  paymentStatus: 'Unpaid',
  items: [],
  totalAmount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('getItemSection', () => {
  it('routes by the piped prep destination (authoritative)', () => {
    expect(getItemSection('Hot Coffee|Bar')).toBe('drinks');
    expect(getItemSection('ساندوتشات|Kitchen')).toBe('kitchen');
  });

  it('handles legacy flat kitchen categories', () => {
    expect(getItemSection('Kitchen')).toBe('kitchen');
    expect(getItemSection('مأكولات')).toBe('kitchen');
  });

  it('falls back to name keywords when category is absent', () => {
    expect(getItemSection(undefined, 'Chicken Sandwich')).toBe('kitchen');
    expect(getItemSection(undefined, 'برجر لحم')).toBe('kitchen');
  });

  it('defaults unknown items to drinks', () => {
    expect(getItemSection(undefined, 'Latte')).toBe('drinks');
    expect(getItemSection('')).toBe('drinks');
  });
});

describe('filterItemsBySection', () => {
  const items = [
    item({ id: 'a', category: 'Hot Coffee|Bar' }),
    item({ id: 'b', category: 'ساندوتشات|Kitchen' }),
  ];

  it('returns everything for "all"', () => {
    expect(filterItemsBySection(items, 'all')).toHaveLength(2);
  });

  it('splits kitchen vs drinks', () => {
    expect(filterItemsBySection(items, 'kitchen').map((i) => i.id)).toEqual(['b']);
    expect(filterItemsBySection(items, 'drinks').map((i) => i.id)).toEqual(['a']);
  });

  it('tolerates a null/undefined items list', () => {
    expect(filterItemsBySection(undefined as unknown as OrderItem[], 'kitchen')).toEqual([]);
  });
});

describe('getOrderStatusForSection', () => {
  it('short-circuits terminal order statuses', () => {
    expect(getOrderStatusForSection(order({ status: 'Cancelled' }), 'all')).toBe('Cancelled');
    expect(getOrderStatusForSection(order({ status: 'Completed' }), 'drinks')).toBe('Completed');
  });

  it('is Ready for a section with no matching items (does not block the board)', () => {
    const o = order({ items: [item({ category: 'Hot Coffee|Bar', status: 'New' })] });
    expect(getOrderStatusForSection(o, 'kitchen')).toBe('Ready');
  });

  it('aggregates item statuses within a section', () => {
    const o = order({
      items: [
        item({ id: 'a', category: 'Hot Coffee|Bar', status: 'Ready' }),
        item({ id: 'b', category: 'Cold Brew|Bar', status: 'Preparing' }),
      ],
    });
    expect(getOrderStatusForSection(o, 'drinks')).toBe('Preparing');
  });

  it('is Completed only when every item is Completed', () => {
    const o = order({
      items: [
        item({ id: 'a', category: 'Hot Coffee|Bar', status: 'Completed' }),
        item({ id: 'b', category: 'Cold Brew|Bar', status: 'Completed' }),
      ],
    });
    expect(getOrderStatusForSection(o, 'all')).toBe('Completed');
  });
});
