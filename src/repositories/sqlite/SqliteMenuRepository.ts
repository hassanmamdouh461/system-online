import { IMenuRepository } from '../types';
import { MenuItem } from '../../types/menu';

export class SqliteMenuRepository implements IMenuRepository {
  async getAll(branchId?: string): Promise<MenuItem[]> {
    const items = await window.electronAPI.getMenu();
    if (!branchId) return items;
    // Auto-filter by branch_id
    return items.filter(item => !item.branchId || item.branchId === branchId || item.branchId === 'default');
  }

  async create(item: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem> {
    const itemWithBranch = { ...item, branchId };
    return window.electronAPI.createMenuItem(itemWithBranch);
  }

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    return window.electronAPI.updateMenuItem(id, data);
  }

  async delete(id: string): Promise<void> {
    return window.electronAPI.deleteMenuItem(id);
  }

  async resetToDefaults(defaults: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]> {
    const defaultsWithBranch = defaults.map(item => ({ ...item, branchId }));
    return window.electronAPI.resetMenu(defaultsWithBranch);
  }
}
