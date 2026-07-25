import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MenuItem } from '../types/menu';
import { Order, OrderStatus } from '../types/order';
import { menuRepository, orderRepository } from '../repositories';
import { useAuth } from './AuthContext';
import { inventoryService } from '../services/inventoryService';
import { getIngredientBaseQty } from '../utils/units';
import { syncService } from '../services/syncService';
import { useToast } from '../components/ui/Toast';


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
}

interface OrdersState {
  orders: Order[];
  loading: boolean;
  error: Error | null;
  addOrder: (order: Omit<Order, 'id'>) => Promise<Order | null>;
  updateOrderStatus: (id: string, status: OrderStatus) => Promise<void>;
  completeWithPayment: (id: string, method?: 'Cash' | 'Card' | 'OnAccount') => Promise<void>;
  refundOrder: (id: string, reason?: string) => Promise<void>;
  updateOrder: (id: string, data: Partial<Omit<Order, 'id'>>) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

interface DataContextValue {
  menu: MenuState;
  orders: OrdersState;
  /** Tell the provider that an editing surface (modal/form) is active.
   *  While true, background refetches are suppressed so typing is never wiped. */
  setEditing: (editing: boolean) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const DataContext = createContext<DataContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DataProvider({ children }: { children: React.ReactNode }) {
  // Get the current branch session for auto-injecting branchId into new records
  const { branch } = useAuth();
  const toast = useToast();

  // Menu state
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<Error | null>(null);

  // Orders state
  const [ordersList, setOrdersList] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<Error | null>(null);

  // ── Editing guard ──────────────────────────────────────────────────────────
  // A modal/form can mark itself as editing via setEditing(true). While true,
  // any refetch is suppressed so typing is never wiped by a re-render.
  const isEditingRef = useRef(false);

  // Mirror of ordersList so mutation callbacks can read the latest orders
  // without depending on [ordersList] (avoids re-creating callbacks each tick
  // and avoids stale closures when multiple mutations fire in one frame).
  const ordersListRef = useRef<Order[]>([]);
  useEffect(() => {
    ordersListRef.current = ordersList;
  }, [ordersList]);

  // Same mirror for menu items — lets toggleAvailability read the latest
  // state without re-creating on every menu change.
  const menuItemsRef = useRef<MenuItem[]>([]);
  useEffect(() => {
    menuItemsRef.current = menuItems;
  }, [menuItems]);

  const setEditing = useCallback((editing: boolean) => {
    isEditingRef.current = editing;
  }, []);

  // ── Menu fetching ────────────────────────────────────────────────────────────

  const fetchMenu = useCallback(async () => {
    // Never run a background refetch while the user is editing a form/modal —
    // it would replace the items array and re-render consumers mid-typing.
    if (isEditingRef.current) return;
    try {
      setMenuLoading(true);
      setMenuError(null);
      const targetBranch = (branch?.branchId === 'manager' || branch?.branchId === 'all') ? undefined : branch?.branchId;
      const data = await menuRepository.getAll(targetBranch);
      setMenuItems(data);
    } catch (err) {
      console.warn('[DataContext] Failed to fetch menu from repository:', err);
      setMenuError(err instanceof Error ? err : new Error(String(err)));
      // Do NOT fall back to INITIAL_MENU_ITEMS — an empty menu is valid for production.
    } finally {
      setMenuLoading(false);
    }
  }, [branch?.branchId]);

  // ── Orders fetching ───────────────────────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    if (isEditingRef.current) return;
    try {
      setOrdersLoading(true);
      setOrdersError(null);
      const targetBranch = (branch?.branchId === 'manager' || branch?.branchId === 'all') ? undefined : branch?.branchId;
      // Load (with cloud merge) first, THEN renumber so junk from cloud is cleaned.
      // After renumber, re-read LOCAL only — another cloud merge would re-inject 1000-series.
      let data = await orderRepository.getAll(targetBranch);
      try {
        if (typeof orderRepository.renumberIfNeeded === 'function') {
          const changed = await orderRepository.renumberIfNeeded();
          if (changed > 0) {
            data =
              typeof orderRepository.getAllLocal === 'function'
                ? await orderRepository.getAllLocal(targetBranch)
                : await orderRepository.getAll(targetBranch);
          }
        }
      } catch {
        // non-fatal
      }
      setOrdersList(data);
    } catch (err) {
      console.warn('[DataContext] Failed to fetch orders from repository:', err);
      setOrdersError(err instanceof Error ? err : new Error(String(err)));
      setOrdersList([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [branch?.branchId]);

  // Fetch on mount + when branch changes.
  // NOTE: A 10-second auto-refresh keeps analytics, dashboard receivables,
  // and any live views current without a manual page refresh. The editing
  // guard (isEditingRef) prevents it from wiping in-progress form state.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { hydrateFromCloud, resetHydrateCache } = await import('../services/cloudHydrate');
        // Cloud restore on mount / branch change (cross-browser source of truth)
        resetHydrateCache();
        await hydrateFromCloud(true);
      } catch {
        // offline / unconfigured
      }
      if (cancelled) return;
      await fetchMenu();
      await fetchOrders();
    })();

