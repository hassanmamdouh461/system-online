import { MenuItem } from '../types/menu';
import { menuRepository } from '../repositories';

/**
 * Menu Service - Handles CRUD for Menu Items using repository (IndexedDB for Web)
 */
export const menuService = {
  async getAll(branchId?: string): Promise<MenuItem[]> {
    try {
      return await menuRepository.getAll(branchId);
    } catch (error) {
      console.error('[menuService] Error fetching menu:', error);
      return [];
    }
  },

  async create(item: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem> {
    try {
      return await menuRepository.create(item, branchId);
    } catch (error) {
      return await menuRepository.create(item, branchId);
    }
  },

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    try {
      return await menuRepository.update(id, data);
    } catch (error) {
      return await menuRepository.update(id, data);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      await menuRepository.delete(id);
    } catch (error) {
      await menuRepository.delete(id);
    }
  },

  async resetToDefaults(defaultItems: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]> {
    try {
      return await menuRepository.resetToDefaults(defaultItems, branchId);
    } catch (error) {
      return await menuRepository.resetToDefaults(defaultItems, branchId);
    }
  },
};
