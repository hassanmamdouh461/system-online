import { MenuItem } from '../types/menu';
import { Order, OrderStatus } from '../types/order';
import { Customer } from '../types/customer';
import { Company } from '../types/company';

/**
 * The result of a soft-delete.
 *
 * `synced: false` means the row is tombstoned LOCALLY (so every screen already
 * hides it) but the tombstone has NOT been confirmed by the cloud — it exists
 * only in this browser's IndexedDB + sync_queue. Clearing browser data before it
 * syncs loses the deletion, and the next hydrate pulls the still-live row back
 * from D1. Callers MUST surface `reason` to the operator instead of reporting a
 * clean success.
 */
export interface DeleteOutcome {
  synced: boolean;
  reason?: string;
}

/**
 * The result of a save, held to the same honesty rule as `DeleteOutcome`.
 *
 * `synced: false` means the row is in this browser's IndexedDB + sync_queue but
 * D1 has not confirmed it, so the caller must not report a clean success.
 *
 * `startedNewIdentity` is set when a save on a phone number that belonged to a
 * DELETED customer created a brand-new customer instead of reviving the dead
 * one. The screen should say so out loud: the operator is looking at a zeroed
 * points balance and an empty account ledger on purpose, not at a glitch.
 */
export interface SaveOutcome<T> {
  record: T;
  synced: boolean;
  reason?: string;
  startedNewIdentity?: boolean;
}

export interface IMenuRepository {
  getAll(branchId?: string): Promise<MenuItem[]>;
  create(item: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem>;
  update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem>;
  delete(id: string): Promise<DeleteOutcome>;
  resetToDefaults(defaults: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]>;
}

export interface IOrderRepository {
  getAll(branchId?: string): Promise<Order[]>;
  /** Local IndexedDB only — no cloud merge (use after renumber / offline UI). */
  getAllLocal?(branchId?: string): Promise<Order[]>;
  create(order: Omit<Order, 'id'>, branchId?: string): Promise<Order>;
  update(
    id: string,
    data: Partial<Omit<Order, 'id'>>
  ): Promise<Order>;
  updateStatus(id: string, status: OrderStatus): Promise<Order>;
  completeWithPayment(id: string, method: 'Cash' | 'Card' | 'OnAccount', patch?: Partial<Omit<Order, 'id'>>): Promise<Order>;
  delete(id: string): Promise<void>;
  resetToDefaults(defaults: Omit<Order, 'id'>[], branchId?: string): Promise<Order[]>;
  /** Optional: rewrite timestamp-like ticket numbers to short 1..N sequence */
  renumberIfNeeded?(): Promise<number>;
  /** Optional: latch printedAt so a printed order's ticket number is frozen. */
  markPrinted?(id: string): Promise<void>;
}

export interface ICustomerRepository {
  getAll(branchId?: string): Promise<Customer[]>;
  getByPhone(phone: string, branchId?: string): Promise<Customer | null>;
  save(customer: Partial<Customer> & { phone: string }, branchId?: string): Promise<Customer>;
  /**
   * Same write as `save`, but reports whether the cloud confirmed it and
   * whether a re-used phone number started a NEW customer. Screens that show
   * the operator a result should prefer this one.
   */
  saveWithOutcome(
    customer: Partial<Customer> & { phone: string },
    branchId?: string
  ): Promise<SaveOutcome<Customer>>;
  delete(id: string): Promise<DeleteOutcome>;
}

export interface ICompanyRepository {
  getAll(branchId?: string): Promise<Company[]>;
  getById(id: string): Promise<Company | null>;
  save(company: Partial<Company> & { name: string }, branchId?: string): Promise<Company>;
  delete(id: string): Promise<DeleteOutcome>;
}
