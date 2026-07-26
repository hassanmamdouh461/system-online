/**
 * ============================================================================
 *  money.ts — the ONLY place money arithmetic is allowed to happen.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * JavaScript numbers are IEEE-754 binary floats. Decimal money is not
 * representable in binary, so raw arithmetic drifts:
 *
 *    3 * 33.33            === 99.99000000000001
 *    99.99 * 0.14         === 13.998600000000002
 *    99.99 + 13.9986      === 112.4886
 *    3 * 33.33 * 1.14     === 112.49999999999999   <-- stored in the DB
 *
 * `.toFixed(2)` on the *screen* hides this, but the drifted number is what got
 * persisted, summed into reports, and pushed to D1. Then the cash drawer
 * disagrees with the report by a few piasters and nobody can find why.
 *
 * THE RULE
 * --------
 *   ❌ NEVER write `*`, `+`, `-` or `/` directly on a money value.
 *   ✅ ALWAYS route it through a helper in this file.
 *
 * If you need an operation that doesn't exist here, ADD IT HERE. Do not
 * open-code it at the call site — that is exactly how this bug happened.
 *
 * HOW IT WORKS
 * ------------
 * Every helper converts to *minor units* (piasters / قروش — integers), does the
 * arithmetic in integer space where it is exact, then converts back. Sums of
 * many values are therefore exact, not "exact-ish".
 *
 * The public surface still speaks in major units (EGP as `number`) so this is a
 * drop-in change: no type migration, no DB column change. Storing minor units
 * end-to-end would be stronger still, but this closes the bug today without a
 * schema migration — see `toMinor` / `fromMinor` for the eventual on-ramp.
 */

/** Minor units per major unit. 100 piasters (قرش) = 1 EGP. */
export const MINOR_UNITS_PER_MAJOR = 100;

/** Decimal places money is stored and displayed with. */
export const MONEY_DECIMALS = 2;

/**
 * Scale used to strip binary-representation dust before rounding.
 *
 * `11249.999999999998` is *meant* to be `11250`. Rounding it directly is fine,
 * but a genuine `.5` boundary that arrived as `100.49999999999999` (from
 * `1.005 * 100`) would round DOWN and lose a piaster. De-dusting at 1e6 first
 * snaps that back to `100.5` so the half-up rule applies to the value the
 * accountant actually means.
 */
const DUST_SCALE = 1e6;

/* ------------------------------------------------------------------------- *
 * Coercion
 * ------------------------------------------------------------------------- */

/**
 * Coerce anything that arrived from D1 / IndexedDB / a form input into a safe
 * money number. `null`, `undefined`, `''`, `NaN` and `Infinity` all become 0.
 *
 * Use this at every boundary where money enters the app.
 */
