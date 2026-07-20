import { Customer } from '../types/customer';
import { customerRepository } from '../repositories';

/**
 * Customers Service - Handle CRUD operations for Customers using customerRepository (IndexedDB)
 */
export const customersService = {
  async getAll(branchId?: string): Promise<Customer[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getCustomers) {
        return await window.electronAPI.getCustomers();
      }
      return await customerRepository.getAll(branchId);
    } catch (error) {
      return await customerRepository.getAll(branchId);
    }
  },

  async getByPhone(phone: string, branchId?: string): Promise<Customer | null> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getCustomerByPhone) {
        return await window.electronAPI.getCustomerByPhone(phone);
      }
      return await customerRepository.getByPhone(phone, branchId);
    } catch (error) {
      return await customerRepository.getByPhone(phone, branchId);
    }
  },

  async save(customer: Partial<Customer> & { phone: string }, branchId?: string): Promise<Customer> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.saveCustomer) {
        return await window.electronAPI.saveCustomer(customer);
      }
      return await customerRepository.save(customer, branchId);
    } catch (error) {
      return await customerRepository.save(customer, branchId);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.deleteCustomer) {
        await window.electronAPI.deleteCustomer(id);
        return;
      }
      await customerRepository.delete(id);
    } catch (error) {
      await customerRepository.delete(id);
    }
  },
};
