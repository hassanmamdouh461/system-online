import { Order, OrderStatus } from '../types/order';
import { orderRepository } from '../repositories';

/**
 * Orders Service - Handle all CRUD operations for Orders using repository (IndexedDB for Web PWA)
 */
export const ordersService = {
  async getAll(branchId?: string): Promise<Order[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.getOrders) {
        return await window.electronAPI.getOrders();
      }
      return await orderRepository.getAll(branchId);
    } catch (error) {
      console.error('[ordersService] Error fetching orders:', error);
      return await orderRepository.getAll(branchId);
    }
  },

  async create(order: Omit<Order, 'id'>, branchId?: string): Promise<Order> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.createOrder) {
        return await window.electronAPI.createOrder(order);
      }
      return await orderRepository.create(order, branchId);
    } catch (error) {
      return await orderRepository.create(order, branchId);
    }
  },

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.updateOrderStatus) {
        return await window.electronAPI.updateOrderStatus(id, status);
      }
      return await orderRepository.updateStatus(id, status);
    } catch (error) {
      return await orderRepository.updateStatus(id, status);
    }
  },

  async update(id: string, data: Partial<Omit<Order, 'id'>>): Promise<Order> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.updateOrder) {
        return await window.electronAPI.updateOrder(id, data);
      }
      return await orderRepository.update(id, data);
    } catch (error) {
      return await orderRepository.update(id, data);
    }
  },

  async completeWithPayment(id: string, method: 'Cash' | 'Card' = 'Cash'): Promise<Order> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.completeOrderPayment) {
        return await window.electronAPI.completeOrderPayment(id, method);
      }
      return await orderRepository.completeWithPayment(id, method);
    } catch (error) {
      return await orderRepository.completeWithPayment(id, method);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.deleteOrder) {
        await window.electronAPI.deleteOrder(id);
        return;
      }
      await orderRepository.delete(id);
    } catch (error) {
      await orderRepository.delete(id);
    }
  },

  async resetToDefaults(defaultOrders: Omit<Order, 'id'>[], branchId?: string): Promise<Order[]> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.resetOrders) {
        return await window.electronAPI.resetOrders(defaultOrders);
      }
      return await orderRepository.resetToDefaults(defaultOrders, branchId);
    } catch (error) {
      return await orderRepository.resetToDefaults(defaultOrders, branchId);
    }
  },
};
