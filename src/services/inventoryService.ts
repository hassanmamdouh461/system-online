import { InventoryItem, InventoryTransaction, RecipeIngredient } from '../global';
import { getDB, withDB, enqueueWrite, CLIENT_B_INITIAL_INVENTORY } from '../repositories/indexeddb/db';
import { syncService } from './syncService';

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

/** Push one menu item's recipe lines to D1 (cloud-first + queue fallback). */
async function pushRecipeToCloud(
  menuItemId: string,
  ingredients: RecipeIngredient[],
  branchId?: string
): Promise<void> {
  const now = new Date().toISOString();
  const branch = branchId || 'main_branch';
  for (const ing of ingredients) {
    const id = `recipe_${menuItemId}_${ing.inventoryItemId}`;
    const data = {
      id,
      menuItemId,
      inventoryItemId: ing.inventoryItemId,
      quantity: ing.quantity,
      unit: ing.unit || '',
      branchId: branch,
      updatedAt: now,
    };
    try {
      await enqueueWrite(async () => {
        await withDB(async (db) => {
          await db.put('sync_queue', {
            id: `sync_recipe_${id}_${Date.now()}`,
            type: 'recipes',
            action: 'update',
            data,
            timestamp: now,
            synced: 0,
          });
        });
      });
      const { cloudUpsert } = await import('./cloudConfig');
      const ok = await cloudUpsert('recipes', id, data);
      if (!ok) void syncService.syncPendingData();
    } catch (e) {
      console.warn('[inventoryService] recipe cloud push failed:', e);
      void syncService.syncPendingData();
    }
  }
}

async function pushTransactionToCloud(tx: InventoryTransaction): Promise<void> {
  const data = {
    id: tx.id,
    itemId: tx.itemId,
    itemName: tx.itemName,
    type: tx.type,
    quantity: tx.quantity,
    unit: tx.unit || tx.itemUnit,
    referenceId: tx.referenceId,
    notes: tx.notes,
    branchId: tx.branchId,
    createdAt: tx.createdAt,
  };
  try {
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        await db.put('sync_queue', {
          id: `sync_invtx_${tx.id}`,
          type: 'inventory_transactions',
          action: 'create',
          data,
          timestamp: tx.createdAt || new Date().toISOString(),
          synced: 0,
        });
      });
    });
    const { cloudUpsert } = await import('./cloudConfig');
    const ok = await cloudUpsert('inventory_transactions', tx.id, data);
    if (!ok) void syncService.syncPendingData();
  } catch (e) {
    console.warn('[inventoryService] transaction cloud push failed:', e);
    void syncService.syncPendingData();
  }
}

const WEB_TX_KEY = 'pos_inventory_transactions_web_store';

