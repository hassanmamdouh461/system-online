import { ICustomerRepository } from '../types';
import { Customer } from '../../types/customer';

export class SqliteCustomerRepository implements ICustomerRepository {
  async getAll(branchId?: string): Promise<Customer[]> {
    const customers = await window.electronAPI.getCustomers();
    if (!branchId) return customers;
    // Auto-filter by branch_id
    return customers.filter(c => c.branchId === branchId);
  }

  async getByPhone(phone: string, branchId?: string): Promise<Customer | null> {
    const customer = await window.electronAPI.getCustomerByPhone(phone);
    if (!customer) return null;
    if (branchId && customer.branchId !== branchId) return null;
    return customer;
  }

  async save(customer: Partial<Customer> & { phone: string }, branchId?: string): Promise<Customer> {
    const customerWithBranch = { ...customer, branchId };
    return window.electronAPI.saveCustomer(customerWithBranch);
  }

  async delete(id: string): Promise<void> {
    return window.electronAPI.deleteCustomer(id);
  }
}
