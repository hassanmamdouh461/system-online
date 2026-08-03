import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Order } from '../types/order';
import { countLinkedOrders, isAccountLinkedOrder } from './linkedOrders';

/**
 * Regression guard: the "Linked Orders" card contradicted the page under it.
 *
 * Live observation: the card read 3 while the whole system held 2 orders, and
 * the only customer row below it read "0 paid orders / 0.00".
 *
 * Root cause: `orders.filter(o => o.customerPhone || o.customerId).length` —
 * a raw count over every order, Cancelled included, company-billed orders
 * excluded — while the rows below use customerOrders()/companyOrders().
 */

const order = (o: Partial<Order>): Order =>
  ({
    id: 'o',
    status: 'Completed',
    paymentStatus: 'Paid',
    items: [],
    totalAmount: 0,
    createdAt: new Date().toISOString(),
    ...o,
  }) as Order;

describe('countLinkedOrders', () => {
  it('excludes Cancelled orders', () => {
    const orders = [
      order({ id: '1', customerPhone: '0100', status: 'Cancelled' }),
      order({ id: '2', customerPhone: '0100' }),
    ];
    expect(countLinkedOrders(orders)).toBe(1);
  });

  it('counts company-billed orders that carry no phone', () => {
    // The old filter missed these entirely, so the card disagreed with the
    // company rows underneath it.
    const orders = [order({ id: '1', companyId: 'c1', billedToType: 'company' })];
    expect(countLinkedOrders(orders)).toBe(1);
  });

  it('ignores walk-in orders with no account attribution', () => {
    const orders = [order({ id: '1' }), order({ id: '2', customerId: 'cust1' })];
    expect(countLinkedOrders(orders)).toBe(1);
  });

  it('counts an order billed to a company for a named member exactly once', () => {
    const orders = [
      order({ id: '1', customerId: 'cust1', customerPhone: '0100', companyId: 'c1', billedToType: 'company' }),
    ];
    expect(countLinkedOrders(orders)).toBe(1);
  });

  it('counts open (Unpaid / OnAccount) invoices — they are real linked orders', () => {
    const orders = [
      order({ id: '1', customerPhone: '0100', paymentStatus: 'Unpaid' }),
      order({ id: '2', customerId: 'cust1', paymentStatus: 'OnAccount' }),
    ];
    expect(countLinkedOrders(orders)).toBe(2);
  });

  it('never exceeds the dashboard\'s total non-cancelled order volume', () => {
    const orders = [
      order({ id: '1', customerPhone: '0100' }),
      order({ id: '2' }),
      order({ id: '3', customerId: 'cust1', status: 'Cancelled' }),
    ];
    const dashboardTotal = orders.filter(o => o.status !== 'Cancelled').length;
    expect(countLinkedOrders(orders)).toBeLessThanOrEqual(dashboardTotal);
  });

  it('isAccountLinkedOrder recognises all three attribution fields', () => {
    expect(isAccountLinkedOrder({ customerId: 'x', customerPhone: undefined, companyId: undefined })).toBe(true);
    expect(isAccountLinkedOrder({ customerId: undefined, customerPhone: '0100', companyId: undefined })).toBe(true);
    expect(isAccountLinkedOrder({ customerId: undefined, customerPhone: undefined, companyId: 'c1' })).toBe(true);
    expect(isAccountLinkedOrder({ customerId: undefined, customerPhone: undefined, companyId: undefined })).toBe(false);
  });
});

describe('Customers page wiring', () => {
  const src = readFileSync(resolve(__dirname, '../pages/Customers.tsx'), 'utf8');

  it('the card uses the shared counter, not a raw filter over every order', () => {
    expect(src).toContain('countLinkedOrders(orders)');
    expect(src).not.toContain("orders.filter(o => o.customerPhone || o.customerId).length");
  });
});
