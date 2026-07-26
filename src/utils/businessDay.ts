/**
 * businessDay — Single source of truth for "which day does a timestamp belong to?"
 *
 * WHY THIS EXISTS
 * ---------------
 * Restaurants routinely operate past midnight. If day boundaries are pinned to
 * calendar midnight (00:00), an order opened at 11:50pm and paid at 12:10am is
 * split across two different days — its COUNT lands on one day and its REVENUE
 * on the next. Reports and the dashboard then disagree with the cash drawer.
 *
 * The fix: every analytics / report / cash-close surface funnels day bucketing
 * through the helpers below. A configurable `dayStartHour` (from store settings)
 * defines when a new business day begins (e.g. 6 = 6am). Any timestamp earlier
 * than `dayStartHour` is attributed to the PREVIOUS calendar day.
 *
 * FIELD POLICY (intentional, see thread decision):
 *   • Revenue  → attributed to PAYMENT time  → revenueTimestamp() = paidAt || createdAt
 *   • Count    → attributed to CREATION time → countTimestamp()   = createdAt
 *     (Unpaid / OnAccount orders have no paidAt, so creation time is the only
 *      field present on every order — it is what "order volume" must key off.)
 *   Both are routed through the SAME businessDayKey(), so for the classic
 *   cross-midnight order they resolve to the same business day whenever
 *   dayStartHour is set to the venue's opening hour.
 */
import type { AnalyticsPeriod } from '../hooks/useAnalytics';
import type { Order } from '../types/order';
import { getStoreConfig } from './settingsConfig';

/** Default: 0 = calendar midnight, i.e. identical to legacy behaviour. */
export const DEFAULT_DAY_START_HOUR = 0;

/**
 * Business-day start hour (integer 0–23) from store settings.
 * 0 means the day starts at calendar midnight (legacy behaviour).
 * Set to e.g. 6 for a venue whose business day rolls over at 6am.
 */
export function getDayStartHour(): number {
  try {
    const h = (getStoreConfig() as { dayStartHour?: number }).dayStartHour;
    if (typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 23) {
      return Math.floor(h);
    }
  } catch {
    // ignore — fall through to default
  }
  return DEFAULT_DAY_START_HOUR;
}

/**
 * Return a Date shifted back by `startHour`, so its *calendar date* equals the
 * business day the original timestamp belongs to. Date arithmetic normalises
 * month/year rollovers automatically (e.g. Jan 1 00:10 → Dec 31 with start=6).
 */
export function businessDate(
  input: string | Date,
  startHour: number = getDayStartHour(),
): Date {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  d.setHours(d.getHours() - startHour);
  return d;
}

/**
 * Stable 'YYYY-MM-DD' key for the business day a timestamp belongs to.
 * Returns null for missing / unparseable input so callers can skip safely.
 */
export function businessDayKey(
  dateStr: string | undefined | null,
  startHour: number = getDayStartHour(),
): string | null {
  if (!dateStr) return null;
  const raw = new Date(dateStr);
  if (isNaN(raw.getTime())) return null;
  const b = businessDate(raw, startHour);
  const y = b.getFullYear();
  const m = String(b.getMonth() + 1).padStart(2, '0');
  const day = String(b.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Does `dateStr` fall inside `period`, measured in business days?
 * `now` and `startHour` are injectable so hot loops read settings only once.
 */
export function inBusinessPeriod(
  dateStr: string | undefined | null,
  period: AnalyticsPeriod,
  startHour: number = getDayStartHour(),
  now: Date = new Date(),
): boolean {
  if (!dateStr) return false;
  const raw = new Date(dateStr);
  if (isNaN(raw.getTime())) return false;

  const b = businessDate(raw, startHour);   // business date of the record
  const nb = businessDate(now, startHour);  // business date of "now"

  switch (period) {
    case 'Today':
      return (
        b.getFullYear() === nb.getFullYear() &&
        b.getMonth() === nb.getMonth() &&
        b.getDate() === nb.getDate()
      );
    case 'This Week': {
      const start = new Date(nb);
      // Week starts Monday: (getDay()+6)%7 gives 0 for Monday.
      start.setDate(nb.getDate() - ((nb.getDay() + 6) % 7));
      start.setHours(0, 0, 0, 0);
      const bDateOnly = new Date(b.getFullYear(), b.getMonth(), b.getDate());
      return bDateOnly >= start;
    }
    case 'This Month':
      return b.getFullYear() === nb.getFullYear() && b.getMonth() === nb.getMonth();
    case 'This Year':
      return b.getFullYear() === nb.getFullYear();
    default:
      return false;
  }
}

/** Timestamp an order's REVENUE is attributed to (payment time, creation fallback). */
export function revenueTimestamp(o: Pick<Order, 'paidAt' | 'createdAt'>): string {
  return o.paidAt || o.createdAt;
}

/** Timestamp an order's COUNT / volume is attributed to (creation time). */
export function countTimestamp(o: Pick<Order, 'createdAt'>): string {
  return o.createdAt;
}
