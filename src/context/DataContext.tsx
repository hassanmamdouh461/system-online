import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { MenuItem, INITIAL_MENU_ITEMS } from '../types/menu';
import { Order, OrderStatus } from '../types/order';
import { menuRepository, orderRepository } from '../repositories';
import { useAuth } from './AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuState {
  items: MenuItem[];
  loading: boolean;
  error: Error | null;
  addItem: (item: Omit<MenuItem, 'id'>) => Promise<MenuItem | null>;
  updateItem: (id: string, data: Partial<Omit<MenuItem, 'id'>>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  toggleAvailability: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
  resetMenu: () => Promise<void>;
}

interface OrdersState {
  orders: Order[];
  loading: boolean;
  error: Error | null;
  addOrder: (order: Omit<Order, 'id'>) => Promise<Order | null>;
  updateOrderStatus: (id: string, status: OrderStatus) => Promise<void>;
  completeWithPayment: (id: string, method?: 'Cash' | 'Card') => Promise<void>;
  updateOrder: (id: string, data: Partial<Omit<Order, 'id'>>) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

interface DataContextValue {
  menu: MenuState;
  orders: OrdersState;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const DataContext = createContext<DataContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DataProvider({ children }: { children: React.ReactNode }) {
  // Get the current branch session for auto-injecting branchId into new records
  const { branch } = useAuth();

  // Menu state
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<Error | null>(null);

  // Orders state
  const [ordersList, setOrdersList] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<Error | null>(null);

  // ── Menu fetching ────────────────────────────────────────────────────────────

  const fetchMenu = useCallback(async () => {
    try {
      setMenuLoading(true);
      setMenuError(null);
      const data = await menuRepository.getAll(branch?.branchId);
      setMenuItems(data);
    } catch (err) {
      console.warn('[DataContext] Failed to fetch menu from repository, using default initial items:', err);
      setMenuItems(INITIAL_MENU_ITEMS);
    } finally {
      setMenuLoading(false);
    }
  }, [branch?.branchId]);

  // ── Orders fetching ───────────────────────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    try {
      setOrdersLoading(true);
      setOrdersError(null);
      const data = await orderRepository.getAll(branch?.branchId);
      setOrdersList(data);
    } catch (err) {
      console.warn('[DataContext] Failed to fetch orders from repository:', err);
      setOrdersList([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [branch?.branchId]);

  // Fetch when branch changes
  useEffect(() => {
    fetchMenu();
    fetchOrders();
  }, [fetchMenu, fetchOrders]);

  // ── Menu mutations ────────────────────────────────────────────────────────────

  const addItem = useCallback(async (item: Omit<MenuItem, 'id'>) => {
    try {
      const newItem = await menuRepository.create(item, branch?.branchId);
      setMenuItems(prev => [newItem, ...prev]);
      return newItem;
    } catch (err) {
      console.error('[DataContext] Failed to create item in repository:', err);
      return null;
    }
  }, [branch?.branchId]);

  const updateItem = useCallback(async (id: string, data: Partial<Omit<MenuItem, 'id'>>) => {
    try {
      const updatedItem = await menuRepository.update(id, data);
      setMenuItems(prev => prev.map(i => i.id === id ? updatedItem : i));
    } catch (err) {
      console.error('[DataContext] Failed to update item in repository:', err);
    }
  }, []);

  const deleteItem = useCallback(async (id: string) => {
    try {
      await menuRepository.delete(id);
      setMenuItems(prev => prev.filter(i => i.id !== id));
    } catch (err) {
      console.error('[DataContext] Failed to delete item in repository:', err);
    }
  }, []);

  const toggleAvailability = useCallback(async (id: string) => {
    const item = menuItems.find(i => i.id === id);
    if (!item) return;
    try {
      const updatedItem = await menuRepository.update(id, { available: !item.available });
      setMenuItems(prev => prev.map(i => i.id === id ? updatedItem : i));
    } catch (err) {
      console.error('[DataContext] Failed to toggle availability in repository:', err);
    }
  }, [menuItems]);

  const resetMenu = useCallback(async () => {
    try {
      setMenuLoading(true);
      setMenuError(null);
      const seeded = await menuRepository.resetToDefaults(INITIAL_MENU_ITEMS, branch?.branchId);
      setMenuItems(seeded);
    } catch (err) {
      console.error('[DataContext] Failed to reset menu to defaults:', err);
      setMenuError(err as Error);
    } finally {
      setMenuLoading(false);
    }
  }, [branch?.branchId]);

  // ── Orders mutations ──────────────────────────────────────────────────────────

  const addOrder = useCallback(async (order: Omit<Order, 'id'>): Promise<Order | null> => {
    try {
      const newOrder = await orderRepository.create(order, branch?.branchId);
      setOrdersList(prev => [newOrder, ...prev]);
      return newOrder;
    } catch (err) {
      console.error('[DataContext] Failed to create order in repository:', err);
      return null;
    }
  }, [branch?.branchId]);

  const updateOrderStatus = useCallback(async (id: string, status: OrderStatus) => {
    try {
      const updatedOrder = await orderRepository.updateStatus(id, status);
      setOrdersList(prev => prev.map(o => o.id === id ? updatedOrder : o));
    } catch (err) {
      console.error('[DataContext] Failed to update order status in repository:', err);
    }
  }, []);

  const completeWithPayment = useCallback(async (id: string, method: 'Cash' | 'Card' = 'Cash') => {
    try {
      const updatedOrder = await orderRepository.completeWithPayment(id, method);
      setOrdersList(prev => prev.map(o => o.id === id ? updatedOrder : o));
    } catch (err) {
      console.error('[DataContext] Failed to complete payment in repository:', err);
    }
  }, []);

  const updateOrder = useCallback(async (id: string, data: Partial<Omit<Order, 'id'>>) => {
    try {
      const updatedOrder = await orderRepository.update(id, data);
      setOrdersList(prev => prev.map(o => o.id === id ? updatedOrder : o));
    } catch (err) {
      console.error('[DataContext] Failed to update order in repository:', err);
    }
  }, []);

  const deleteOrder = useCallback(async (id: string) => {
    try {
      await orderRepository.delete(id);
      setOrdersList(prev => prev.filter(o => o.id !== id));
    } catch (err) {
      console.error('[DataContext] Failed to delete order in repository:', err);
    }
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────────

  const value: DataContextValue = {
    menu: {
      items: menuItems,
      loading: menuLoading,
      error: menuError,
      addItem,
      updateItem,
      deleteItem,
      toggleAvailability,
      refetch: fetchMenu,
      resetMenu,
    },
    orders: {
      orders: ordersList,
      loading: ordersLoading,
      error: ordersError,
      addOrder,
      updateOrderStatus,
      completeWithPayment,
      updateOrder,
      deleteOrder,
      refetch: fetchOrders,
    },
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useMenuContext(): MenuState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useMenuContext must be used within DataProvider');
  return ctx.menu;
}

export function useOrdersContext(): OrdersState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useOrdersContext must be used within DataProvider');
  return ctx.orders;
}

