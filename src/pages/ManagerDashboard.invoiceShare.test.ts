import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { invoiceTotalCount, sharePercent, shareWidth } from '../utils/dashboardCounts';

/**
 * Regression guard: "Invoice Payment Status" percentages summed to 200%.
 *
 * Observed on a live period holding exactly one paid and one open invoice:
 * "Paid Invoices 1 (100%)" AND "Open Invoices 1 (100%)" at the same time.
 *
 * Root cause: both bars divided by `totalCount`, which is
 * `analytics.completedPeriod.length` — the PAID orders only. Paid over paid is
 * always 100%, and the open count divided by the paid count can exceed 100%.
 *
 * The same `totalCount` is the denominator of the "Sales by order type" widget,
 * where the numerators (takeaway / dine-in) also come from `completedPeriod` —
 * so those percentages are correct today and MUST NOT move. The fix therefore
 * adds a separate `invoiceCount` used only by the invoice widget.
 *
 * The page module mounts React/DOM at import time, so the wiring is asserted
 * against the page source (the pattern used by ManagerDashboard.report.test.ts)
 * while the arithmetic is asserted against the pure helpers.
 */
const src = readFileSync(resolve(__dirname, './ManagerDashboard.tsx'), 'utf8');

describe('invoice share arithmetic', () => {
  it('one paid + one open invoice reads 50% / 50%, not 100% / 100%', () => {
    const paidCount = 1;
    const openCount = 1;
    const invoiceCount = invoiceTotalCount(paidCount, openCount);

    expect(invoiceCount).toBe(2);
    expect(sharePercent(paidCount, invoiceCount)).toBe(50);
    expect(sharePercent(openCount, invoiceCount)).toBe(50);
    expect(sharePercent(paidCount, invoiceCount) + sharePercent(openCount, invoiceCount)).toBe(100);
  });

  it('never lets the two bars exceed 100% combined', () => {
    // The shape that produced the bug: 1 paid, 3 open.
    const invoiceCount = invoiceTotalCount(1, 3);
    expect(sharePercent(1, invoiceCount)).toBe(25);
    expect(sharePercent(3, invoiceCount)).toBe(75);
  });

  it('an open-only period still has a non-zero denominator (widget must render)', () => {
    const invoiceCount = invoiceTotalCount(0, 2);
    expect(invoiceCount).toBe(2);
    expect(sharePercent(0, invoiceCount)).toBe(0);
    expect(sharePercent(2, invoiceCount)).toBe(100);
  });

  it('a truly empty period yields 0, not NaN', () => {
    const invoiceCount = invoiceTotalCount(0, 0);
    expect(invoiceCount).toBe(0);
    expect(sharePercent(0, invoiceCount)).toBe(0);
    expect(shareWidth(0, invoiceCount)).toBe(0);
    expect(Number.isNaN(shareWidth(1, 0))).toBe(false);
  });
});

describe('ManagerDashboard wiring', () => {
  it('exposes a dedicated invoice denominator (paid + open)', () => {
    expect(src).toContain('invoiceCount: invoiceTotalCount(');
  });

  it('the invoice widget divides by invoiceCount, never by totalCount', () => {
    expect(src).toContain('sharePercent(processedData.paidCount, processedData.invoiceCount)');
    expect(src).toContain('sharePercent(processedData.unpaidCount, processedData.invoiceCount)');
    expect(src).toContain('shareWidth(processedData.paidCount, processedData.invoiceCount)');
    expect(src).toContain('shareWidth(processedData.unpaidCount, processedData.invoiceCount)');

    expect(src).not.toContain('processedData.paidCount / processedData.totalCount');
    expect(src).not.toContain('processedData.unpaidCount / processedData.totalCount');
  });

  it('the invoice empty-state guard uses the invoice denominator', () => {
    // An open-invoices-only period used to render "No orders" and hide the
    // open invoices entirely, because the guard tested the paid-only count.
    expect(src).toContain('processedData.invoiceCount === 0');
  });

  it('leaves the order-type widget on the paid-only denominator', () => {
    // Its numerators come from completedPeriod too, so these were already right.
    expect(src).toContain('processedData.takeawayCount / processedData.totalCount');
    expect(src).toContain('processedData.dineInCount / processedData.totalCount');
    expect(src).toContain('totalCount: analytics.completedPeriod.length');
  });
});
