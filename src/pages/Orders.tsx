import React, { useState, useMemo } from 'react';
import { Order, OrderStatus, OrderItem } from '../types/order';
import { OrderCard } from '../components/orders/OrderCard';
import { OrderDetails } from '../components/orders/OrderDetails';
import { NewOrderModal } from '../components/orders/NewOrderModal';
import { useIsMobile } from '../hooks/useIsMobile';
import { useOrders } from '../hooks/useOrders';
import { useMenu } from '../hooks/useMenu';
import { LayoutGrid, ListOrdered } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';
import { clsx } from 'clsx';
import { POSView } from '../components/orders/POSView';

import { filterItemsBySection, getOrderStatusForSection } from '../utils/orderSection';
import { printAllOrderTickets } from '../utils/printReceipts';
import { getTaxRate } from '../utils/settingsConfig';
import { nextOrderSeq, orderSeqSortValue } from '../utils/orderNumber';

interface OrdersProps {
  type?: 'all' | 'drinks';
}

export default function Orders({ type = 'all' }: OrdersProps) {
  const { orders, error, updateOrder, addOrder } = useOrders();
  const { t, language } = useLanguage();
  const { items: menuItems } = useMenu();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [activeView, setActiveView] = useState<'pos' | 'tracker'>(type === 'all' ? 'pos' : 'tracker');
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleCreatePOSOrder = async (
    tableId: string,
    items: any[],
    paymentStatus: 'Paid' | 'Unpaid' | 'OnAccount' | 'Refunded',
    paymentMethod?: 'Cash' | 'Card' | 'OnAccount',
    paidAmount?: number,
    customerPhone?: string,
    pointsEarned?: number,
    pointsRedeemed?: number,
    accountMeta?: {
      customerId?: string;
      customerName?: string;
      companyId?: string;
      companyName?: string;
      billedToType?: 'customer' | 'company';
    }
  ) => {
    const totalAmount = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const taxRate = getTaxRate();
    const taxAmount = totalAmount * taxRate;
    const grandTotal = Math.max(0, totalAmount + taxAmount);
    void paidAmount;
    const newOrder = await addOrder({
      orderNumber: '',
      tableId,
      items,
      status: 'New',
      paymentStatus,
      paymentMethod,
      totalAmount,
      taxRate,
      taxAmount,
      grandTotal,
      createdAt: new Date().toISOString(),
      paidAt: paymentStatus === 'Paid' ? new Date().toISOString() : undefined,
      customerPhone,
      customerId: accountMeta?.customerId,
      customerName: accountMeta?.customerName,
      companyId: accountMeta?.companyId,
      companyName: accountMeta?.companyName,
      billedToType: accountMeta?.billedToType,
      pointsEarned,
      pointsRedeemed,
    });
    if (!newOrder) {
      throw new Error(language === 'ar' ? 'فشل حفظ الطلب' : 'Failed to save order');
    }
    return newOrder;
  };

  const sectionOrders = useMemo(() => {
    return orders.filter(order => filterItemsBySection(order.items, type).length > 0);
  }, [orders, type]);

  const handleCreateOrder = async (tableId: string, items: OrderItem[]) => {
    const totalAmount = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const taxRate = getTaxRate();
    const taxAmount = totalAmount * taxRate;
    const grandTotal = totalAmount + taxAmount;
    const newOrder = await addOrder({
      orderNumber: '',
      tableId,
      items,
      status: 'New',
      paymentStatus: 'Unpaid',
      totalAmount,
      taxRate,
      taxAmount,
      grandTotal,
      createdAt: new Date().toISOString(),
    });
    if (newOrder) {
      printAllOrderTickets(newOrder, language);
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      if (newStatus === 'Cancelled' && order.paymentStatus === 'Paid') {
        alert(
          language === 'ar'
            ? 'لا يمكن إلغاء طلب مدفوع. استخدم مسار الاسترجاع/الإلغاء المالي.'
            : 'Cannot cancel a paid order. Use refund/void instead.'
        );
        return;
      }

      const updatedItems = order.items.map(item => {
        const isMatch =
          type === 'all' ||
          (type === 'drinks' && filterItemsBySection([item], 'drinks').length > 0);

        if (isMatch) {
          return { ...item, status: newStatus };
        }
        return { ...item, status: item.status || order.status || 'New' };
      });

      let overallStatus = order.status;
      if (newStatus === 'Cancelled') {
        overallStatus = 'Cancelled';
      } else if (newStatus === 'Completed') {
        overallStatus = 'Completed';
      } else {
        const allStatuses = updatedItems.map(item => item.status || 'New');
        if (allStatuses.every(s => s === 'Completed')) {
          overallStatus = 'Completed';
        } else if (allStatuses.every(s => s === 'Ready' || s === 'Completed')) {
          overallStatus = 'Ready';
        } else if (allStatuses.includes('Preparing') || allStatuses.includes('Ready')) {
          overallStatus = 'Preparing';
        } else {
          overallStatus = 'New';
        }
      }

      await updateOrder(orderId, {
        items: updatedItems,
        status: overallStatus,
      });

      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder({
          ...selectedOrder,
          items: updatedItems,
          status: overallStatus,
        });
      }
    } catch (err) {
      console.error('Failed to update order status:', err);
      alert(language === 'ar' ? 'فشل تحديث حالة الطلب' : 'Failed to update order status');
    }
  };

  const handleCardClick = (order: Order) => {
    const cardStatus = getOrderStatusForSection(order, type);
    if (cardStatus === 'New') {
      handleUpdateStatus(order.id, 'Preparing');
    } else if (cardStatus === 'Preparing') {
      handleUpdateStatus(order.id, 'Ready');
    } else if (cardStatus === 'Ready') {
      handleUpdateStatus(order.id, 'Completed');
    } else {
      setSelectedOrder(order);
    }
  };

  const handleCancelOrder = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (order?.paymentStatus === 'Paid') {
      alert(
        language === 'ar'
          ? 'لا يمكن إلغاء طلب مدفوع. استخدم مسار الاسترجاع/الإلغاء المالي.'
          : 'Cannot cancel a paid order. Use refund/void instead.'
      );
      return;
    }
    if (window.confirm(language === 'ar' ? 'هل تريد إلغاء هذا الطلب؟' : 'Cancel this order?')) {
      handleUpdateStatus(orderId, 'Cancelled');
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">
            {language === 'ar' ? 'فشل تحميل الطلبات' : 'Failed to load orders'}
          </p>
          <p className="text-gray-500 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  const columns: { title: string; status: OrderStatus; color: string }[] = [
    { title: 'New Orders', status: 'New', color: 'bg-mocha-100 text-mocha-800' },
    { title: 'Brewing ☕', status: 'Preparing', color: 'bg-caramel-light text-coffee-dark' },
    { title: 'Ready for Pickup 🛎️', status: 'Ready', color: 'bg-green-50 text-green-700' },
    { title: 'Cancelled ✕', status: 'Cancelled', color: 'bg-red-50 text-red-600' },
  ];

  const groupedOrders = useMemo(() => {
    const map: Record<string, Order[]> = {
      New: [],
      Preparing: [],
      Ready: [],
      Completed: [],
      Cancelled: [],
    };
    for (const o of sectionOrders) {
      const sectionStatus = getOrderStatusForSection(o, type);
      if (map[sectionStatus]) map[sectionStatus].push(o);
    }
    const statusesToSort: OrderStatus[] = ['New', 'Preparing', 'Ready', 'Cancelled'];
    for (const status of statusesToSort) {
      map[status].sort((a, b) => orderSeqSortValue(a) - orderSeqSortValue(b));
    }
    // Completed: newest paid first (most recent settlement at top of column)
    map.Completed.sort(
      (a, b) => new Date(b.paidAt || b.createdAt).getTime() - new Date(a.paidAt || a.createdAt).getTime()
    );
    return map;
  }, [sectionOrders, type]);

  const titleMap = {
    all: { title: 'Cashier Board' },
    kitchen: { title: 'Kitchen Board' },
    drinks: { title: 'Drinks Board' },
  };
  const { title } = titleMap[type];

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] sm:h-[calc(100vh-90px)] w-full">
      {type !== 'all' && (
        <div className="mb-2 md:mb-3 shrink-0">
          <div className="flex justify-between items-center gap-3 pb-1 border-b border-gray-100">
            <div className="min-w-0">
              <h1 className="font-extrabold text-gray-900 text-lg md:text-xl truncate">
                {t(title)}
              </h1>
            </div>
          </div>
        </div>
      )}



      {type === 'all' && activeView === 'pos' ? (
        <div className="flex-1 overflow-hidden">
          <POSView
            menuItems={menuItems}
            onCreateOrder={handleCreatePOSOrder}
            estimatedOrderNumber={String(nextOrderSeq(orders))}
          />
        </div>
      ) : isMobile ? (
        <div className="flex-1 overflow-y-auto space-y-2 pb-24">
          {sectionOrders.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm">{language === 'ar' ? 'لا توجد طلبات' : 'No orders found'}</p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {sectionOrders.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onClick={handleCardClick}
                  onCancel={handleCancelOrder}
                  type={type}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-[760px] tablet:min-w-[900px] h-full">
            {columns.map(col => (
              <div
                key={col.status}
                className="flex-1 flex flex-col bg-gray-100/50 rounded-2xl p-3 border border-gray-200/50"
              >
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-gray-700 text-sm">{t(col.title)}</h3>
                  <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs font-bold">
                    {(groupedOrders[col.status] ?? []).length}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-1">
                  <AnimatePresence mode="popLayout">
                    {(groupedOrders[col.status] ?? []).map(order => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        onClick={handleCardClick}
                        onCancel={handleCancelOrder}
                        type={type}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}

            <div className="flex-1 flex flex-col bg-gray-100/50 rounded-2xl p-3 border border-gray-200/50 opacity-75">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-gray-500 text-sm">{t('Completed')}</h3>
                <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs font-bold">
                  {groupedOrders.Completed.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-1">
                <AnimatePresence mode="popLayout">
                  {groupedOrders.Completed.map(order => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onClick={handleCardClick}
                      onCancel={handleCancelOrder}
                      type={type}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      )}

      <OrderDetails
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onUpdateStatus={handleUpdateStatus}
        type={type}
      />

      <NewOrderModal
        isOpen={isNewOrderOpen}
        onClose={() => setIsNewOrderOpen(false)}
        menuItems={menuItems}
        onSubmit={handleCreateOrder}
      />
    </div>
  );
}
