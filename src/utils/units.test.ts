import { describe, it, expect, vi } from 'vitest';
import { getIngredientBaseQty, getIngredientBaseQtySafe, unitFamily } from './units';

describe('unitFamily', () => {
  it('classifies weight, volume and unknown units', () => {
    expect(unitFamily('كجم')).toBe('weight');
    expect(unitFamily('G')).toBe('weight');
    expect(unitFamily('ml')).toBe('volume');
    expect(unitFamily('لتر')).toBe('volume');
    expect(unitFamily('')).toBe('unknown');
    expect(unitFamily('علبة')).toBe('unknown');
  });
});

describe('getIngredientBaseQty', () => {
  it('converts within the weight family', () => {
    expect(getIngredientBaseQty(500, 'g', 'kg')).toBe(0.5);
    expect(getIngredientBaseQty(2, 'kg', 'جرام')).toBe(2000);
  });

  it('converts within the volume family', () => {
    expect(getIngredientBaseQty(500, 'ml', 'l')).toBe(0.5);
    expect(getIngredientBaseQty(2, 'لتر', 'مل')).toBe(2000);
  });

  // IV-023
  it('refuses a cross-family conversion instead of passing the number through', () => {
    expect(getIngredientBaseQty(500, 'g', 'ml')).toBeNull();
    expect(getIngredientBaseQty(1, 'لتر', 'كجم')).toBeNull();
  });

  it('passes through when a unit is unknown or blank (legacy rows)', () => {
    expect(getIngredientBaseQty(3, '', 'kg')).toBe(3);
    expect(getIngredientBaseQty(3, 'علبة', '')).toBe(3);
    expect(getIngredientBaseQty(3, 'kg', 'kg')).toBe(3);
  });

  it('treats a missing quantity as zero', () => {
    expect(getIngredientBaseQty(0, 'g', 'kg')).toBe(0);
    expect(getIngredientBaseQty(NaN, 'g', 'kg')).toBe(0);
  });
});

describe('getIngredientBaseQtySafe', () => {
  it('degrades an impossible conversion to 0 and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getIngredientBaseQtySafe(500, 'g', 'ml')).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns the converted value for a legal conversion', () => {
    expect(getIngredientBaseQtySafe(500, 'g', 'kg')).toBe(0.5);
  });
});
