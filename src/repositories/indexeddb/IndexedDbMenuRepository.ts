import { IMenuRepository } from '../types';
import { MenuItem } from '../../types/menu';
import { getDB } from './db';

export class IndexedDbMenuRepository implements IMenuRepository {
  async getAll(branchId?: string): Promise<MenuItem[]> {
    const db = await getDB();
    const items = await db.getAll('menu_items');
    if (!branchId) return items;
    return items.filter(item => !item.branchId || item.branchId === branchId || item.branchId === 'default');
  }

  async create(itemData: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem> {
    const db = await getDB();
    const id = `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newItem: MenuItem = {
      ...itemData,
      id,
      branchId,
    };

    await db.put('menu_items', newItem);

    await db.put('sync_queue', {
      id: `sync_menu_${id}`,
      type: 'menu',
      action: 'create',
      data: newItem,
      timestamp: new Date().toISOString(),
      synced: 0,
    });

    return newItem;
  }

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    const db = await getDB();
    const existing = await db.get('menu_items', id);
    if (!existing) throw new Error(`Menu item ${id} not found`);

    const updated: MenuItem = { ...existing, ...data };
    await db.put('menu_items', updated);

    await db.put('sync_queue', {
      id: `sync_menu_${id}_${Date.now()}`,
      type: 'menu',
      action: 'update',
      data: updated,
      timestamp: new Date().toISOString(),
      synced: 0,
    });

    return updated;
  }

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('menu_items', id);

    await db.put('sync_queue', {
      id: `sync_menu_del_${id}_${Date.now()}`,
      type: 'menu',
      action: 'delete',
      data: { id },
      timestamp: new Date().toISOString(),
      synced: 0,
    });
  }

  async resetToDefaults(defaults: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]> {
    const db = await getDB();
    await db.clear('menu_items');
    const created: MenuItem[] = [];
    for (const item of defaults) {
      const newItem = await this.create(item, branchId);
      created.push(newItem);
    }
    return created;
  }
}
