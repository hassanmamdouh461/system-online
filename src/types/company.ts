export interface Company {
  id: string;
  name: string;
  /** Tags inherited / shown on affiliated customers */
  tags: string[];
  phone?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  /** Soft-delete tombstone — set when a company is "deleted" so cloud hydrate
   *  cannot resurrect it (matches menu_items / inventory / orders). */
  deletedAt?: string;
  branchId?: string;
  isSynced?: boolean;
}