export function safeMoney(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** True when `value` is a usable money figure (finite number, not NaN). */
export function isMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/* ------------------------------------------------------------------------- *
 * Minor-unit core — everything else is built on these two
 * ------------------------------------------------------------------------- */

/**
 * Convert major units (EGP) to minor units (piasters) as an exact integer.
 * This is the primitive that makes the rest of the file correct.
 */
export function toMinor(amount: unknown): number {
  const value = safeMoney(amount);
  if (value === 0) return 0;
  const scaled = value * MINOR_UNITS_PER_MAJOR;
  // De-dust, then round half-away-from-zero (symmetric for debits/credits).
  const dedusted = Math.round(scaled * DUST_SCALE) / DUST_SCALE;
  return dedusted < 0 ? -Math.round(-dedusted) : Math.round(dedusted);
}

/** Convert minor units (piasters) back to major units (EGP). */
export function fromMinor(minor: unknown): number {
  const value = safeMoney(minor);
  if (value === 0) return 0;
  return Math.round(value) / MINOR_UNITS_PER_MAJOR;
}

/* ------------------------------------------------------------------------- *
 * Rounding
 * ------------------------------------------------------------------------- */

/**
 * Snap a money value to the piaster. Idempotent and safe on garbage input.
 *
 *   roundMoney(112.49999999999999) === 112.5
 *   roundMoney(1.005)              === 1.01
 *   roundMoney(undefined as any)   === 0
 *
 * Every value that is about to be **stored, printed, or compared** must pass
 * through this (or through a helper below, which already applies it).
 */
export function roundMoney(amount: unknown): number {
  return fromMinor(toMinor(amount));
}

/** Round, then clamp negatives to zero. For totals that can never be < 0. */
export function roundMoneyNonNegative(amount: unknown): number {
  const rounded = roundMoney(amount);
  return rounded > 0 ? rounded : 0;
}

/* ------------------------------------------------------------------------- *
 * Arithmetic primitives
 * ------------------------------------------------------------------------- */

/** Exact addition of any number of money values. */
export function addMoney(...amounts: unknown[]): number {
  let minor = 0;
  for (const amount of amounts) minor += toMinor(amount);
  return fromMinor(minor);
}

/** Exact subtraction: `minuend - each subtrahend`. */
export function subtractMoney(minuend: unknown, ...subtrahends: unknown[]): number {
  let minor = toMinor(minuend);
  for (const s of subtrahends) minor -= toMinor(s);
  return fromMinor(minor);
}

/**
 * Multiply money by a *count or rate* (the multiplier is NOT money).
 * Integer multipliers stay exact; fractional ones round once, at the end.
 */
export function multiplyMoney(amount: unknown, multiplier: unknown): number {
  const factor = safeMoney(multiplier);
  if (factor === 0) return 0;
  if (Number.isInteger(factor)) return fromMinor(toMinor(amount) * factor);
  return roundMoney(safeMoney(amount) * factor);
}

/** Divide money by a non-money divisor. Divide-by-zero yields 0, not Infinity. */
export function divideMoney(amount: unknown, divisor: unknown): number {
  const d = safeMoney(divisor);
  if (d === 0) return 0;
  return roundMoney(safeMoney(amount) / d);
}

/** Exact sum of a list of money values. */
export function sumMoney(amounts: Iterable<unknown>): number {
  let minor = 0;
  for (const amount of amounts) minor += toMinor(amount);
  return fromMinor(minor);
}

/** Exact sum over a collection via a selector. Replaces `reduce((s, x) => s + …)`. */
export function sumMoneyBy<T>(items: readonly T[] | null | undefined, select: (item: T) => unknown): number {
  if (!items || items.length === 0) return 0;
  let minor = 0;
  for (const item of items) minor += toMinor(select(item));
  return fromMinor(minor);
}

/** Mean of a money total over a count. Returns 0 when count is 0. */
export function averageMoney(total: unknown, count: unknown): number {
  const n = safeMoney(count);
  if (n <= 0) return 0;
  return roundMoney(safeMoney(total) / n);
}

/** Larger / smaller of two money values, both rounded. */
export function maxMoney(...amounts: unknown[]): number {
  return fromMinor(Math.max(...amounts.map(toMinor), 0));
}
export function minMoney(...amounts: unknown[]): number {
  return fromMinor(Math.min(...amounts.map(toMinor)));
}

/** Piaster-exact equality. Use instead of `a === b` on money. */
export function moneyEquals(a: unknown, b: unknown): boolean {
  return toMinor(a) === toMinor(b);
}

/** `-1 | 0 | 1` comparison, piaster-exact. Handy as a sort comparator. */
export function compareMoney(a: unknown, b: unknown): number {
  const am = toMinor(a);
  const bm = toMinor(b);
  return am === bm ? 0 : am < bm ? -1 : 1;
}

/* ------------------------------------------------------------------------- *
 * Domain helpers — line items, tax, totals
 * ------------------------------------------------------------------------- */

/** Anything with a unit price and a quantity. */
export interface PricedLine {
  price: number;
  quantity: number;
}

/**
 * Total for one line: unit price × quantity, rounded to the piaster.
 *
 * This is THE definition of a line total. The receipt, the invoice list, the
 * stored subtotal and the analytics allocation must all call this so they agree
 * to the millieme instead of each doing its own `price * quantity`.
 */
export function lineTotal(price: unknown, quantity: unknown): number {
  return multiplyMoney(price, safeMoney(quantity));
}

/**
 * Pre-tax subtotal of an order: the exact sum of its rounded line totals.
 *
 * This is THE definition of `order.totalAmount`. Because the receipt renders
 * each line with `lineTotal()` and the subtotal with this, the printed lines
 * always sum to the printed subtotal — the invariant issue B.1 asked for.
 */
export function sumLineTotals(lines: readonly PricedLine[] | null | undefined): number {
  return sumMoneyBy(lines, l => lineTotal(l?.price, l?.quantity));
}

/** Tax on a subtotal at a fractional rate (0.14 = 14%). Never negative. */
export function calcTax(subtotal: unknown, taxRate: unknown): number {
  const rate = safeMoney(taxRate);
  if (rate <= 0) return 0;
  return roundMoneyNonNegative(safeMoney(subtotal) * rate);
}

/** Grand total = subtotal + tax, exact and clamped at zero. */
export function calcGrandTotal(subtotal: unknown, taxAmount: unknown): number {
  const total = addMoney(subtotal, taxAmount);
  return total > 0 ? total : 0;
}

/** Change due back to the customer. Never negative (under-payment → 0). */
export function calcChangeDue(received: unknown, total: unknown): number {
  const change = subtractMoney(received, total);
  return change > 0 ? change : 0;
}

/**
 * Split a money total across weights so the parts sum **exactly** to the total.
 *
 * Naive per-part rounding leaks piasters: allocating 100.00 across three equal
 * weights gives 33.33 × 3 = 99.99. This uses largest-remainder, so the lost
 * piaster is handed to the part with the biggest fractional claim.
 *
 * Used for per-item revenue attribution in analytics, where the parts must
 * reconcile back to reported revenue.
 */
export function allocateMoney(total: unknown, weights: readonly number[]): number[] {
  if (!weights || weights.length === 0) return [];

  const totalMinor = toMinor(total);
  const safeWeights = weights.map(w => (Number.isFinite(w) && w > 0 ? w : 0));
  const weightSum = safeWeights.reduce((s, w) => s + w, 0);

  // No usable weights — put everything in the first slot rather than lose it.
  if (weightSum <= 0) {
    const parts = safeWeights.map(() => 0);
    parts[0] = fromMinor(totalMinor);
    return parts;
  }

  const exact = safeWeights.map(w => (totalMinor * w) / weightSum);
  const floors = exact.map(Math.floor);
  let remainder = totalMinor - floors.reduce((s, f) => s + f, 0);

  // Hand out the leftover piasters to the largest fractional remainders.
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; remainder > 0 && i < order.length; i++, remainder--) {
    floors[order[i].index] += 1;
  }

  return floors.map(fromMinor);
}

