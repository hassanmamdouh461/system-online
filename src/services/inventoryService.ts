import { InventoryItem, InventoryTransaction, RecipeIngredient } from '../global';
import { getDB } from '../repositories/indexeddb/db';

const WEB_RECIPES_STORAGE_KEY = 'web_menu_recipes_store';

// ☕ Default realistic recipes seeded for all menu items using stock items:
// inv_b_1: بن إسبيريسو فاخر (kg, EGP 450)
// inv_b_2: حليب كامل الدسم (L, EGP 35)
// inv_b_3: أكواب ورقية سفري (cup, EGP 2)
// inv_b_4: عيش (piece, EGP 3)
const DEFAULT_WEB_RECIPES: Record<string, RecipeIngredient[]> = {
  // 1: إسبيريسو
  '1': [
    { inventoryItemId: 'inv_b_1', quantity: 0.009 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 2: إسبيريسو دبل
  '2': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 3: كورنادو / كورتادو
  '3': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_2', quantity: 0.06 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 4: فلات وايت
  '4': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_2', quantity: 0.15 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 5: لاتيه
  '5': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_2', quantity: 0.20 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 6: كابوتشينو
  '6': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_2', quantity: 0.18 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 7: سبانش لاتيه
  '7': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_2', quantity: 0.20 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 8: أمريكاو
  '8': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 9: كافيه موكا
  '9': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_2', quantity: 0.20 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 10: هوت شوكليت
  '10': [
    { inventoryItemId: 'inv_b_2', quantity: 0.25 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 11: آيس لاتيه
  '11': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_2', quantity: 0.22 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 12: آيس سبانش لاتيه
  '12': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_2', quantity: 0.22 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 13: آيس أمريكانو
  '13': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ],
  // 14: آيس موكا
  '14': [
    { inventoryItemId: 'inv_b_1', quantity: 0.018 },
    { inventoryItemId: 'inv_b_2', quantity: 0.20 },
    { inventoryItemId: 'inv_b_3', quantity: 1 }
  ]
};

function getWebRecipeStore(): Record<string, RecipeIngredient[]> {
  try {
    const raw = localStorage.getItem(WEB_RECIPES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('[inventoryService] Failed to parse web recipes store:', e);
  }
  return {};
}

function setWebRecipeStore(store: Record<string, RecipeIngredient[]>): void {
  try {
    localStorage.setItem(WEB_RECIPES_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[inventoryService] Failed to save web recipes store:', e);
  }
}

/**
 * Inventory Service - Dual Web/Electron Interface for Inventory and Recipes (IndexedDB persisted for Web)
 */
export const inventoryService = {
  async getAll(branchId?: string): Promise<InventoryItem[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getInventory) {
        return await window.electronAPI.getInventory(branchId);
      }
      const db = await getDB();
      const items = (await (db as any).getAll('inventory')) || [];
      if (!branchId) return items;
      return items.filter((i: any) => !i.branchId || i.branchId === branchId);
    } catch (error) {
      console.warn('[inventoryService] Error fetching inventory:', error);
      return [];
    }
  },

  async create(item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<InventoryItem> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.createInventoryItem) {
        return await window.electronAPI.createInventoryItem(item);
      }
      const db = await getDB();
      const newItem: InventoryItem = {
        ...item,
        id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await (db as any).put('inventory', newItem);
      return newItem;
    } catch (error) {
      throw new Error('Failed to create inventory item');
    }
  },

  async update(id: string, data: Partial<Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>>): Promise<InventoryItem> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.updateInventoryItem) {
        return await window.electronAPI.updateInventoryItem(id, data);
      }
      const db = await getDB();
      const existing = await (db as any).get('inventory', id);
      const updated: InventoryItem = {
        ...(existing || { id, name: 'Item', unit: 'unit', stock: 0, minStock: 0, costPerUnit: 0 }),
        ...data,
        updatedAt: new Date().toISOString()
      };
      await (db as any).put('inventory', updated);
      return updated;
    } catch (error) {
      throw new Error('Failed to update inventory item');
    }
  },

  async delete(id: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.deleteInventoryItem) {
        await window.electronAPI.deleteInventoryItem(id);
        return;
      }
      const db = await getDB();
      await (db as any).delete('inventory', id);
    } catch (error) {
      console.error('[inventoryService] Error deleting item:', error);
    }
  },

  async deductStock(itemId: string, quantityDeducted: number): Promise<void> {
    try {
      const items = await this.getAll();
      const target = items.find(i => i.id === itemId);
      if (target) {
        const newStock = Math.max(0, target.stock - quantityDeducted);
        await this.update(target.id, { stock: newStock });
      }
    } catch (err) {
      console.error('[inventoryService] Failed to deduct stock:', err);
    }
  },

  async getTransactions(itemId?: string, branchId?: string): Promise<InventoryTransaction[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getInventoryTransactions) {
        return await window.electronAPI.getInventoryTransactions(itemId, branchId);
      }
      return [];
    } catch (error) {
      return [];
    }
  },

  async createTransaction(tx: Omit<InventoryTransaction, 'id' | 'createdAt'>): Promise<InventoryTransaction> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.createInventoryTransaction) {
        return await window.electronAPI.createInventoryTransaction(tx);
      }
      return { ...tx, id: `tx_${Date.now()}`, createdAt: new Date().toISOString() };
    } catch (error) {
      throw new Error('Failed to create transaction');
    }
  },

  async getMenuRecipes(): Promise<RecipeIngredient[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getMenuRecipes) {
        return await window.electronAPI.getMenuRecipes();
      }
      const store = getWebRecipeStore();
      const allIngredients: RecipeIngredient[] = [];
      Object.values(store).forEach(list => allIngredients.push(...list));
      return allIngredients;
    } catch (error) {
      return [];
    }
  },

  async getMenuItemRecipe(menuItemId: string): Promise<RecipeIngredient[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getMenuItemRecipe) {
        return await window.electronAPI.getMenuItemRecipe(menuItemId);
      }
      const store = getWebRecipeStore();
      let ingredients: RecipeIngredient[] = store[menuItemId];
      
      if (!ingredients || ingredients.length === 0) {
        ingredients = DEFAULT_WEB_RECIPES[menuItemId] || [
          { inventoryItemId: 'inv_b_1', quantity: 0.018 },
          { inventoryItemId: 'inv_b_3', quantity: 1 }
        ];
      }

      // Map ingredient IDs to active inventory item IDs if needed
      const currentInv = await this.getAll();
      if (currentInv.length > 0) {
        const beansItem = currentInv.find(i => i.id === 'inv_b_1' || i.name.includes('بن') || i.name.toLowerCase().includes('espresso') || i.name.toLowerCase().includes('beans'));
        const milkItem = currentInv.find(i => i.id === 'inv_b_2' || i.name.includes('حليب') || i.name.toLowerCase().includes('milk'));
        const cupsItem = currentInv.find(i => i.id === 'inv_b_3' || i.name.includes('أكواب') || i.name.includes('كوب') || i.name.toLowerCase().includes('cup'));
        const breadItem = currentInv.find(i => i.id === 'inv_b_4' || i.name.includes('عيش') || i.name.includes('خبز') || i.name.toLowerCase().includes('bread'));

        return ingredients.map(ing => {
          let resolvedId = ing.inventoryItemId;
          const exists = currentInv.some(i => i.id === resolvedId);
          if (!exists) {
            if (ing.inventoryItemId === 'inv_b_1' && beansItem) resolvedId = beansItem.id;
            else if (ing.inventoryItemId === 'inv_b_2' && milkItem) resolvedId = milkItem.id;
            else if (ing.inventoryItemId === 'inv_b_3' && cupsItem) resolvedId = cupsItem.id;
            else if (ing.inventoryItemId === 'inv_b_4' && breadItem) resolvedId = breadItem.id;
            else if (currentInv.length > 0) resolvedId = currentInv[0].id;
          }
          return { ...ing, inventoryItemId: resolvedId };
        });
      }

      return ingredients;
    } catch (error) {
      return [];
    }
  },

  async saveMenuRecipe(menuItemId: string, ingredients: RecipeIngredient[]): Promise<RecipeIngredient[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.saveMenuRecipe) {
        return await window.electronAPI.saveMenuRecipe(menuItemId, ingredients);
      }
      const store = getWebRecipeStore();
      store[menuItemId] = ingredients;
      setWebRecipeStore(store);
      return ingredients;
    } catch (error) {
      return [];
    }
  },

  async getRecipeCost(menuItemId: string): Promise<number> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getRecipeCost) {
        return await window.electronAPI.getRecipeCost(menuItemId);
      }
      const recipe = await this.getMenuItemRecipe(menuItemId);
      const inventory = await this.getAll();
      return recipe.reduce((sum, ing) => {
        const item = inventory.find(i => i.id === ing.inventoryItemId);
        return sum + (item ? item.costPerUnit * ing.quantity : 0);
      }, 0);
    } catch (error) {
      return 0;
    }
  }
};
