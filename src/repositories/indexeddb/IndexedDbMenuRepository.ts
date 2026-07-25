import { IMenuRepository } from '../types';
import { MenuItem } from '../../types/menu';
import { withDB, enqueueWrite } from './db';
import { syncService } from '../../services/syncService';
import { cloudGetCollection, cloudUpsert } from '../../services/cloudConfig';

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
    createdAt: doc.created_at || doc.createdAt,
    updatedAt: doc.updated_at || doc.updatedAt,
    // Read the soft-delete tombstone from the cloud row (worker stores it as deleted_at).
    deletedAt: doc.deleted_at || doc.deletedAt,
  };
}

async function pushMenuImmediate(item: MenuItem, action: 'create' | 'update') {
  try {
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

function resolveEffectiveDeletedAt(local?: MenuItem, remote?: MenuItem): string | undefined {
  const localDel = local?.deletedAt;
  const remoteDel = remote?.deletedAt;

  if (!localDel && !remoteDel) return undefined;

  // Both have tombstones -> keep the newer tombstone
  if (localDel && remoteDel) {
    return new Date(localDel).getTime() >= new Date(remoteDel).getTime() ? localDel : remoteDel;
  }

  const tombstone = localDel || remoteDel;
  const nonTombstoneUpdate = localDel ? remote?.updatedAt : local?.updatedAt;

  // If item was updated/re-created AFTER deletion, keep it live
  if (tombstone && nonTombstoneUpdate) {
    if (new Date(nonTombstoneUpdate).getTime() > new Date(tombstone).getTime()) {
      return undefined;
    }
  }

  return tombstone;
}

export class IndexedDbMenuRepository implements IMenuRepository {
  async getAll(_branchId?: string): Promise<MenuItem[]> {
    let localItems = (await withDB((db) => db.getAll('menu_items'))) as MenuItem[];

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteDocs = await cloudGetCollection('menu_items');
        if (remoteDocs && remoteDocs.length > 0) {
          // Read pending queue to know which local ids have an in-flight create/update
          let pendingCreates = new Map<string, string>();
          try {
            const pending = await withDB((db) => db.getAll('sync_queue'));
            for (const q of pending as any[]) {
              if (
                q?.type === 'menu' &&
                (q.action === 'create' || q.action === 'update') &&
                q.synced === 0 &&
                q?.data?.id
              ) {
                pendingCreates.set(q.data.id, q.timestamp || q.data.updatedAt || '');
              }
            }
          } catch {
            // ignore
          }

          await enqueueWrite(async () => {
            await withDB(async (db) => {
              const tx = db.transaction('menu_items', 'readwrite');
              const localAll = (await tx.store.getAll()) as MenuItem[];
              const remoteIds = new Set<string>();

              for (const doc of remoteDocs) {
                const remote = mapRemoteMenu(doc);
                const id = remote.id;
                if (!id) continue;
                remoteIds.add(id);

                const existing = localAll.find((l) => l.id === id);
                const effectiveDeletedAt = resolveEffectiveDeletedAt(existing, remote);

                const merged: MenuItem = {
                  ...(existing || ({} as MenuItem)),
                  ...remote,
                  id,
                  branchId: remote.branchId || existing?.branchId,
                  deletedAt: effectiveDeletedAt,
                };
                await tx.store.put(merged);
              }

              // For local rows that the cloud no longer knows about, write a
              // tombstone instead of hard-deleting. This way the item stays
              // restorable if the cloud brings it back later, and it is hidden
              // from consumers via the deletedAt filter at the end of getAll.
              // Use a 60s grace window so brief sync lag never tombstones a
              // brand-new item that simply hasn't propagated yet.
              for (const local of localAll) {
                if (!remoteIds.has(local.id) && !pendingCreates.has(local.id)) {
                  const ageMs = Date.now() - new Date(local.createdAt || 0).getTime();
                  if (ageMs > 60_000 && !local.deletedAt) {
                    const now = new Date().toISOString();
                    await tx.store.put({ ...local, deletedAt: now, updatedAt: now, available: false });
                  }
                }
              }
              await tx.done;
            });
          });
          localItems = (await withDB((db) => db.getAll('menu_items'))) as MenuItem[];
        }
      } catch (e) {
        console.warn('[IndexedDbMenuRepository] remote merge skipped:', e);
      }
    }


    // Always hide soft-deleted items from consumers.
    const live = localItems.filter((item) => !item.deletedAt);

    // Single-branch system: no branch filtering.
    return live;
  }

  /** Push entire local menu to D1 when cloud is empty */
  async bootstrapPushAll(items?: MenuItem[]): Promise<number> {
    const list =
      items || ((await withDB((db) => db.getAll('menu_items'))) as MenuItem[]);
    if (!list.length) return 0;
    // Never push tombstoned rows back to the cloud as live items.
    const live = list.filter((i) => !i.deletedAt);
    let n = 0;
    for (const item of live) {
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
    if (n < live.length) void syncService.syncPendingData();
    console.info('[menu] bootstrap pushed', n, '/', live.length);
    return n;
  }

  async create(itemData: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const id = `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        // Creating a brand-new item always clears any prior tombstone — even if
        // an id collided, the intent is "this item exists now".
        const now = new Date().toISOString();
        const newItem: MenuItem = {
          ...itemData,
          id,
          branchId,
          deletedAt: undefined,
          createdAt: now,
          updatedAt: now,
        };
        await db.put('menu_items', newItem);
        void pushMenuImmediate(newItem, 'create');
        return newItem;
      });
    });
  }

  async update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem> {
    return enqueueWrite(async () => {
      return withDB(async (db) => {
        const existing = (await db.get('menu_items', id)) as MenuItem | undefined;
        if (!existing) throw new Error(`Menu item ${id} not found`);
        const updated: MenuItem = {
          ...existing,
          ...data,
          id,
          updatedAt: new Date().toISOString(),
        };
        await db.put('menu_items', updated);
        void pushMenuImmediate(updated, 'update');
        return updated;
      });
    });
  }

  async delete(id: string): Promise<void> {
    // Soft-delete: write a FULL tombstone row (deletedAt) locally AND upsert it to
    // the cloud so the tombstone PERSISTS in D1 and propagates to every device.
    //
    // This replaces a broken delete path that had two defects:
    //  1. It pushed a sparse { id, deletedAt } document. D1 (SQLite) evaluates the
    //     NOT NULL constraints on the INSERT candidate row *before* the
    //     ON CONFLICT(id) DO UPDATE takes over, so an upsert that omits the
    //     NOT NULL name/price/category columns raises "NOT NULL constraint failed"
    //     even when the row already exists — the tombstone upsert always failed.
    //  2. It then called cloudDeleteDocument() (a hard DELETE), removing the row
    //     entirely. With no tombstone left in D1, any other device that still had
    //     the item live re-inserted it on its next sync/hydrate → the deleted
    //     item came back.
    // Carrying the full NOT NULL columns and never hard-deleting matches the
    // inventory / customers / companies delete paths (see their identical notes).
    const now = new Date().toISOString();
    const tombstone: MenuItem = await enqueueWrite(async () => {
      return withDB(async (db) => {
        const existing = (await db.get('menu_items', id)) as MenuItem | undefined;
        const ts: MenuItem = {
          ...(existing || ({} as MenuItem)),
          id,
          name: existing?.name ?? 'deleted',
          price: existing?.price ?? 0,
          category: existing?.category ?? 'عام',
          description: existing?.description ?? '',
          image: existing?.image ?? '',
          available: false,
          createdAt: existing?.createdAt ?? now,
          deletedAt: now,
          updatedAt: now,
        };
        await db.put('menu_items', ts);
        try {
          await db.put('sync_queue', {
            id: `sync_menu_del_${id}_${Date.now()}`,
            type: 'menu',
            action: 'update',
            data: ts,
            timestamp: now,
            synced: 0,
          });
        } catch {
          // ignore
        }
        return ts;
      });
    });

    // Push the FULL tombstone (carries NOT NULL name/price/category) and do NOT
    // hard-delete afterwards — that would wipe the tombstone we just wrote.
    try {
      const { cloudUpsert, ackSyncQueueForEntity } = await import('../../services/cloudConfig');
      const ok = await cloudUpsert('menu_items', id, tombstone);
      if (ok) await ackSyncQueueForEntity(id);
      else void syncService.syncPendingData();
    } catch {
      void syncService.syncPendingData();
    }
  }

  async resetToDefaults(defaults: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]> {
    const now = new Date().toISOString();
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        // Tombstone every existing item (don't hard-clear) so old rows can't be
        // resurrected from the cloud after a reset.
        const all = (await db.getAll('menu_items')) as MenuItem[];
        const tx = db.transaction('menu_items', 'readwrite');
        for (const item of all) {
          await tx.store.put({ ...item, deletedAt: now, updatedAt: now, available: false });
        }
        await tx.done;
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
