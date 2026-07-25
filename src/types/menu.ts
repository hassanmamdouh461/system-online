export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;
  available: boolean;
  createdAt?: string;
  updatedAt?: string;
  branchId?: string;
  isSynced?: boolean;
  /**
   * Soft-delete tombstone (ISO string). When set, this item is considered deleted
   * and must NEVER be shown, even if a stale copy lingers in the cloud or a
   * snapshot restore re-inserts the row. A newer (non-empty) deletedAt always
   * wins over an older row without it. This is what prevents deleted menu items
   * from "coming back" after a cloud hydrate / sync.
   */
  deletedAt?: string;
}

export const CATEGORIES = ['All'];

export const CATEGORY_TRANSLATIONS: Record<string, string> = {
  'Kitchen': 'مأكولات',
  'Bar': 'مشروبات',
  'General': 'عام',
};