function getWebTransactions(): InventoryTransaction[] {
  try {
    const raw = localStorage.getItem(WEB_TX_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}

  return [];
}

function saveWebTransactions(txs: InventoryTransaction[]) {
  try {
    localStorage.setItem(WEB_TX_KEY, JSON.stringify(txs));
  } catch (e) {}
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
      const { withDB, enqueueWrite } = await import('../repositories/indexeddb/db');
      let localItems = await withDB((db) => db.getAll('inventory'));

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const { cloudGetCollection } = await import('./cloudConfig');
          const remoteDocs = await cloudGetCollection('inventory');
          if (remoteDocs && remoteDocs.length > 0) {
            // Read pending queue outside the inventory write tx
            let pendingCreateIds = new Set<string>();
            try {
              const pending = await withDB((db) => db.getAll('sync_queue'));
              pendingCreateIds = new Set(
                (pending || [])
                  .filter(
                    (q: any) =>
                      q?.type === 'inventory' &&
                      (q.action === 'create' || q.action === 'update') &&
                      q.synced === 0
                  )
                  .map((q: any) => q?.data?.id)
                  .filter(Boolean)
              );
            } catch {
              // ignore
            }

            await enqueueWrite(async () => {
              await withDB(async (db) => {
                const tx = db.transaction('inventory', 'readwrite');
                const localAll = (await tx.store.getAll()) as InventoryItem[];
                const localById = new Map(localAll.map((i) => [i.id, i]));
                const remoteIds = new Set<string>();

                for (const doc of remoteDocs) {
                  const id = String(doc.id || doc.$id);
                  remoteIds.add(id);
                  const remoteUpdated = doc.updatedAt || doc.updated_at || '';
                  const local = localById.get(id);
                  if (
                    local?.updatedAt &&
                    remoteUpdated &&
                    new Date(local.updatedAt).getTime() > new Date(remoteUpdated).getTime()
                  ) {
                    continue;
                  }
                  await tx.store.put({
                    id,
                    name: doc.name || local?.name || 'عنصر',
                    unit: doc.unit || local?.unit || 'وحدة',
                    stock: Number(doc.stock ?? local?.stock) || 0,
                    minStock: Number(doc.minStock ?? local?.minStock) || 0,
                    costPerUnit: Number(doc.costPerUnit ?? local?.costPerUnit) || 0,
                    branchId:
                      doc.branch_id || doc.branchId || local?.branchId || 'main_branch',
                    createdAt:
                      doc.createdAt ||
                      doc.created_at ||
                      local?.createdAt ||
                      new Date().toISOString(),
                    updatedAt:
                      remoteUpdated || local?.updatedAt || new Date().toISOString(),
                  });
                }

                for (const local of localAll) {
                  if (!remoteIds.has(local.id) && !pendingCreateIds.has(local.id)) {
                    const ageMs =
                      Date.now() - new Date(local.createdAt || 0).getTime();
                    if (ageMs > 15_000) {
                      await tx.store.delete(local.id);
                    }
                  }
                }
                await tx.done;
              });
            });
            localItems = await withDB((db) => db.getAll('inventory'));
          }
        } catch (e) {
          console.warn('[inventoryService] remote merge skipped:', e);
        }
      }

      if (!branchId) return localItems as InventoryItem[];
      return (localItems as InventoryItem[]).filter(
        (i) => !i.branchId || i.branchId === branchId
      );
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
      const newItem = await enqueueWrite(async () => {
        return withDB(async (db) => {
          const id = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const now = new Date().toISOString();
          const created: InventoryItem = {
            ...item,
            branchId: item.branchId || 'main_branch',
            id,
            createdAt: now,
            updatedAt: now,
          };
          await db.put('inventory', created);
          try {
            await db.put('sync_queue', {
              id: `sync_inv_${id}`,
              type: 'inventory',
              action: 'create',
              data: created,
              timestamp: now,
              synced: 0,
            });
          } catch (e) {
            console.warn('[inventory] sync_queue failed:', e);
          }
          return created;
        });
      });

      // Await cloud write so manager UI reflects durable save
      try {
        const { cloudUpsert, ackSyncQueueForEntity } = await import('./cloudConfig');
        const ok = await cloudUpsert('inventory', newItem.id, newItem);
        if (ok) await ackSyncQueueForEntity(newItem.id);
        else void syncService.syncPendingData();
      } catch {
        void syncService.syncPendingData();
      }
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
      const updated = await enqueueWrite(async () => {
        return withDB(async (db) => {
          const existing = await db.get('inventory', id);
          const now = new Date().toISOString();
          const next: InventoryItem = {
            ...(existing || {
              id,
              name: 'Item',
              unit: 'unit',
              stock: 0,
              minStock: 0,
              costPerUnit: 0,
              branchId: 'main_branch',
              createdAt: now,
              updatedAt: now,
            }),
            ...data,
            id,
            updatedAt: now,
          };
          await db.put('inventory', next);
          try {
            await db.put('sync_queue', {
              id: `sync_inv_${id}_${Date.now()}`,
              type: 'inventory',
              action: 'update',
              data: next,
              timestamp: now,
              synced: 0,
            });
          } catch (e) {
            console.warn('[inventory] sync_queue failed:', e);
          }
          return next;
        });
      });

      try {
        const { cloudUpsert, ackSyncQueueForEntity } = await import('./cloudConfig');
        const ok = await cloudUpsert('inventory', updated.id, updated);
        if (ok) await ackSyncQueueForEntity(updated.id);
        else void syncService.syncPendingData();
      } catch {
        void syncService.syncPendingData();
      }
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
      await enqueueWrite(async () => {
        await withDB(async (db) => {
          const now = new Date().toISOString();
          await db.delete('inventory', id);
          try {
            await db.put('sync_queue', {
              id: `sync_inv_del_${id}_${Date.now()}`,
              type: 'inventory',
              action: 'delete',
              data: { id },
              timestamp: now,
              synced: 0,
            });
          } catch {
            // ignore
          }
        });
      });

      // Immediate cloud delete so refresh/getAll won't resurrect the item
      try {
        const { cloudDeleteDocument, ackSyncQueueForEntity } = await import('./cloudConfig');
        const ok = await cloudDeleteDocument('inventory', id);
        if (ok) await ackSyncQueueForEntity(id);
        else void syncService.syncPendingData();
      } catch {
        void syncService.syncPendingData();
      }
    } catch (error) {
      console.error('[inventoryService] Error deleting item:', error);
      throw error;
    }
  },

  /** Read a single item from local IDB only (no cloud merge — avoids race on sales). */
  async getByIdLocal(itemId: string): Promise<InventoryItem | undefined> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getInventory) {
        const all = await window.electronAPI.getInventory();
        return all.find((i: InventoryItem) => i.id === itemId || i.name === itemId);
      }
      return await withDB(async (db) => {
        const byId = await db.get('inventory', itemId);
        if (byId) return byId as InventoryItem;
        const all = (await db.getAll('inventory')) as InventoryItem[];
        return all.find((i) => i.id === itemId || i.name === itemId);
      });
    } catch {
      return undefined;
    }
  },

  async deductStock(itemId: string, quantityDeducted: number, notes?: string, referenceId?: string): Promise<void> {
    try {
      const target = await this.getByIdLocal(itemId);
      if (target) {
        const newStock = Math.max(0, target.stock - quantityDeducted);
        await this.update(target.id, { stock: newStock });

        await this.createTransaction({
          itemId: target.id,
          itemName: target.name,
          type: 'OUT',
          quantity: quantityDeducted,
          unit: target.unit,
          referenceId: referenceId || 'POS-SALE',
          notes: notes || 'خصم تلقائي مبيعات الكاشير',
          branchId: target.branchId
        });
      }
    } catch (err) {
      console.error('[inventoryService] Failed to deduct stock:', err);
    }
  },

  /** Reverse a previous sale deduction (e.g. unpaid order cancel). */
  async restoreStock(itemId: string, quantityRestored: number, notes?: string, referenceId?: string): Promise<void> {
    try {
      if (quantityRestored <= 0) return;
      const target = await this.getByIdLocal(itemId);
      if (target) {
        const newStock = target.stock + quantityRestored;
        await this.update(target.id, { stock: newStock });

        await this.createTransaction({
          itemId: target.id,
          itemName: target.name,
          type: 'IN',
          quantity: quantityRestored,
          unit: target.unit,
          referenceId: referenceId || 'ORDER-CANCEL',
          notes: notes || 'استرجاع مخزون — إلغاء طلب',
          branchId: target.branchId
        });
      }
    } catch (err) {
      console.error('[inventoryService] Failed to restore stock:', err);
    }
  },

  async getTransactions(itemId?: string, branchId?: string): Promise<InventoryTransaction[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getInventoryTransactions) {
        return await window.electronAPI.getInventoryTransactions(itemId, branchId);
      }
      let list = getWebTransactions();
      if (itemId) {
        list = list.filter(t => t.itemId === itemId);
      }
      if (branchId) {
        list = list.filter(t => !t.branchId || t.branchId === branchId);
      }
      return list;
    } catch (error) {
      return [];
    }
  },

  async createTransaction(tx: Omit<InventoryTransaction, 'id' | 'createdAt'>): Promise<InventoryTransaction> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.createInventoryTransaction) {
        return await window.electronAPI.createInventoryTransaction(tx);
      }
      const newTx: InventoryTransaction = {
        ...tx,
        id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        createdAt: new Date().toISOString()
      };
      const list = getWebTransactions();
      list.unshift(newTx);
      // Cap local history to avoid unbounded localStorage growth
      if (list.length > 2000) list.length = 2000;
      saveWebTransactions(list);
      void pushTransactionToCloud(newTx);
      return newTx;
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

      // Combine DEFAULT_WEB_RECIPES with custom web store overrides
      const allMenuItemIds = Array.from(new Set([...Object.keys(DEFAULT_WEB_RECIPES), ...Object.keys(store)]));

      for (const menuItemId of allMenuItemIds) {
        const ingredients = store[menuItemId] || DEFAULT_WEB_RECIPES[menuItemId] || [];
        ingredients.forEach(ing => {
          allIngredients.push({
            ...ing,
            menuItemId
          });
        });
      }

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
      void pushRecipeToCloud(menuItemId, ingredients);
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
