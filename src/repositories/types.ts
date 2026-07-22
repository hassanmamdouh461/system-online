import { MenuItem } from '../types/menu';
import { Order, OrderStatus } from '../types/order';
import { Customer } from '../types/customer';
import { Company } from '../types/company';

export interface IMenuRepository {
  getAll(branchId?: string): Promise<MenuItem[]>;
  create(item: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem>;
  update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem>;
  delete(id: string): Promise<void>;
  resetToDefaults(defaults: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]>;
}

export interface IOrderRepository {
  getAll(branchId?: string): Promise<Order[]>;
  /** Local IndexedDB only — no cloud merge (use after renumber / offline UI). */
  getAllLocal?(branchId?: string): Promise<Order[]>;
  create(order: Omit<Order, 'id'>, branchId?: string): Promise<Order>;
  update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order>;
  updateStatus(id: string, status: OrderStatus): Promise<Order>;
  completeWithPayment(id: string, method: 'Cash' | 'Card' | 'OnAccount'): Promise<Order>;
  delete(id: string): Promise<void>;
  resetToDefaults(defaults: Omit<Order, 'id'>[], branchId?: string): Promise<Order[]>;
  /** Optional: rewrite timestamp-like ticket numbers to short 1..N sequence */
  renumberIfNeeded?(): Promise<number>;
}

export interface ICustomerRepository {
  getAll(branchId?: string): Promise<Customer[]>;
  getByPhone(phone: string, branchId?: string): Promise<Customer | null>;
  save(customer: Partial<Customer> & { phone: string }, branchId?: string): Promise<Customer>;
  delete(id: string): Promise<void>;
}

export interface ICompanyRepository {
  getAll(branchId?: string): Promise<Company[]>;
  getById(id: string): Promise<Company | null>;
  save(company: Partial<Company> & { name: string }, branchId?: string): Promise<Company>;
  delete(id: string): Promise<void>;
}
