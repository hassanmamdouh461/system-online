import { describe, it, expect, vi } from 'vitest';
import { resolveInvItem } from './inventoryHelpers';
import type { InventoryItem } from '../types/inventory';

const item = (id: string, name: string): InventoryItem =>
  ({ id, name, unit: 'كجم', stock: 10, minStock: 1, costPerUnit: 5 } as unknown as InventoryItem);

describe('resolveInvItem', () => {
  it('resolves by real id', () => {
    const inv = [item('a', 'Beans'), item('b', 'Milk')];
    expect(resolveInvItem('b', inv)?.name).toBe('Milk');
  });

  // IV-019 — the whole point of the fix: never resolve by array position.
  it('does NOT resolve a legacy inv_b_N id by position', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = [item('a', 'Beans'), item('b', 'Milk'), item('c', 'Sugar')];
    const afterDelete = [item('b', 'Milk'), item('c', 'Sugar')];

    // Old behaviour: inv_b_2 → Milk before the delete, Sugar after it.
    expect(resolveInvItem('inv_b_2', before)).toBeUndefined();
    expect(resolveInvItem('inv_b_2', afterDelete)).toBeUndefined();
    warn.mockRestore();
  });

  it('returns undefined for blank input or empty inventory', () => {
    expect(resolveInvItem('', [item('a', 'Beans')])).toBeUndefined();
    expect(resolveInvItem('a', [])).toBeUndefined();
  });
});
