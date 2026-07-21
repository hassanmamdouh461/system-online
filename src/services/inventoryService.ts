import { InventoryItem, InventoryTransaction, RecipeIngredient } from '../global';
import { getDB, CLIENT_B_INITIAL_INVENTORY } from '../repositories/indexeddb/db';

const WEB_RECIPES_STORAGE_KEY = 'web_menu_recipes_store';

// ☕ Default realistic recipes seeded for all 40 menu items using exact inventory raw materials:
const DEFAULT_WEB_RECIPES: Record<string, RecipeIngredient[]> = {
  // 1: إسبيريسو
  '1': [{ inventoryItemId: 'inv_b_1', quantity: 0.009 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 2: إسبيريسو دبل
  '2': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 3: كورنادو
  '3': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.06 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 4: فلات وايت
  '4': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.15 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 5: لاتيه
  '5': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 6: كابوتشينو
  '6': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.18 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 7: سبانش لاتيه
  '7': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_6', quantity: 0.02 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 8: أمريكاو
  '8': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 9: كافيه موكا
  '9': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_5', quantity: 0.02 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 10: قهوة تركي
  '10': [{ inventoryItemId: 'inv_b_1', quantity: 0.012 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 11: قهوة فرنساوي
  '11': [{ inventoryItemId: 'inv_b_1', quantity: 0.012 }, { inventoryItemId: 'inv_b_2', quantity: 0.10 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 12: أمريكانو بارد
  '12': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 13: لاتيه بارد
  '13': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 14: سبانش لاتيه بارد
  '14': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_6', quantity: 0.02 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 15: كراميل ماكياتو بارد
  '15': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_6', quantity: 0.025 }, { inventoryItemId: 'inv_b_7', quantity: 0.01 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 16: موكا باردة
  '16': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_5', quantity: 0.025 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 17: كولد برو
  '17': [{ inventoryItemId: 'inv_b_1', quantity: 0.025 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 18: بستاشيو لاتيه بارد
  '18': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_8', quantity: 0.02 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 19: موكا فرابيه
  '19': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.15 }, { inventoryItemId: 'inv_b_5', quantity: 0.03 }, { inventoryItemId: 'inv_b_10', quantity: 0.05 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 20: كراميل فرابيه
  '20': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.15 }, { inventoryItemId: 'inv_b_6', quantity: 0.03 }, { inventoryItemId: 'inv_b_10', quantity: 0.05 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 21: قهوة فرابيه
  '21': [{ inventoryItemId: 'inv_b_1', quantity: 0.018 }, { inventoryItemId: 'inv_b_2', quantity: 0.15 }, { inventoryItemId: 'inv_b_10', quantity: 0.05 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 22: أوريو فرابيه
  '22': [{ inventoryItemId: 'inv_b_1', quantity: 0.015 }, { inventoryItemId: 'inv_b_2', quantity: 0.15 }, { inventoryItemId: 'inv_b_9', quantity: 3 }, { inventoryItemId: 'inv_b_5', quantity: 0.015 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 23: ميلك شيك أوريو
  '23': [{ inventoryItemId: 'inv_b_2', quantity: 0.25 }, { inventoryItemId: 'inv_b_9', quantity: 4 }, { inventoryItemId: 'inv_b_10', quantity: 0.10 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 24: ميلك شيك فراولة
  '24': [{ inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_24', quantity: 0.10 }, { inventoryItemId: 'inv_b_10', quantity: 0.10 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 25: ميلك شيك شوكولاتة
  '25': [{ inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_5', quantity: 0.03 }, { inventoryItemId: 'inv_b_10', quantity: 0.10 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 26: ميلك شيك فانيليا
  '26': [{ inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_7', quantity: 0.02 }, { inventoryItemId: 'inv_b_10', quantity: 0.15 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 27: ميلك شيك مانجو
  '27': [{ inventoryItemId: 'inv_b_2', quantity: 0.20 }, { inventoryItemId: 'inv_b_24', quantity: 0.10 }, { inventoryItemId: 'inv_b_10', quantity: 0.10 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 28: شاي أخضر
  '28': [{ inventoryItemId: 'inv_b_11', quantity: 0.005 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 29: شاي كرك
  '29': [{ inventoryItemId: 'inv_b_11', quantity: 0.006 }, { inventoryItemId: 'inv_b_2', quantity: 0.05 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 30: عصير ليمون بالنعناع
  '30': [{ inventoryItemId: 'inv_b_13', quantity: 0.10 }, { inventoryItemId: 'inv_b_14', quantity: 0.20 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 31: شاي مثلج بالخوخ
  '31': [{ inventoryItemId: 'inv_b_11', quantity: 0.005 }, { inventoryItemId: 'inv_b_12', quantity: 0.03 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 32: موهيتو باشون فروت
  '32': [{ inventoryItemId: 'inv_b_13', quantity: 0.05 }, { inventoryItemId: 'inv_b_12', quantity: 0.03 }, { inventoryItemId: 'inv_b_14', quantity: 0.25 }, { inventoryItemId: 'inv_b_3', quantity: 1 }],
  // 33: كلوب ساندوتش كلاسيك
  '33': [{ inventoryItemId: 'inv_b_4', quantity: 3 }, { inventoryItemId: 'inv_b_15', quantity: 0.10 }, { inventoryItemId: 'inv_b_22', quantity: 0.05 }, { inventoryItemId: 'inv_b_23', quantity: 0.01 }],
  // 34: تشيز برجر لحم بقري
  '34': [{ inventoryItemId: 'inv_b_16', quantity: 0.15 }, { inventoryItemId: 'inv_b_4', quantity: 1 }, { inventoryItemId: 'inv_b_17', quantity: 0.03 }, { inventoryItemId: 'inv_b_22', quantity: 0.03 }, { inventoryItemId: 'inv_b_23', quantity: 0.015 }],
  // 35: ساندوتش دجاج بانيه
  '35': [{ inventoryItemId: 'inv_b_15', quantity: 0.12 }, { inventoryItemId: 'inv_b_4', quantity: 1 }, { inventoryItemId: 'inv_b_17', quantity: 0.02 }, { inventoryItemId: 'inv_b_22', quantity: 0.03 }, { inventoryItemId: 'inv_b_23', quantity: 0.015 }],
  // 36: كرواسون تركي وجبنة
  '36': [{ inventoryItemId: 'inv_b_20', quantity: 1 }, { inventoryItemId: 'inv_b_18', quantity: 0.04 }, { inventoryItemId: 'inv_b_17', quantity: 0.03 }],
  // 37: ساندوتش جبنة مشوية
  '37': [{ inventoryItemId: 'inv_b_4', quantity: 2 }, { inventoryItemId: 'inv_b_17', quantity: 0.08 }],
  // 38: بطاطس بالجبنة
  '38': [{ inventoryItemId: 'inv_b_19', quantity: 0.20 }, { inventoryItemId: 'inv_b_17', quantity: 0.05 }],
  // 39: كيكة شوكولاتة فادج
  '39': [{ inventoryItemId: 'inv_b_21', quantity: 0.08 }, { inventoryItemId: 'inv_b_5', quantity: 0.03 }],
  // 40: براوني شوكولاتة دافئة
  '40': [{ inventoryItemId: 'inv_b_21', quantity: 0.07 }, { inventoryItemId: 'inv_b_5', quantity: 0.02 }, { inventoryItemId: 'inv_b_10', quantity: 0.05 }]
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
      let items = (await (db as any).getAll('inventory')) || [];
      
      // Auto-merge missing initial items if IndexedDB has old incomplete list
      if (items.length < CLIENT_B_INITIAL_INVENTORY.length) {
        const tx = db.transaction('inventory', 'readwrite');
        for (const item of CLIENT_B_INITIAL_INVENTORY) {
          const existing = await tx.objectStore('inventory').get(item.id);
          if (!existing) {
            await tx.objectStore('inventory').put(item);
          }
        }
        await tx.done;
        items = (await (db as any).getAll('inventory')) || [];
      }

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
        return ingredients.map(ing => {
          let resolvedId = ing.inventoryItemId;
          const exists = currentInv.some(i => i.id === resolvedId);
          if (!exists && currentInv.length > 0) {
            resolvedId = currentInv[0].id;
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
