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
  /** Multi-branch sync fields */
  branchId?: string;
  isSynced?: boolean;
}
