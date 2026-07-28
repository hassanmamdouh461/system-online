import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for re-pricing a frozen-tax order at settle time.
 *
 * handlePaymentComplete used to pass grandTotal: undefined unconditionally,
 * forcing getOrderMoney to re-derive the total from the subtotal at the
 * CURRENT tax rate — re-pricing an old deferred/on-account order (created
 * before a tax-rate change) with the wrong tax. The fix keeps the frozen
 * grandTotal whenever the order carries a real tax snapshot (taxAmount, or
 * an explicit taxRate), and only forces a re-derivation when the order has
 * no tax snapshot at all.
 *
 * The page module mounts React/DOM at import time, so this guard asserts the
 * settle-time decision directly in the page source, plus a live check of the
 * getOrderMoney behavior the fix relies on (frozen taxAmount wins).
 */
import { getOrderMoney } from '../types/order';

const src = readFileSync(resolve(__dirname, './Payment.tsx'), 'utf8');

describe('settle-time tax snapshot', () => {
  it('keeps the frozen grandTotal when the order has a real tax snapshot', () => {
    expect(src).toContain('hasFrozenTaxSnapshot');
    expect(src).toContain('grandTotal: hasFrozenTaxSnapshot ? order?.grandTotal : undefined');
    // The unconditional re-derivation is gone.
    expect(src).not.toContain('grandTotal: undefined, // always re-derive');
  });

  it('getOrderMoney honors a frozen taxAmount over the current rate (behavior the fix relies on)', () => {
    // Order created when tax was 10%: subtotal 100, frozen taxAmount 10.
    // The current rate is now 20% — re-deriving would wrongly tax 20.
    // (taxRate is a fraction: 0.1 = 10%, 0.2 = 20%.)
    const m = getOrderMoney(
      { totalAmount: 100, taxRate: 0.1, taxAmount: 10, grandTotal: 110 },
      /* current rate */ 0.2,
    );
    expect(m.taxAmount).toBe(10);
    expect(m.grandTotal).toBe(110);
  });

  it('getOrderMoney re-derives only when there is genuinely no tax snapshot', () => {
    const m = getOrderMoney(
      { totalAmount: 100, taxRate: undefined, taxAmount: undefined, grandTotal: undefined },
      0.2,
    );
    expect(m.taxAmount).toBe(20);
    expect(m.grandTotal).toBe(120);
  });
});
