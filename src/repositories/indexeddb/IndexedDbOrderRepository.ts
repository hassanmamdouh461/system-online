import { IOrderRepository } from '../types';
import { Order, OrderStatus } from '../../types/order';
import { getDB } from './db';

export class IndexedDbOrderRepository implements IOrderRepository {
  async getAll(branchId?: string): Promise<Order[]> {
    const db = await getDB();
    const orders = await db.getAll('orders');
    if (!branchId) return orders;
    return orders.filter(order => order.branchId === branchId);
  }

  async create(orderData: Omit<Order, 'id'>, branchId?: string): Promise<Order> {
    const db = await getDB();
    const id = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newOrder: Order = {
      ...orderData,
      id,
      branchId,
      createdAt: orderData.createdAt || new Date().toISOString(),
    };

    // Save order locally
    await db.put('orders', newOrder);

    // Queue for cloud sync
    await db.put('sync_queue', {
      id: `sync_${id}`,
      type: 'order',
      action: 'create',
      data: newOrder,
      timestamp: new Date().toISOString(),
      synced: 0,
    });

    return newOrder;
  }

  async update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order> {
    const db = await getDB();
    const existing = await db.get('orders', id);
    if (!existing) throw new Error(`Order ${id} not found`);

    const updated: Order = { ...existing, ...data };
    await db.put('orders', updated);

    // Queue for sync
    await db.put('sync_queue', {
      id: `sync_${id}_${Date.now()}`,
      type: 'order',
      action: 'update',
      data: updated,
      timestamp: new Date().toISOString(),
      synced: 0,
    });

    return updated;
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    return this.update(id, { status });
  }

  async completeWithPayment(id: string, method: 'Cash' | 'Card'): Promise<Order> {
    return this.update(id, {
      status: 'Completed',
      paymentStatus: 'Paid',
      paymentMethod: method,
      paidAt: new Date().toISOString(),
    });
  }

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('orders', id);

    await db.put('sync_queue', {
      id: `sync_del_${id}_${Date.now()}`,
      type: 'order',
      action: 'delete',
      data: { id },
      timestamp: new Date().toISOString(),
      synced: 0,
    });
  }

  async resetToDefaults(defaults: Omit<Order, 'id'>[], branchId?: string): Promise<Order[]> {
    const db = await getDB();
    await db.clear('orders');
    const created: Order[] = [];
    for (const item of defaults) {
      const order = await this.create(item, branchId);
      created.push(order);
    }
    return created;
  }
}
