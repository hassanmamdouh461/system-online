import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fractionToPercent, formatPercent, percentToFraction } from './percent';

/**
 * Regression guard for the broken number shown to the customer.
 *
 * The tax rate is stored as a fraction, and `0.14 * 100` is
 * `14.000000000000002` in floating point — which is exactly what the payment
 * screen printed: "الضريبة (14.000000000000002%)".
 *
 * The fix must not swing to the other extreme either: `toFixed(0)` would round
 * a genuine 14.5% rate to 15%.
 */
describe('fractionToPercent', () => {
  it('kills the float noise the payment screen was showing', () => {
    // The bug, verbatim.
    expect(0.14 * 100).not.toBe(14);
    expect(String(0.14 * 100)).toBe('14.000000000000002');

    expect(fractionToPercent(0.14)).toBe(14);
    expect(formatPercent(0.14)).toBe('14');
  });

  it('keeps a real fractional rate intact (14.5% must not become 15%)', () => {
    expect(fractionToPercent(0.145)).toBe(14.5);
    expect(formatPercent(0.145)).toBe('14.5');
    expect(formatPercent(0.0725)).toBe('7.25');
  });

  it('handles the ordinary rates a shop actually configures', () => {
    expect(formatPercent(0)).toBe('0');
    expect(formatPercent(0.05)).toBe('5');
    expect(formatPercent(0.1)).toBe('10');
    expect(formatPercent(0.15)).toBe('15');
    expect(formatPercent(0.2)).toBe('20');
  });

  it('degrades safely on junk instead of printing NaN at the till', () => {
    expect(formatPercent(undefined)).toBe('0');
    expect(formatPercent(NaN)).toBe('0');
    expect(formatPercent('nonsense')).toBe('0');
  });
});

describe('percentToFraction', () => {
  it('never stores float noise back into the setting', () => {
    // What the modal used to do with the typed value.
    expect(percentToFraction(14)).toBe(0.14);
    expect(percentToFraction(14.5)).toBe(0.145);
    expect(percentToFraction(7.25)).toBe(0.0725);
    expect(String(percentToFraction(14))).toBe('0.14');
  });

  it('round-trips every rate the UI can produce', () => {
    for (const percent of [0, 5, 7.25, 10, 14, 14.5, 15, 20, 100]) {
      expect(fractionToPercent(percentToFraction(percent))).toBe(percent);
    }
  });
});

describe('the display helper is used everywhere a rate is shown', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

  it('PaymentModal renders both tax labels through the helper', () => {
    const src = read('../components/payment/PaymentModal.tsx');
    expect(src).toContain("formatPercent(taxRate)");
    // The raw multiplication (and the truncating toFixed(0)) are gone.
    expect(src).not.toContain('taxRate * 100');
    expect(src).not.toContain('(taxRate * 100).toFixed(0)');
  });

  it('StoreConfigModal seeds and saves the tax field through the helpers', () => {
    const src = read('../components/settings/StoreConfigModal.tsx');
    expect(src).toContain('setTaxInput(formatPercent(getTaxRate()))');
    expect(src).toContain('setTaxRate(percentToFraction(rate))');
    expect(src).not.toContain('getTaxRate() * 100');
    expect(src).not.toContain('setTaxRate(rate / 100)');
  });

  it('the printed receipt uses it too', () => {
    const src = read('./printReceipts.ts');
    expect(src).toContain('formatPercent(taxRate)');
    expect(src).not.toContain('(taxRate * 100).toFixed(0)');
  });
});
