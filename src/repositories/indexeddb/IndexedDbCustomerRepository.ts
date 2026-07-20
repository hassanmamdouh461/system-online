import { ICustomerRepository } from '../types';
import { Customer } from '../../types/customer';
import { getDB } from './db';

export class IndexedDbCustomerRepository implements ICustomerRepository {
  async getAll(branchId?: string): Promise<Customer[]> {
    const db = await getDB();
    const customers = await db.getAll('customers');
    if (!branchId) return customers;
    return customers.filter(c => c.branchId === branchId);
  }

  async getByPhone(phone: string, branchId?: string): Promise<Customer | null> {
    const db = await getDB();
    const customer = await db.getFromIndex('customers', 'by-phone', phone);
    if (!customer) return null;
    if (branchId && customer.branchId !== branchId) return null;
    return customer;
  }

  async save(customerData: Partial<Customer> & { phone: string }, branchId?: string): Promise<Customer> {
    const db = await getDB();
    const existing = await this.getByPhone(customerData.phone, branchId);

    const id = existing?.id || customerData.id || `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const customer: Customer = {
      id,
      name: customerData.name || 'عميل',
      phone: customerData.phone,
      points: customerData.points !== undefined ? customerData.points : (existing?.points || 0),
      branchId: branchId || customerData.branchId,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };

    await db.put('customers', customer);

    await db.put('sync_queue', {
      id: `sync_cust_${id}_${Date.now()}`,
      type: 'customer',
      action: 'create',
      data: customer,
      timestamp: new Date().toISOString(),
      synced: 0,
    });

    return customer;
  }

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('customers', id);

    await db.put('sync_queue', {
      id: `sync_cust_del_${id}_${Date.now()}`,
      type: 'customer',
      action: 'delete',
      data: { id },
      timestamp: new Date().toISOString(),
      synced: 0,
    });
  }
}
