import { IOrderRepository } from '../types';
import { Order, OrderStatus } from '../../types/order';

export class SqliteOrderRepository implements IOrderRepository {
  async getAll(branchId?: string): Promise<Order[]> {
    const orders = await window.electronAPI.getOrders();
    if (!branchId) return orders;
    // Auto-filter by branch_id
    return orders.filter(order => order.branchId === branchId);
  }

  async create(order: Omit<Order, 'id'>, branchId?: string): Promise<Order> {
    const orderWithBranch = { ...order, branchId };
    return window.electronAPI.createOrder(orderWithBranch);
  }

  async update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order> {
    return window.electronAPI.updateOrder(id, data);
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    return window.electronAPI.updateOrderStatus(id, status);
  }

  async completeWithPayment(id: string, method: 'Cash' | 'Card' | 'OnAccount'): Promise<Order> {
    return window.electronAPI.completeOrderPayment(id, method);
  }

  async delete(id: string): Promise<void> {
    return window.electronAPI.deleteOrder(id);
  }

  async resetToDefaults(defaults: Omit<Order, 'id'>[], branchId?: string): Promise<Order[]> {
    const defaultsWithBranch = defaults.map(order => ({ ...order, branchId }));
    return window.electronAPI.resetOrders(defaultsWithBranch);
  }
}
