import { MenuItem } from '../types/menu';
import { menuRepository } from '../repositories';

/**
 * Menu Service - Handles CRUD for Menu Items using repository (IndexedDB for Web)
 */
export const menuService = {
  async getAll(branchId?: string): Promise<MenuItem[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getMenu) {
        return await window.electronAPI.getMenu();
      }
      const items = await menuRepository.getAll(branchId);
      if (items && items.length > 0) return items;

      // If local IndexedDB is empty, return initial defaults
      return items;
    } catch (error) {
      console.error('[menuService] Error fetching menu:', error);
      return await menuRepository.getAll(branchId);
    }
  },

  async create(item: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.createMenuItem) {
        return await window.electronAPI.createMenuItem(item);
      }
      return await menuRepository.create(item, branchId);
    } catch (error) {
      return await menuRepository.create(item, branchId);
    }
  },

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.updateMenuItem) {
        return await window.electronAPI.updateMenuItem(id, data);
      }
      return await menuRepository.update(id, data);
    } catch (error) {
      return await menuRepository.update(id, data);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.deleteMenuItem) {
        await window.electronAPI.deleteMenuItem(id);
        return;
      }
      await menuRepository.delete(id);
    } catch (error) {
      await menuRepository.delete(id);
    }
  },

  async resetToDefaults(defaultItems: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.resetMenu) {
        return await window.electronAPI.resetMenu(defaultItems);
      }
      return await menuRepository.resetToDefaults(defaultItems, branchId);
    } catch (error) {
      return await menuRepository.resetToDefaults(defaultItems, branchId);
    }
  },
};