/* ------------------------------------------------------------------------- *
 * Percentages (ratios, not money — returned as plain numbers)
 * ------------------------------------------------------------------------- */

/** `part / whole` as a fraction (0–1). Zero whole → 0, never NaN. */
export function moneyRatio(part: unknown, whole: unknown): number {
  const w = toMinor(whole);
  if (w === 0) return 0;
  return toMinor(part) / w;
}

/** `part / whole` as a whole-number percentage. Zero whole → 0. */
export function moneyPercent(part: unknown, whole: unknown, decimals = 0): number {
  const pct = moneyRatio(part, whole) * 100;
  const factor = 10 ** decimals;
  return Math.round(pct * factor) / factor;
}

/* ------------------------------------------------------------------------- *
 * Formatting
 * ------------------------------------------------------------------------- */

/**
 * Format for display. Rounds *first*, so the string can never disagree with the
 * stored value the way a bare `.toFixed(2)` on a drifted float can.
 */
export function formatMoney(amount: unknown, decimals = MONEY_DECIMALS): string {
  return roundMoney(amount).toFixed(decimals);
}

/** Format with a currency suffix, e.g. `formatMoneyWithCurrency(5, 'ج.م')`. */
export function formatMoneyWithCurrency(amount: unknown, currency: string, decimals = MONEY_DECIMALS): string {
  return `${formatMoney(amount, decimals)} ${currency}`;
}
