export interface Company {
  id: string;
  name: string;
  /** Tags inherited / shown on affiliated customers */
  tags: string[];
  phone?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  branchId?: string;
  isSynced?: boolean;
}
