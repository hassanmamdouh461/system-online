import { InventoryItem } from '../global';

/**
 * Shared helper to resolve inventory item by ID or legacy 1-indexed fallback ID.
 */
export function resolveInvItem(inventoryItemId: string, inventory: InventoryItem[]): InventoryItem | undefined {
  if (!inventoryItemId || !inventory || inventory.length === 0) return undefined;

  const found = inventory.find(i => i.id === inventoryItemId);
  if (found) return found;

  if (inventoryItemId.startsWith('inv_b_')) {
    const num = parseInt(inventoryItemId.replace('inv_b_', ''), 10);
    if (!isNaN(num) && num > 0 && num <= inventory.length) {
      return inventory[num - 1];
    }
  }

  return undefined;
}
