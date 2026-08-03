/**
 * Denominators for the manager dashboard's two percentage widgets.
 *
 * The dashboard used ONE count — `totalCount` (= paid orders in the period) —
 * as the denominator for BOTH widgets:
 *
 *   * "Sales by order type" (takeaway / dine-in). Its numerators also come from
 *     the paid set, so paid-as-denominator is CORRECT there and must not move.
 *   * "Invoice payment status" (paid / open). Its open numerator counts orders
 *     that are NOT in the paid set, so dividing by the paid count made paid
 *     always 100% and let open exceed 100% — the two bars summed to 200%.
 *
 * The fix is a SECOND denominator for invoices only (paid + open), never a
 * change to the shared one. These helpers exist as pure functions so the two
 * denominators can be asserted independently in a test.
 */

/** Total invoices in the period: paid + still-open. */
export function invoiceTotalCount(paidCount: number, openCount: number): number {
  return paidCount + openCount;
}

/**
 * Whole-number share for a label, e.g. "1 (50%)".
 * A zero denominator yields 0 rather than NaN.
 */
export function sharePercent(part: number, total: number): number {
  if (!total || !Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(part)) return 0;
  return Math.round((part / total) * 100);
}

/**
 * Unrounded share for a progress-bar width (CSS percentage).
 * A zero denominator yields 0 rather than NaN — an `NaN%` width silently
 * renders as a full-width bar in some engines.
 */
export function shareWidth(part: number, total: number): number {
  if (!total || !Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(part)) return 0;
  return (part / total) * 100;
}