    // ── Auto-refresh orders every 10 seconds (suppressed while editing) ──
    const refreshInterval = setInterval(() => {
      fetchOrders();
    }, 10_000);

    return () => {
      cancelled = true;
      clearInterval(refreshInterval);
    };
  }, [fetchMenu, fetchOrders, branch?.branchId]);

  // ── Menu mutations ────────────────────────────────────────────────────────────

  const addItem = useCallback(async (item: Omit<MenuItem, 'id'>) => {
    try {
      const newItem = await menuRepository.create(item, branch?.branchId);
      setMenuItems(prev => [newItem, ...prev]);
      return newItem;
    } catch (err) {
      console.error('[DataContext] Failed to create item in repository:', err);
      toast.error(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [branch?.branchId]);

  const updateItem = useCallback(async (id: string, data: Partial<Omit<MenuItem, 'id'>>) => {
    try {
      const updatedItem = await menuRepository.update(id, data);
      setMenuItems(prev => prev.map(i => i.id === id ? updatedItem : i));
    } catch (err) {
      console.error('[DataContext] Failed to update item in repository:', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const deleteItem = useCallback(async (id: string) => {
    try {
      await menuRepository.delete(id);
      setMenuItems(prev => prev.filter(i => i.id !== id));
    } catch (err) {
      console.error('[DataContext] Failed to delete item in repository:', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const toggleAvailability = useCallback(async (id: string) => {
    const item = menuItemsRef.current.find(i => i.id === id);
    if (!item) return;
    try {
      const updatedItem = await menuRepository.update(id, { available: !item.available });
      setMenuItems(prev => prev.map(i => i.id === id ? updatedItem : i));
    } catch (err) {
      console.error('[DataContext] Failed to toggle availability in repository:', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);


  // ── Orders mutations ──────────────────────────────────────────────────────────

async function applyOrderInventory(
    order: Order,
    direction: 'deduct' | 'restore'
  ) {
    try {
      const allInv = await inventoryService.getAll();
      for (const item of order.items) {
        const recipeKey = item.menuItemId || item.id;
        const recipe = await inventoryService.getMenuItemRecipe(recipeKey);
        if (recipe && recipe.length > 0) {
          for (const ing of recipe) {
            const rawQty = ing.quantity * item.quantity;
            const targetInv = allInv.find(i => i.id === ing.inventoryItemId);
            const baseQty = getIngredientBaseQty(rawQty, ing.unit || targetInv?.unit || '', targetInv?.unit || '');
            if (direction === 'deduct') {
              await inventoryService.deductStock(
                ing.inventoryItemId,
                baseQty,
                `مبيعات أوردر #${order.orderNumber} (${item.name})`,
                `ORD-#${order.orderNumber}`
              );
            } else {
              await inventoryService.restoreStock(
                ing.inventoryItemId,
                baseQty,
                `استرجاع مخزون — إلغاء أوردر #${order.orderNumber} (${item.name})`,
                `CANCEL-#${order.orderNumber}`
              );
            }
          }
        }
      }
    } catch (err) {
      console.error(`[DataContext] Error ${direction}ing stock for order:`, err);
    }
  }


  const addOrder = useCallback(async (order: Omit<Order, 'id'>): Promise<Order | null> => {
    try {
      const newOrder = await orderRepository.create(order, branch?.branchId || 'main_branch');
      setOrdersList(prev => [newOrder, ...prev]);

      if (newOrder) {
        // Inventory deduction must NEVER block order creation
        void applyOrderInventory(newOrder, 'deduct').catch((invErr) => {
          console.error('[DataContext] Failed to deduct inventory for order:', newOrder.id, invErr);
        });
      }

      // Immediate Cloudflare D1 Sync (non-blocking)
      void syncService.syncPendingData();

      return newOrder;
    } catch (err) {
      console.error('[DataContext] Failed to create order in repository:', err);
      // Surface real error so POS can show it instead of silent null
      throw err instanceof Error ? err : new Error(String(err));
    }
  }, [branch?.branchId]);

  const updateOrderStatus = useCallback(async (id: string, status: OrderStatus) => {
    try {
      const existing = ordersListRef.current.find(o => o.id === id);
      // Paid orders must use refund/void flow — do not cancel+restock here.
      if (status === 'Cancelled' && existing?.paymentStatus === 'Paid') {
        throw new Error('Cannot cancel a paid order. Use refund/void instead.');
      }

      const updatedOrder = await orderRepository.updateStatus(id, status);
      setOrdersList(prev => prev.map(o => o.id === id ? updatedOrder : o));

      if (
        status === 'Cancelled' &&
        existing &&
        existing.status !== 'Cancelled' &&
        existing.paymentStatus !== 'Paid'
      ) {
        try {
          await applyOrderInventory(existing, 'restore');
        } catch (invErr) {
          console.error('[DataContext] Failed to restore inventory on cancel:', existing.id, invErr);
        }
      }

      void syncService.syncPendingData();
    } catch (err) {
      console.error('[DataContext] Failed to update order status in repository:', err);
      throw err;
    }
  }, []);

  const completeWithPayment = useCallback(async (id: string, method: 'Cash' | 'Card' | 'OnAccount' = 'Cash') => {
    try {
      const updatedOrder = await orderRepository.completeWithPayment(id, method);
      setOrdersList(prev => prev.map(o => o.id === id ? updatedOrder : o));
      void syncService.syncPendingData();
    } catch (err) {
      console.error('[DataContext] Failed to complete payment in repository:', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);


  /**
   * Void/refund a paid order: mark payment Refunded, restore inventory,
   * keep kitchen history but stop counting revenue.
   */
  const refundOrder = useCallback(async (id: string, reason?: string) => {
    const existing = ordersListRef.current.find(o => o.id === id);
    if (!existing) throw new Error('Order not found');
    if (existing.paymentStatus !== 'Paid') {
      throw new Error('Only paid orders can be refunded');
    }
    if (existing.paymentStatus === 'Paid' && existing.status === 'Cancelled') {
      // still allow refund path
    }

    const updatedOrder = await orderRepository.update(id, {
      paymentStatus: 'Refunded',
      refundedAt: new Date().toISOString(),
      refundReason: reason || 'Refund / void',
      status: existing.status === 'Cancelled' ? existing.status : 'Cancelled',
    });
    setOrdersList(prev => prev.map(o => (o.id === id ? updatedOrder : o)));
    try {
      await applyOrderInventory(existing, 'restore');
    } catch (invErr) {
      console.error('[DataContext] Failed to restore inventory on refund:', existing.id, invErr);
    }
  }, []);

  const updateOrder = useCallback(async (id: string, data: Partial<Omit<Order, 'id'>>) => {
    try {
      const existing = ordersListRef.current.find(o => o.id === id);

      if (data.status === 'Cancelled' && existing?.paymentStatus === 'Paid') {
        throw new Error('Cannot cancel a paid order. Use refund/void instead.');
      }

      const updatedOrder = await orderRepository.update(id, data);
      setOrdersList(prev => prev.map(o => o.id === id ? updatedOrder : o));

      if (
        data.status === 'Cancelled' &&
        existing &&
        existing.status !== 'Cancelled' &&
        existing.paymentStatus !== 'Paid'
      ) {
        try {
          await applyOrderInventory(existing, 'restore');
        } catch (invErr) {
          console.error('[DataContext] Failed to restore inventory on order update:', existing.id, invErr);
        }
      }
    } catch (err) {
      console.error('[DataContext] Failed to update order in repository:', err);
      throw err;
    }
  }, []);

  const deleteOrder = useCallback(async (id: string) => {
    try {
      const existing = ordersListRef.current.find(o => o.id === id);

      // Paid orders must use refund/void flow — never hard-delete.
      if (existing?.paymentStatus === 'Paid') {
        const msg = 'لا يمكن حذف طلب مدفوع — استخدم الاسترجاع';
        toast.error(msg);
        throw new Error(msg);
      }

      await orderRepository.delete(id);
      setOrdersList(prev => prev.filter(o => o.id !== id));

      if (existing && existing.status !== 'Cancelled') {
        try {
          await applyOrderInventory(existing, 'restore');
        } catch (invErr) {
          console.error('[DataContext] Failed to restore inventory on physical order deletion:', existing.id, invErr);
        }
      }
    } catch (err) {
      console.error('[DataContext] Failed to delete order in repository:', err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────────

  const value: DataContextValue = useMemo(() => ({
    menu: {
      items: menuItems,
      loading: menuLoading,
      error: menuError,
      addItem,
      updateItem,
      deleteItem,
      toggleAvailability,
      refetch: fetchMenu,
    },
    orders: {
      orders: ordersList,
      loading: ordersLoading,
      error: ordersError,
      addOrder,
      updateOrderStatus,
      completeWithPayment,
      refundOrder,
      updateOrder,
      deleteOrder,
      refetch: fetchOrders,
    },
    setEditing,
  }), [
    menuItems, menuLoading, menuError,
    ordersList, ordersLoading, ordersError,
    addItem, updateItem, deleteItem, toggleAvailability, fetchMenu,
    addOrder, updateOrderStatus, completeWithPayment, refundOrder, updateOrder, deleteOrder, fetchOrders,
    setEditing,
  ]);

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

