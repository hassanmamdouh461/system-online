/**
 * Unit conversion utility for inventory and recipe calculations.
 */

export function getIngredientBaseQty(qty: number, selectedUnit: string, baseUnit: string): number {
  if (!qty || isNaN(qty)) return 0;
  const sel = (selectedUnit || '').trim().toLowerCase();
  const base = (baseUnit || '').trim().toLowerCase();

  const isSelKg = sel === 'كجم' || sel === 'kg' || sel === 'كيلو' || sel === 'كيلوجرام';
  const isSelG = sel === 'جرام' || sel === 'g' || sel === 'جم';
  const isBaseKg = base === 'كجم' || base === 'kg' || base === 'كيلو' || base === 'كيلوجرام';
  const isBaseG = base === 'جرام' || base === 'g' || base === 'جم';

  if (isBaseKg && isSelG) return qty / 1000;
  if (isBaseG && isSelKg) return qty * 1000;

  const isSelL = sel === 'لتر' || sel === 'l';
  const isSelMl = sel === 'مل' || sel === 'ml';
  const isBaseL = base === 'لتر' || base === 'l';
  const isBaseMl = base === 'مل' || base === 'ml';

  if (isBaseL && isSelMl) return qty / 1000;
  if (isBaseMl && isSelL) return qty * 1000;

  return qty;
}
