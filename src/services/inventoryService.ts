import { InventoryItem, InventoryTransaction, RecipeIngredient } from '../global';
import { getDB, withDB, enqueueWrite } from '../repositories/indexeddb/db';
import { syncService } from './syncService';

const WEB_RECIPES_STORAGE_KEY = 'web_menu_recipes_store';


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

            // Also read pending DELETE queue items so we don't resurrect them
            let pendingDeleteIds = new Set<string>();
            try {
              const pendingAll = await withDB((db) => db.getAll('sync_queue'));
              pendingDeleteIds = new Set(
                (pendingAll || [])
                  .filter(
                    (q: any) =>
                      q?.type === 'inventory' &&
                      q.action === 'delete' &&
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

                  const local = localById.get(id);
                  const localDeletedAt = local?.deletedAt;
                  const remoteDeletedAt = doc.deleted_at || doc.deletedAt;

                  // Resolve the effective tombstone: whichever side has a NEWER
                  // deletedAt wins. This prevents a stale cloud row from
                  // resurrecting a locally-deleted item.
                  const effectiveDeletedAt =
                    !localDeletedAt
                      ? remoteDeletedAt
                      : !remoteDeletedAt
                        ? localDeletedAt
                        : new Date(localDeletedAt).getTime() >= new Date(remoteDeletedAt).getTime()
                          ? localDeletedAt
                          : remoteDeletedAt;

                  // If there's a pending DELETE for this id, keep it deleted
                  if (pendingDeleteIds.has(id) && !effectiveDeletedAt) {
                    continue;
                  }

                  const remoteUpdated = doc.updatedAt || doc.updated_at || '';
                  // If local has a newer update (and no tombstone conflict), skip
                  if (
                    local?.updatedAt &&
                    remoteUpdated &&
                    !effectiveDeletedAt &&
                    !remoteDeletedAt &&
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
                    deletedAt: effectiveDeletedAt || undefined,
                  });
                }

                // Tombstone (don't hard-delete) local inventory rows the cloud
                // no longer knows about, so they stay restorable if the cloud
                // later brings them back. 60s grace window tolerates sync lag.
                for (const local of localAll) {
                  if (!remoteIds.has(local.id) && !pendingCreateIds.has(local.id)) {
                    const ageMs =
                      Date.now() - new Date(local.createdAt || 0).getTime();
                    if (ageMs > 60_000 && !local.deletedAt) {
                      const nowIso = new Date().toISOString();
                      await tx.store.put({
                        ...local,
                        deletedAt: nowIso,
                        updatedAt: nowIso,
                      });
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

      // Always hide soft-deleted items from consumers.
      const live = (localItems as InventoryItem[]).filter((i) => !i.deletedAt);
      if (!branchId) return live;
      return live.filter(
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

      // Automatically log initial inventory transaction so it appears in history logs
      try {
        await this.createTransaction({
          itemId: newItem.id,
          itemName: newItem.name,
          itemUnit: newItem.unit,
          unit: newItem.unit,
          type: 'IN',
          quantity: newItem.stock,
          referenceId: 'MANUAL',
          notes: 'إضافة صنف مخزون جديد',
          branchId: newItem.branchId
        });
      } catch (txErr) {
        console.warn('[inventory] failed to create initial transaction:', txErr);
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

  /**
   * Write a new stock value for one item.
   *
   * Internal helper for deductStock / restoreStock. It deliberately does NOT
   * call enqueueWrite itself — those callers already hold the write slot, and
   * re-entering it would deadlock. Everything else (sync queue row, cloud push)
   * mirrors `update`.
   */
  async updateStockRaw(id: string, newStock: number): Promise<void> {
    if (typeof window !== 'undefined' && window.electronAPI?.updateInventoryItem) {
      await window.electronAPI.updateInventoryItem(id, { stock: newStock });
      return;
    }

    const next = await withDB(async (db) => {
      const existing = (await db.get('inventory', id)) as InventoryItem | undefined;
      if (!existing) return undefined;
      const now = new Date().toISOString();
      const updated: InventoryItem = { ...existing, stock: newStock, updatedAt: now };
      await db.put('inventory', updated);
      try {
        await db.put('sync_queue', {
          id: `sync_inv_${id}_${Date.now()}`,
          type: 'inventory',
          action: 'update',
          data: updated,
          timestamp: now,
          synced: 0,
        });
      } catch (e) {
        console.warn('[inventory] sync_queue failed:', e);
      }
      return updated;
    });

    if (!next) return;

    try {
      const { cloudUpsert, ackSyncQueueForEntity } = await import('./cloudConfig');
      const ok = await cloudUpsert('inventory', next.id, next);
      if (ok) await ackSyncQueueForEntity(next.id);
      else void syncService.syncPendingData();
    } catch {
      void syncService.syncPendingData();
    }
  },

  async delete(id: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.deleteInventoryItem) {
        await window.electronAPI.deleteInventoryItem(id);
        return;
      }
      const now = new Date().toISOString();

      // Soft-delete: write a tombstone row (deletedAt) locally AND push it to the cloud.
      // The tombstone propagates to every device and prevents the item from coming back
      // via hydrate/sync, even if the hard cloud DELETE races or a stale copy lingers.
      await enqueueWrite(async () => {
        await withDB(async (db) => {
          const existing = await db.get('inventory', id) as InventoryItem | undefined;
          const tombstone: InventoryItem = {
            ...(existing || { id, name: 'deleted', unit: 'unit', stock: 0, minStock: 0, costPerUnit: 0, createdAt: now } as InventoryItem),
            id,
            deletedAt: now,
            updatedAt: now,
          };
          await db.put('inventory', tombstone);
          try {
            await db.put('sync_queue', {
              id: `sync_inv_del_${id}_${Date.now()}`,
              type: 'inventory',
              action: 'delete',
              data: { id, deletedAt: now, updatedAt: now },
              timestamp: now,
              synced: 0,
            });
          } catch {
            // ignore
          }
        });
      });

      // Push tombstone to cloud so other devices / hydration see it as deleted.
      // Also attempt hard cloud delete as a belt-and-suspenders approach.
      try {
        const { cloudUpsert, cloudDeleteDocument, ackSyncQueueForEntity } = await import('./cloudConfig');
        // First upsert the tombstone so it persists in D1 even if hard delete fails
        await cloudUpsert('inventory', id, { id, deletedAt: now, updatedAt: now, name: 'deleted', stock: 0 });
        // Then try hard delete
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
        const byId = await db.get('inventory', itemId) as InventoryItem | undefined;
        if (byId && !byId.deletedAt) return byId;
        if (byId) return undefined; // soft-deleted
        const all = (await db.getAll('inventory')) as InventoryItem[];
        return all.find((i) => !i.deletedAt && (i.id === itemId || i.name === itemId));
      });
    } catch {
      return undefined;
    }
  },

  async deductStock(itemId: string, quantityDeducted: number, notes?: string, referenceId?: string): Promise<void> {
    try {
      // Read + write must happen inside ONE serialized slot.
      //
      // This used to read the row, compute `stock - qty`, then write it back as
      // two separate awaited steps. Two sales ringing up the same item at the
      // same time both read the same starting stock, so one deduction was lost
      // (classic lost update) and the shop's stock drifted upward forever.
      // `enqueueWrite` serializes against every other inventory write.
      const target = await enqueueWrite(async () => {
        const current = await this.getByIdLocal(itemId);
        if (!current) return undefined;
        const newStock = Math.max(0, current.stock - quantityDeducted);
        await this.updateStockRaw(current.id, newStock);
        return current;
      });

      if (target) {
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
      // Same lost-update hazard as deductStock — serialize read+write together.
      const target = await enqueueWrite(async () => {
        const current = await this.getByIdLocal(itemId);
        if (!current) return undefined;
        await this.updateStockRaw(current.id, current.stock + quantityRestored);
        return current;
      });

      if (target) {
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

      // Recipes are user-defined only — no hardcoded fallbacks.
      for (const menuItemId of Object.keys(store)) {
        const ingredients = store[menuItemId] || [];
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
      let ingredients: RecipeIngredient[] = store[menuItemId] || [];

      // No hardcoded fallback — a menu item with no configured recipe simply yields no deductions.

      // Validate ingredient IDs against active inventory; drop unresolved ones
      // rather than silently remapping to an unrelated item (which would cause
      // wrong stock deductions in a financial system).
      const currentInv = await this.getAll();
      if (currentInv.length > 0) {
        const knownIds = new Set(currentInv.map(i => i.id));
        const resolved = ingredients.filter(ing => knownIds.has(ing.inventoryItemId));
        if (resolved.length < ingredients.length) {
          console.warn(
            '[inventoryService] Dropped recipe ingredients with unknown inventory item ids for menu',
            menuItemId,
            ingredients.filter(ing => !knownIds.has(ing.inventoryItemId))
          );
        }
        return resolved;
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
