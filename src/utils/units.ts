/**
 * Unit conversion utility for inventory and recipe calculations.
 *
 * IV-023 — A CROSS-FAMILY CONVERSION IS AN ERROR, NOT A PASS-THROUGH
 * ------------------------------------------------------------------
 * The old implementation handled weight↔weight and volume↔volume and then fell
 * through to `return qty` for everything else. A recipe asking for 500 g of an
 * ingredient stocked in ml therefore deducted 500 ml — wrong by a factor of
 * 1000 or more, with no error surfaced anywhere. Silent pass-through is the
 * worst of the three possible behaviours because it produces a
 * plausible-looking number.
 *
 * `getIngredientBaseQty` now returns `null` when both units are known and
 * belong to DIFFERENT families, so the caller must decide what to do (skip the
 * stock movement, warn the operator) instead of booking a fabricated figure. An
 * unknown/blank unit still passes through unchanged: legacy rows frequently
 * carry no unit at all, and treating those as errors would break normal
 * service.
 */

export type UnitFamily = 'weight' | 'volume' | 'unknown';

const KG = ['كجم', 'kg', 'كيلو', 'كيلوجرام', 'kilogram'];
const G = ['جرام', 'g', 'جم', 'gram'];
const L = ['لتر', 'l', 'liter', 'litre'];
const ML = ['مل', 'ml', 'milliliter', 'millilitre'];

function norm(u: string): string {
  return (u || '').trim().toLowerCase();
}

/** Which measurement family a unit belongs to ('unknown' for blank/count units). */
export function unitFamily(unit: string): UnitFamily {
  const u = norm(unit);
  if (!u) return 'unknown';
  if (KG.includes(u) || G.includes(u)) return 'weight';
  if (L.includes(u) || ML.includes(u)) return 'volume';
  return 'unknown';
}

/**
 * Convert `qty` from `selectedUnit` into `baseUnit`.
 *
 * @returns the converted quantity, or `null` when the two units belong to
 *          different measurement families (weight vs volume) — an impossible
 *          conversion the caller must handle rather than silently book.
 */
export function getIngredientBaseQty(
  qty: number,
  selectedUnit: string,
  baseUnit: string
): number | null {
  if (!qty || isNaN(qty)) return 0;
  const sel = norm(selectedUnit);
  const base = norm(baseUnit);

  const selFamily = unitFamily(sel);
  const baseFamily = unitFamily(base);

  // Both families known and different → impossible conversion.
  if (selFamily !== 'unknown' && baseFamily !== 'unknown' && selFamily !== baseFamily) {
    return null;
  }

  const isSelKg = KG.includes(sel);
  const isSelG = G.includes(sel);
  const isBaseKg = KG.includes(base);
  const isBaseG = G.includes(base);

  if (isBaseKg && isSelG) return qty / 1000;
  if (isBaseG && isSelKg) return qty * 1000;

  const isSelL = L.includes(sel);
  const isSelMl = ML.includes(sel);
  const isBaseL = L.includes(base);
  const isBaseMl = ML.includes(base);

  if (isBaseL && isSelMl) return qty / 1000;
  if (isBaseMl && isSelL) return qty * 1000;

  return qty;
}

/**
 * Display / costing helper: same conversion, but an impossible one degrades to
 * 0 with a console warning instead of propagating `null` into arithmetic.
 *
 * Use this on read-only surfaces (cost estimates, reports). NEVER use it on a
 * stock-movement path — there the caller must skip the movement entirely so a
 * misconfigured recipe cannot quietly write a wrong stock level.
 */
export function getIngredientBaseQtySafe(
  qty: number,
  selectedUnit: string,
  baseUnit: string,
  context = ''
): number {
  const converted = getIngredientBaseQty(qty, selectedUnit, baseUnit);
  if (converted === null) {
    console.warn(
      `[units] incompatible units: cannot convert ${qty} "${selectedUnit}" → "${baseUnit}"${context ? ` (${context})` : ''}`
    );
    return 0;
  }
  return converted;
}
