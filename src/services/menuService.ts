import { MenuItem } from '../types/menu';
import { menuRepository } from '../repositories';
import type { DeleteOutcome } from '../repositories/types';
import { cloudGetPublicMenu } from './cloudConfig';

/** Map a worker `/public/menu` document to a MenuItem (mirrors the repository's
 *  remote mapper, but for the unauthenticated public payload). */
function mapPublicMenuDoc(doc: any): MenuItem {
  return {
    id: String(doc.id || doc.$id),
    name: doc.name || 'صنف',
    price: Number(doc.price) || 0,
    category: doc.category || 'عام',
    description: doc.description,
    image: doc.image,
    // `/public/menu` only ever returns available items — the WHERE clause
    // guarantees it — so a missing flag means "the guest-safe projection did
    // not carry the column", NOT "unavailable". Treating absent as false made
    // the whole QR menu render empty against a worker that omits it.
    available: doc.available === undefined || doc.available === null
      ? true
      : doc.available !== false && doc.available !== 0,
    branchId: doc.branch_id || doc.branchId,
    createdAt: doc.created_at || doc.createdAt,
    updatedAt: doc.updated_at || doc.updatedAt,
  };
}

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

  /**
   * Public, key-less menu read for the customer-facing QR page (/public-menu).
   * Reads straight from the worker's unauthenticated /public/menu route and does
   * NOT touch IndexedDB — a guest device has an empty local store and we must not
   * write tombstones into it. Throws on network/worker failure so the page can
   * show a retry state instead of a silently empty menu.
   */
  async getPublicMenu(): Promise<MenuItem[]> {
    const docs = await cloudGetPublicMenu();
    if (docs === null) {
      throw new Error('Failed to load public menu');
    }
    return docs.map(mapPublicMenuDoc);
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

  /**
   * Soft-delete a menu item. Returns whether the tombstone was CONFIRMED by the
   * cloud; an unconfirmed deletion lives only in this browser and is undone by
   * clearing browser data (see DeleteOutcome).
   *
   * The old body retried the identical call from the catch block, which cannot
   * succeed for a deterministic failure and hid the error from the caller.
   */
  async delete(id: string): Promise<DeleteOutcome> {
    return await menuRepository.delete(id);
  },

  async resetToDefaults(defaultItems: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]> {
    try {
      return await menuRepository.resetToDefaults(defaultItems, branchId);
    } catch (error) {
      return await menuRepository.resetToDefaults(defaultItems, branchId);
    }
  },
};
