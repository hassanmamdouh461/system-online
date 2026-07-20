export interface Customer {
  id: string;
  name: string;
  phone: string;
  points: number;
  createdAt: string;
  updatedAt?: string; // ISO string — last modification timestamp for sync conflict resolution
  /** Multi-branch sync fields */
  branchId?: string; // UUID identifying which branch created/owns this record
  isSynced?: boolean; // false = needs to be pushed to central server
}
