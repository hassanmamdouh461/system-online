import { MenuItem } from '../types/menu';
import { Order, OrderStatus } from '../types/order';
import { Customer } from '../types/customer';

export interface IMenuRepository {
  getAll(branchId?: string): Promise<MenuItem[]>;
  create(item: Omit<MenuItem, 'id'>, branchId?: string): Promise<MenuItem>;
  update(id: string, data: Partial<Omit<MenuItem, 'id'>>): Promise<MenuItem>;
  delete(id: string): Promise<void>;
  resetToDefaults(defaults: Omit<MenuItem, 'id'>[], branchId?: string): Promise<MenuItem[]>;
}

export interface IOrderRepository {
  getAll(branchId?: string): Promise<Order[]>;
  create(order: Omit<Order, 'id'>, branchId?: string): Promise<Order>;
  update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order>;
  updateStatus(id: string, status: OrderStatus): Promise<Order>;
  completeWithPayment(id: string, method: 'Cash' | 'Card'): Promise<Order>;
  delete(id: string): Promise<void>;
  resetToDefaults(defaults: Omit<Order, 'id'>[], branchId?: string): Promise<Order[]>;
}

export interface ICustomerRepository {
  getAll(branchId?: string): Promise<Customer[]>;
  getByPhone(phone: string, branchId?: string): Promise<Customer | null>;
  save(customer: Partial<Customer> & { phone: string }, branchId?: string): Promise<Customer>;
  delete(id: string): Promise<void>;
}
