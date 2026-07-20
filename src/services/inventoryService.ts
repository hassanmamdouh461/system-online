import { InventoryItem, InventoryTransaction, RecipeIngredient } from '../global';
import { getDB } from '../repositories/indexeddb/db';

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
      const tx = db.transaction('sync_queue', 'readonly'); // lightweight db check
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
      return [];
    } catch (error) {
      return [];
    }
  },

  async getMenuItemRecipe(menuItemId: string): Promise<RecipeIngredient[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getMenuItemRecipe) {
        return await window.electronAPI.getMenuItemRecipe(menuItemId);
      }
      return [];
    } catch (error) {
      return [];
    }
  },

  async saveMenuRecipe(menuItemId: string, ingredients: RecipeIngredient[]): Promise<RecipeIngredient[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.saveMenuRecipe) {
        return await window.electronAPI.saveMenuRecipe(menuItemId, ingredients);
      }
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
      return 0;
    } catch (error) {
      return 0;
    }
  }
};
