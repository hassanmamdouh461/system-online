import { InventoryItem } from '../types/inventory';

/**
 * Shared helper to resolve an inventory item referenced by a recipe line.
 *
 * IV-019 — WHY THE POSITIONAL FALLBACK IS GONE
 * --------------------------------------------
 * Legacy recipe rows reference items as `inv_b_N`, and this helper used to
 * resolve them as `inventory[N - 1]` — i.e. by POSITION in the array, not by
 * identity. Deleting any earlier item shifts every later id by one slot, so a
 * recipe that used to point at Milk silently starts pointing at Sugar. Nothing
 * throws; the cost report and the yield calculation just quietly describe the
 * wrong ingredient. Every inventory deletion was a silent time bomb.
 *
 * A wrong item is strictly worse than no item, so an unresolvable legacy id now
 * fails closed. This matches the policy the deduction path already enforces —
 * `inventoryService.getMenuItemRecipe` drops ingredients whose inventory id is
 * unknown rather than remapping them. Affected recipes surface as a one-time
 * console warning and are skipped in costing until an operator re-links them in
 * the menu editor.
 */
const warnedLegacyIds = new Set<string>();

export function resolveInvItem(
  inventoryItemId: string,
  inventory: InventoryItem[]
): InventoryItem | undefined {
  if (!inventoryItemId || !inventory || inventory.length === 0) return undefined;

  const found = inventory.find(i => i.id === inventoryItemId);
  if (found) return found;

  if (inventoryItemId.startsWith('inv_b_') && !warnedLegacyIds.has(inventoryItemId)) {
    warnedLegacyIds.add(inventoryItemId);
    console.warn(
      `[inventoryHelpers] legacy recipe reference "${inventoryItemId}" matches no inventory item and ` +
      `is deliberately NOT resolved by position (IV-019). Re-link this ingredient in the menu editor.`
    );
  }

  return undefined;
}
