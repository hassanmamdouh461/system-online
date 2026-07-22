import { IMenuRepository } from '../types';
import { MenuItem } from '../../types/menu';
import { withDB, enqueueWrite } from './db';
import { syncService } from '../../services/syncService';
import { cloudGetCollection, cloudUpsert, cloudDeleteDocument } from '../../services/cloudConfig';

function mapRemoteMenu(doc: any): MenuItem {
  return {
    id: String(doc.id || doc.$id),
    name: doc.name || 'صنف',
    price: Number(doc.price) || 0,
    category: doc.category || 'عام',
    description: doc.description,
    image: doc.image,
    available: Boolean(doc.available),
    branchId: doc.branch_id || doc.branchId,
  };
}

async function pushMenuImmediate(item: MenuItem, action: 'create' | 'update' | 'delete') {
  try {
    if (action === 'delete') {
      const ok = await cloudDeleteDocument('menu_items', item.id);
      if (!ok) {
        await withDB(async (db) => {
          await db.put('sync_queue', {
            id: `sync_menu_del_${item.id}_${Date.now()}`,
            type: 'menu',
            action: 'delete',
            data: { id: item.id },
            timestamp: new Date().toISOString(),
            synced: 0,
          });
        });
        void syncService.syncPendingData();
      }
      return;
    }
    const ok = await cloudUpsert('menu_items', item.id, item);
    if (!ok) {
      await withDB(async (db) => {
        await db.put('sync_queue', {
          id: `sync_menu_${item.id}_${Date.now()}`,
          type: 'menu',
          action,
          data: item,
          timestamp: new Date().toISOString(),
          synced: 0,
        });
      });
      void syncService.syncPendingData();
    }
  } catch (e) {
    console.warn('[menu] immediate cloud push failed:', e);
    void syncService.syncPendingData();
  }
}

export class IndexedDbMenuRepository implements IMenuRepository {
  async getAll(branchId?: string): Promise<MenuItem[]> {
    let localItems = await withDB((db) => db.getAll('menu_items'));

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteDocs = await cloudGetCollection('menu_items');
        if (remoteDocs && remoteDocs.length > 0) {
          await enqueueWrite(async () => {
            await withDB(async (db) => {
              const tx = db.transaction('menu_items', 'readwrite');
              for (const doc of remoteDocs) {
                await tx.store.put(mapRemoteMenu(doc));
              }
              await tx.done;
            });
          });
          localItems = await withDB((db) => db.getAll('menu_items'));
        } else if (localItems.length > 0) {
          // Bootstrap: D1 empty but local has menu — push all (fixes menu_items = 0)
          void this.bootstrapPushAll(localItems);
        }
      } catch (e) {
        console.warn('[IndexedDbMenuRepository] remote merge skipped:', e);
      }
    }

    if (!branchId || branchId === 'manager' || branchId === 'all') return localItems;
    return localItems.filter(
      (item) => !item.branchId || item.branchId === branchId || item.branchId === 'default'
    );
  }

  /** Push entire local menu to D1 when cloud is empty */
  async bootstrapPushAll(items?: MenuItem[]): Promise<number> {
    const list = items || (await withDB((db) => db.getAll('menu_items')));
    if (!list.length) return 0;
    let n = 0;
    for (const item of list) {
      try {
        const ok = await cloudUpsert('menu_items', item.id, item);
        if (ok) n++;
        else {
          await withDB(async (db) => {
            await db.put('sync_queue', {
              id: `sync_menu_boot_${item.id}_${Date.now()}`,
              type: 'menu',
              action: 'create',
              data: item,
              timestamp: new Date().toISOString(),
              synced: 0,
            });
          });
        }
      } catch {
        // continue
      }
    }
    if (n < list.length) void syncService.syncPendingData();
    console.info('[menu] bootstrap pushed', n, '/', list.length);
    return n;
  }

  async create(itemData: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const id = `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const newItem: MenuItem = { ...itemData, id, branchId };
        await db.put('menu_items', newItem);
        void pushMenuImmediate(newItem, 'create');
        return newItem;
      });
    });
  }

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const existing = await db.get('menu_items', id);
        if (!existing) throw new Error(`Menu item ${id} not found`);
        const updated: MenuItem = { ...existing, ...data, id };
        await db.put('menu_items', updated);
        void pushMenuImmediate(updated, 'update');
        return updated;
      });
    });
  }

  async delete(id: string): Promise<void> {
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        await db.delete('menu_items', id);
        void pushMenuImmediate({ id } as MenuItem, 'delete');
      });
    });
  }

  async resetToDefaults(defaults: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]> {
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        await db.clear('menu_items');
      });
    });
    const created: MenuItem[] = [];
    for (const item of defaults) {
      created.push(await this.create(item, branchId));
    }
    void this.bootstrapPushAll(created);
    return created;
  }
}
