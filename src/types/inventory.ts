export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  costPerUnit: number;
  branchId?: string;
  isSynced?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface InventoryTransaction {
  id: string;
  itemId: string;
  itemName?: string;
  itemUnit?: string;
  unit?: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  referenceId?: string;
  createdAt: string;
  branchId?: string;
  isSynced?: boolean;
  notes?: string;
}

export interface RecipeIngredient {
  menuItemId?: string;
  inventoryItemId: string;
  itemName?: string;
  itemUnit?: string;
  unit?: string;
  costPerUnit?: number;
  quantity: number;
}
