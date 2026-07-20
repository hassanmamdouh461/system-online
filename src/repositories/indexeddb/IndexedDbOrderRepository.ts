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
    const now = new Date().toISOString();
    const newOrder: Order = {
      ...orderData,
      id,
      branchId,
      createdAt: orderData.createdAt || now,
    };

    // ATOMIC write: order + sync-queue entry in ONE transaction.
    // If the page is closed / power is lost / refresh happens mid-write, either
    // BOTH records are committed or NEITHER is — never an order without a sync
    // entry (which would silently stay local forever) and never an orphan sync
    // entry for a non-existent order.
    const tx = db.transaction(['orders', 'sync_queue'], 'readwrite');
    await tx.objectStore('orders').put(newOrder);
    await tx.objectStore('sync_queue').put({
      id: `sync_${id}`,
      type: 'order',
      action: 'create',
      data: newOrder,
      timestamp: now,
      synced: 0,
    });
    await tx.done;

    return newOrder;
  }

  async update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order> {
    const db = await getDB();
    const tx = db.transaction(['orders', 'sync_queue'], 'readwrite');
    const ordersStore = tx.objectStore('orders');
    const existing = await ordersStore.get(id);
    if (!existing) {
      await tx.done;
      throw new Error(`Order ${id} not found`);
    }

    const updated: Order = { ...existing, ...data, updatedAt: new Date().toISOString() };
    const now = new Date().toISOString();

    // ATOMIC: persist the updated order AND queue it for cloud sync together.
    await ordersStore.put(updated);
    await tx.objectStore('sync_queue').put({
      id: `sync_${id}_${Date.now()}`,
      type: 'order',
      action: 'update',
      data: updated,
      timestamp: now,
      synced: 0,
    });
    await tx.done;

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
    const now = new Date().toISOString();

    // ATOMIC: remove the local order AND enqueue the tombstone for cloud sync.
    const tx = db.transaction(['orders', 'sync_queue'], 'readwrite');
    await tx.objectStore('orders').delete(id);
    await tx.objectStore('sync_queue').put({
      id: `sync_del_${id}_${Date.now()}`,
      type: 'order',
      action: 'delete',
      data: { id },
      timestamp: now,
      synced: 0,
    });
    await tx.done;
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
