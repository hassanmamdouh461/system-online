import { DeleteOutcome, IMenuRepository } from '../types';
import { MenuItem } from '../../types/menu';
import { withDB, enqueueWrite } from './db';
import { syncService } from '../../services/syncService';
import {
  cloudGetCollection,
  cloudUpsert,
  cloudUpsertWithOutcome,
  describeCloudWriteFailure,
  getCloudSyncSince,
  setCloudSyncSince,
  newestRemoteTimestamp,
  getSessionRole,
  refreshCloudSessionRole,
} from '../../services/cloudConfig';

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

/**
 * May the CURRENT session push menu writes to the cloud?
 *
 * Mirrors canPushSettingKey in settingsCloudService: menu_items (and recipes)
 * are in the Worker's CASHIER_READONLY_TABLES, so any cashier write can only
 * 403 on the server and leave a dead sync-queue row that poisons the queue
 * ("failed" badge, blocked retries). A cashier session skips the push entirely;
 * a manager device owns the menu write. The local IndexedDB write still happens
 * (the caller), we only suppress the doomed cloud round-trip.
 *
 * A session whose role is not known YET is resolved against the Worker before
 * deciding — see the comment inside.
 */
async function canPushMenuWrite(): Promise<boolean> {
  const role = getSessionRole();
  if (role) return role === 'manager';

  // UNKNOWN role (null) is RESOLVED, not assumed.
  //
  // getSessionRole() is in-memory, so it is null after every page reload until
  // something probes the session. Treating null as "not a manager" silently
  // dropped a manager's menu delete in that window: no cloud push AND no
  // sync-queue row, so the deletion existed only in this browser's IndexedDB and
  // clearing the cache brought the item straight back. Treating null as "is a
  // manager" would be just as wrong — it revives the doomed cashier round-trip
  // this gate exists to prevent. Ask the Worker who we are instead (the 12h
  // session cookie answers without a password), then decide.
  const resolved = await refreshCloudSessionRole();
  return resolved === 'manager';
}

async function pushMenuImmediate(
  item: MenuItem,
  action: 'create' | 'update' | 'delete'
): Promise<DeleteOutcome> {
  if (!(await canPushMenuWrite())) {
    return {
      synced: false,
      reason: 'تعديل المنيو يحتاج صلاحية مدير — لم تتم المزامنة مع السحاب.',
    };
  }
  try {
    if (action === 'delete') {
      const now = item.deletedAt || new Date().toISOString();
      const tombstone: MenuItem = {
        ...item,
        deletedAt: now,
        updatedAt: now,
      };
      // Push the tombstone so it persists in D1 and every device learns the
      // item was deleted. Do NOT hard-delete afterwards: that would wipe the
      // very tombstone we just wrote, letting a competing device UPDATE
      // resurrect the deleted item (same fix as inventory/customers/companies).
      const outcome = await cloudUpsertWithOutcome('menu_items', item.id, tombstone);
      if (outcome.kind === 'ok') return { synced: true };
      await withDB(async (db) => {
        await db.put('sync_queue', {
          id: `sync_menu_del_${item.id}_${Date.now()}`,
          type: 'menu',
          action: 'update',
          data: tombstone,
          timestamp: now,
          synced: 0,
        });
      });
      void syncService.syncPendingData();
      return { synced: false, reason: describeCloudWriteFailure(outcome) };
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
      return { synced: false, reason: 'العملية في طابور المزامنة.' };
    }
    return { synced: true };
  } catch (e) {
    console.warn('[menu] immediate cloud push failed:', e);
    void syncService.syncPendingData();
    return {
      synced: false,
      reason: 'تعذّر تأكيد العملية على السحاب — العملية في طابور المزامنة.',
    };
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
        // Incremental sync: pull only rows changed since our last successful
        // merge (?since=) instead of the whole table on every 10s poll. A small
        // overlap absorbs cross-device clock skew; the first run (no mark) pulls
        // everything and seeds the mark.
        const OVERLAP_MS = 2 * 60_000;
        const storedSince = getCloudSyncSince('menu_items');
        const since = storedSince
          ? new Date(new Date(storedSince).getTime() - OVERLAP_MS).toISOString()
          : undefined;

        const remoteDocs = await cloudGetCollection('menu_items', since ? { since } : undefined);
        // null => network/HTTP failure: never mutate local from a failed read.
        if (remoteDocs) {
          if (remoteDocs.length > 0) {
            await enqueueWrite(async () => {
              await withDB(async (db) => {
                const tx = db.transaction('menu_items', 'readwrite');
                const localAll = (await tx.store.getAll()) as MenuItem[];

                for (const doc of remoteDocs) {
                  const remote = mapRemoteMenu(doc);
                  const id = remote.id;
                  if (!id) continue;

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

                // We deliberately do NOT tombstone local rows that are absent
                // from this response. With ?since= the payload is a partial
                // delta, and even a full snapshot can be truncated by a
                // mid-flight timeout — treating "absent" as "deleted" would
                // soft-delete valid local items (data loss). Real deletions
                // arrive as explicit deleted_at tombstone rows and are applied
                // by the merge above.
                await tx.done;
              });
            });

            // Advance the high-water mark only after a successful merge.
            const newest = newestRemoteTimestamp(remoteDocs);
            if (newest) setCloudSyncSince('menu_items', newest);

            localItems = (await withDB((db) => db.getAll('menu_items'))) as MenuItem[];
          } else if (!storedSince) {
            // First read returned an empty collection: stamp the mark so we
            // switch to delta mode instead of repeating full reads forever.
            setCloudSyncSince('menu_items', new Date().toISOString());
          }
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
    // Cashier devices never push menu writes (see canPushMenuWrite): the server
    // would 403 every row and fill the queue with dead records.
    if (!(await canPushMenuWrite())) return 0;
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

  async delete(id: string): Promise<DeleteOutcome> {
    const now = new Date().toISOString();
    // Soft-delete: write a tombstone row (deletedAt) locally AND push it to the cloud.
    // The tombstone propagates to every device and prevents the item from coming back
    // via hydrate/sync.
    let tombstoneItem: MenuItem | undefined;
    await enqueueWrite(async () => {
      await withDB(async (db) => {
        const existing = (await db.get('menu_items', id)) as MenuItem | undefined;
        const tombstone: MenuItem = {
          ...(existing || ({} as MenuItem)),
          id,
          name: existing?.name ?? 'deleted',
          price: existing?.price ?? 0,
          category: existing?.category ?? 'عام',
          description: existing?.description ?? '',
          image: existing?.image ?? '',
          available: false,
          deletedAt: now,
          updatedAt: now,
        };
        await db.put('menu_items', tombstone);
        tombstoneItem = tombstone;
      });
    });

    // Push the FULL tombstone (carrying the NOT NULL columns name/price/category)
    // so the worker upsert does not 500 and the tombstone actually persists in D1.
    // The outcome is returned so the screen can tell the operator when the
    // deletion is local-only (and would be undone by clearing browser data).
    if (!tombstoneItem) {
      return { synced: false, reason: 'الصنف غير موجود محلياً.' };
    }
    return await pushMenuImmediate(tombstoneItem, 'delete');
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
