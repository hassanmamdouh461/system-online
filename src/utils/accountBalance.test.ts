import { describe, it, expect } from 'vitest';
import {
  roundMoney,
  isCompanyBilledOrder,
  getCustomerAccountBalance,
  getCompanyAccountBalance,
} from './accountBalance';
import type { Order } from '../types/order';

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

describe('roundMoney', () => {
  it('fixes binary floating point drift', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(19.99 * 3)).toBe(59.97);
  });
});

describe('isCompanyBilledOrder', () => {
  it('is true for an OnAccount order billed to a company', () => {
    expect(
      isCompanyBilledOrder(order({ paymentStatus: 'OnAccount', billedToType: 'company', companyId: 'co1' }))
    ).toBe(true);
  });
  it('infers company billing from companyId + companyName when billedToType is absent', () => {
    expect(
      isCompanyBilledOrder(order({ paymentStatus: 'OnAccount', companyId: 'co1', companyName: 'Acme' }))
    ).toBe(true);
  });
  it('is false for paid, refunded, or customer-billed orders', () => {
    expect(isCompanyBilledOrder(order({ paymentStatus: 'Paid', companyId: 'co1', companyName: 'Acme' }))).toBe(
      false
    );
    expect(
      isCompanyBilledOrder(order({ paymentStatus: 'OnAccount', billedToType: 'customer', companyId: 'co1' }))
    ).toBe(false);
  });
});

describe('getCustomerAccountBalance', () => {
  it('sums only the customer’s own open OnAccount invoices', () => {
    const orders = [
      order({ id: 'a', paymentStatus: 'OnAccount', customerId: 'c1', totalAmount: 100, taxAmount: 0, grandTotal: 100 }),
      order({ id: 'b', paymentStatus: 'Paid', customerId: 'c1', totalAmount: 40, grandTotal: 40 }), // settled → excluded
      order({ id: 'c', paymentStatus: 'OnAccount', billedToType: 'company', companyId: 'co1', totalAmount: 70, grandTotal: 70 }), // company debt → excluded
    ];
    expect(getCustomerAccountBalance(orders, { id: 'c1', phone: '0100' })).toBe(100);
  });

  it('is zero when the customer has no open invoices', () => {
    const orders = [order({ id: 'a', paymentStatus: 'Paid', customerId: 'c1', grandTotal: 40 })];
    expect(getCustomerAccountBalance(orders, { id: 'c1', phone: '0100' })).toBe(0);
  });
});

describe('getCompanyAccountBalance', () => {
  it('sums open invoices billed to the company', () => {
    const orders = [
      order({ id: 'a', paymentStatus: 'OnAccount', billedToType: 'company', companyId: 'co1', totalAmount: 50, taxAmount: 0, grandTotal: 50 }),
      order({ id: 'b', paymentStatus: 'OnAccount', billedToType: 'company', companyId: 'co2', totalAmount: 30, grandTotal: 30 }), // other company
      order({ id: 'c', paymentStatus: 'Paid', billedToType: 'company', companyId: 'co1', grandTotal: 999 }), // settled
    ];
    expect(getCompanyAccountBalance(orders, 'co1')).toBe(50);
  });
});
