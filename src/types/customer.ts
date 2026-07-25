export interface Customer {
  id: string;
  name: string;
  phone: string;
  points: number;
  /** Optional link to a company this customer belongs to */
  companyId?: string;
  /** Free-form tags specific to this customer */
  tags?: string[];
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  /** Soft-delete tombstone — set when a customer is "deleted" so cloud hydrate
   *  cannot resurrect it (matches menu_items / inventory / orders). */
  deletedAt?: string;
  /** Multi-branch sync fields */
  branchId?: string;
  isSynced?: boolean;
}
