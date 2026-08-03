/**
 * Rates are stored as fractions (0.14) and shown as percentages (14%).
 *
 * `0.14 * 100` is `14.000000000000002` in binary floating point, and that string
 * was rendered on the payment screen IN FRONT OF THE CUSTOMER
 * ("الضريبة (14.000000000000002%)") and in the tax field of the settings modal.
 *
 * `toFixed(0)` hides it but lies about any real fractional rate: a 14.5% tax
 * would print as 15%. So round away the binary noise at a precision far below
 * anything a shop would ever configure, and keep every digit the operator
 * actually typed.
 */

/** Digits kept when converting a fraction to a percentage (0.000001% of noise). */
const PERCENT_PRECISION = 6;
/** Digits kept when converting a typed percentage back to a stored fraction. */
const FRACTION_PRECISION = 8;

function roundTo(value: number, digits: number): number {
  // Number(x.toFixed(n)) is exact for the magnitudes involved here (rates), and
  // unlike a *10^n / 10^n round-trip it does not reintroduce its own drift.
  return Number(value.toFixed(digits));
}

/**
 * Stored fraction -> display percentage as a NUMBER.
 *   0.14  -> 14
 *   0.145 -> 14.5
 *   0     -> 0
 */
export function fractionToPercent(fraction: unknown): number {
  const n = typeof fraction === 'number' ? fraction : Number(fraction);
  if (!Number.isFinite(n)) return 0;
  return roundTo(n * 100, PERCENT_PRECISION);
}

/**
 * Stored fraction -> display percentage as a STRING, with no trailing zeros.
 * This is what belongs in any customer-facing label.
 *   0.14  -> "14"
 *   0.145 -> "14.5"
 */
export function formatPercent(fraction: unknown): string {
  return String(fractionToPercent(fraction));
}

/**
 * Typed percentage -> stored fraction, without writing float noise into D1.
 *   14   -> 0.14
 *   14.5 -> 0.145
 */
export function percentToFraction(percent: unknown): number {
  const n = typeof percent === 'number' ? percent : Number(percent);
  if (!Number.isFinite(n)) return 0;
  return roundTo(n / 100, FRACTION_PRECISION);
}
