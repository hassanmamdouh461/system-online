import { describe, it, expect } from 'vitest';
import { getOrderGrandTotal } from './order';

// Revenue recognition is the single most important number in the system, and it
// has a real history of bugs (a null grandTotal coming back from D1 as 0 used to
// zero out revenue). These tests pin the fallback ladder:
//   trusted grandTotal  →  frozen taxAmount  →  taxRate  →  fallbackTaxRate
describe('getOrderGrandTotal', () => {
  it('trusts a real positive grandTotal snapshot', () => {
    expect(getOrderGrandTotal({ totalAmount: 100, taxAmount: 10, grandTotal: 110 })).toBe(110);
  });

  it('ignores grandTotal === 0 (the null-from-D1 bug) and recomputes from taxAmount', () => {
    expect(getOrderGrandTotal({ totalAmount: 100, taxAmount: 10, grandTotal: 0 })).toBe(110);
  });

  it('ignores a negative grandTotal and recomputes', () => {
    expect(getOrderGrandTotal({ totalAmount: 100, taxAmount: 5, grandTotal: -3 })).toBe(105);
  });

  it('computes tax from taxRate when taxAmount is missing', () => {
    expect(getOrderGrandTotal({ totalAmount: 100, taxRate: 0.1 })).toBe(110);
  });

  it('falls back to the provided fallbackTaxRate when no rate/amount is frozen', () => {
    expect(getOrderGrandTotal({ totalAmount: 100 }, 0.14)).toBeCloseTo(114, 5);
  });

  it('prefers the frozen taxAmount over a live fallback rate', () => {
    // taxAmount present → fallbackTaxRate must NOT be applied.
    expect(getOrderGrandTotal({ totalAmount: 200, taxAmount: 0 }, 0.5)).toBe(200);
  });

  it('never returns a negative total', () => {
    expect(getOrderGrandTotal({ totalAmount: -50 }, 0)).toBe(0);
  });
});
