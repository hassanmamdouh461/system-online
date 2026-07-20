import React, { useState, useMemo } from 'react';
import { Order, OrderStatus } from '../types/order';
import { PaymentModal } from '../components/payment/PaymentModal';
import { CreditCard, DollarSign, Search, Calculator } from 'lucide-react';
import { motion } from 'framer-motion';
import { useOrders } from '../hooks/useOrders';
import { useLanguage } from '../context/LanguageContext';
import { getTaxRate } from '../utils/settingsConfig';

export default function Payment() {
  const { t, isRtl, language } = useLanguage();
  // Use local SQLite database - sync with Orders page
  const { orders: allOrders, error, completeWithPayment } = useOrders();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterStartTime, setFilterStartTime] = useState('');
  const [filterEndTime, setFilterEndTime] = useState('');

  const [activeTab, setActiveTab] = useState<'pending' | 'paid'>('pending');

  // Show all orders pending payment — regardless of kitchen status.
  // An order leaves this screen ONLY when paymentStatus becomes 'Paid'.
  const pendingOrders = useMemo(() =>
    allOrders.filter(o => o.paymentStatus === 'Unpaid' && o.status !== 'Cancelled'),
  [allOrders]);

  // Show paid orders
  const paidOrders = useMemo(() =>
    allOrders.filter(o => o.paymentStatus === 'Paid'),
  [allOrders]);

  const orders = activeTab === 'pending' ? pendingOrders : paidOrders;

  const handleOpenPayment = (order: Order) => {
    setSelectedOrder(order);
    setIsPaymentModalOpen(true);
  };

  const handlePaymentComplete = async (orderId: string, method: 'Cash' | 'Card') => {
    try {
      await completeWithPayment(orderId, method);
    } catch (err) {
      console.error('Failed to complete payment:', err);
      alert(t('Failed to complete payment'));
    }
  };

  // Ready first → Preparing → New (cashier sees most urgent orders at the top).
  // Tie-break: oldest createdAt first (longest-waiting customer gets priority).
  const STATUS_PRIORITY: Record<string, number> = { Ready: 1, Preparing: 2, New: 3, Completed: 4, Cancelled: 5 };

  const filteredOrders = useMemo(() => {
    const list = orders.filter(o => {
      const matchesSearch = o.tableId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            o.orderNumber.toLowerCase().includes(searchTerm.toLowerCase());
      
      const orderDate = new Date(o.paidAt || o.createdAt).toLocaleDateString('en-CA'); // YYYY-MM-DD local time
      const matchesDate = !filterDate || orderDate === filterDate;
      
      let matchesTime = true;
      if (filterStartTime || filterEndTime) {
        const orderDateObj = new Date(o.paidAt || o.createdAt);
        const orderMinutes = orderDateObj.getHours() * 60 + orderDateObj.getMinutes();
        
        if (filterStartTime) {
          const [sH, sM] = filterStartTime.split(':').map(Number);
          const startMinutes = sH * 60 + sM;
          if (orderMinutes < startMinutes) matchesTime = false;
        }
        if (filterEndTime) {
          const [eH, eM] = filterEndTime.split(':').map(Number);
          const endMinutes = eH * 60 + eM;
          if (orderMinutes > endMinutes) matchesTime = false;
        }
      }
      
      return matchesSearch && matchesDate && matchesTime;
    });
    
    if (activeTab === 'pending') {
      return list.sort((a, b) => {
        const priorityA = STATUS_PRIORITY[a.status] || 99;
        const priorityB = STATUS_PRIORITY[b.status] || 99;
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        // Newest first
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    } else {
      // Paid invoices: newest first by paidAt or createdAt
      return list.sort((a, b) => {
        const timeA = new Date(a.paidAt || a.createdAt).getTime();
        const timeB = new Date(b.paidAt || b.createdAt).getTime();
        return timeB - timeA;
      });
    }
  }, [orders, searchTerm, activeTab, filterDate, filterStartTime, filterEndTime]);

  // Show error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">{t('Failed to load orders')}</p>
          <p className="text-gray-500 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  const today = new Date().toDateString();
  const totalRevenue = allOrders
    .filter(o => o.paymentStatus === 'Paid' && new Date(o.paidAt || o.createdAt).toDateString() === today)
    .reduce((sum, o) => sum + o.totalAmount * (1 + getTaxRate()), 0);

  return (
    <div className="space-y-4 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900">{t('Payment & Billing')}</h1>
          <p className="text-xs md:text-base text-gray-500">{t('Process customer payments and view daily revenue.')}</p>
        </div>
        <div className="bg-white px-4 md:px-6 py-2.5 md:py-3 rounded-xl border border-mocha-100 shadow-sm flex items-center gap-2 md:gap-3">
            <div className="p-1.5 md:p-2 bg-green-50 text-green-600 rounded-lg">
                <DollarSign size={18} className="md:w-5 md:h-5" />
            </div>
            <div>
                <p className="text-[10px] md:text-xs text-gray-500 font-medium">{t("Today's Revenue (incl. tax)")}</p>
                <p className="text-base md:text-lg font-bold text-gray-900">
                  {totalRevenue.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}
                </p>
            </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-6">
        <button
          onClick={() => setActiveTab('pending')}
          className={`pb-3 font-semibold text-sm transition-all border-b-2 px-1 relative ${
            activeTab === 'pending'
              ? 'border-mocha-700 text-mocha-800'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('Pending Payments')} ({pendingOrders.length})
          {activeTab === 'pending' && (
            <motion.div
              layoutId="activeTabUnderline"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-mocha-700"
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab('paid')}
          className={`pb-3 font-semibold text-sm transition-all border-b-2 px-1 relative ${
            activeTab === 'paid'
              ? 'border-mocha-700 text-mocha-800'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('Paid Invoices')} ({paidOrders.length})
          {activeTab === 'paid' && (
            <motion.div
              layoutId="activeTabUnderline"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-mocha-700"
            />
          )}
        </button>
      </div>

      {/* Filters (Search, Date Calendar, & Time Range) */}
      <div className="flex flex-col tablet:flex-row gap-3 items-stretch tablet:items-center xl:flex-row xl:items-center">
        {/* Search */}
        <div className="relative flex-1 max-w-full tablet:max-w-md xl:max-w-md">
          <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 md:w-5 md:h-5 ${isRtl ? 'right-3' : 'left-3'}`} />
          <input
            type="text"
            placeholder={t('Search by Table or Order ID...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full py-2.5 md:py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent shadow-sm text-sm md:text-base ${isRtl ? 'pr-9 md:pr-10 pl-4' : 'pl-9 md:pl-10 pr-4'}`}
          />
        </div>

        {/* Date and Time Range Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Calendar Picker */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="py-2.5 md:py-3 px-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent shadow-sm text-sm md:text-base text-gray-700 min-w-[150px]"
            />
          </div>

          {/* Time Range Pickers */}
          <div className="flex items-center gap-2 bg-white px-3 py-2.5 md:py-3 border border-gray-200 rounded-xl shadow-sm text-sm md:text-base text-gray-700">
            <span className="text-gray-500 font-medium text-xs md:text-sm">{t('From Time')}:</span>
            <input
              type="time"
              value={filterStartTime}
              onChange={(e) => setFilterStartTime(e.target.value)}
              className="bg-transparent border-none p-0 focus:outline-none text-gray-800 font-mono text-xs md:text-sm"
            />
            <span className="text-gray-300">|</span>
            <span className="text-gray-500 font-medium text-xs md:text-sm">{t('To Time')}:</span>
            <input
              type="time"
              value={filterEndTime}
              onChange={(e) => setFilterEndTime(e.target.value)}
              className="bg-transparent border-none p-0 focus:outline-none text-gray-800 font-mono text-xs md:text-sm"
            />
          </div>

          {/* Clear Button */}
          {(filterDate || filterStartTime || filterEndTime) && (
            <button
              onClick={() => {
                setFilterDate('');
                setFilterStartTime('');
                setFilterEndTime('');
              }}
              className="py-2.5 md:py-3 px-3 text-xs font-bold bg-red-50 text-red-650 hover:bg-red-100 rounded-xl border border-red-200 transition-colors shadow-sm active:scale-95"
            >
              {t('Clear Filter')}
            </button>
          )}
        </div>
      </div>

      {/* Orders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
        {filteredOrders.length > 0 ? (
           filteredOrders.map(order => (
            <motion.div
              layout
              key={order.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:border-gray-300 transition-colors relative overflow-hidden"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                   <h3 className="text-xl font-bold text-gray-900">{t(order.tableId)}</h3>
                   <p className="text-sm text-gray-500">{t('order #')}{order.orderNumber}</p>
                </div>
                <div className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                   activeTab === 'paid'         ? 'bg-green-50 text-green-700 border border-green-200' :
                   order.status === 'Completed' ? 'bg-purple-100 text-purple-700' :
                   order.status === 'Ready'     ? 'bg-green-100 text-green-700'  :
                                                  'bg-blue-50 text-blue-700'
                }`}>
                   {activeTab === 'paid' ? `${t('Paid')} (${t(order.paymentMethod || 'Cash')})` : (order.status === 'Completed' ? t('✓ Ready to Pay') : t(order.status))}
                </div>
              </div>

              <div className="space-y-2 mb-6">
                {order.items.slice(0, 2).map((item, idx) => (
                   <div key={idx} className="flex justify-between text-sm text-gray-600">
                      <span>{item.quantity}x {t(item.name)}</span>
                      <span>{(item.price * item.quantity).toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                   </div>
                ))}
                {order.items.length > 2 && (
                   <p className="text-xs text-gray-400 italic">+{order.items.length - 2} {t('more items...')}</p>
                )}
                <div className="border-t border-gray-100 pt-2 flex justify-between font-bold text-lg text-gray-900">
                   <span>{t('Total')}</span>
                   <span>{(order.totalAmount * (1 + getTaxRate())).toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                </div>
              </div>

              {activeTab === 'pending' ? (
                <button
                  onClick={() => handleOpenPayment(order)}
                  className="w-full py-3 bg-gray-900 text-white rounded-xl font-semibold hover:bg-black transition-colors flex items-center justify-center gap-2 shadow-lg shadow-gray-200"
                >
                  <CreditCard size={18} /> {t('Process Payment')}
                </button>
              ) : (
                <button
                  onClick={() => handleOpenPayment(order)}
                  className="w-full py-3 bg-mocha-600 text-white rounded-xl font-semibold hover:bg-mocha-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-gray-250"
                >
                  <CreditCard size={18} /> {t('View Invoice')}
                </button>
              )}
            </motion.div>
           ))
        ) : (
           <div className="col-span-full text-center py-20 text-gray-500">
              <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                 <Calculator className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-lg font-medium">
                {activeTab === 'pending' ? t('No payable orders found') : t('No paid invoices found')}
              </p>
           </div>
        )}
      </div>

      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        order={selectedOrder}
        onPaymentComplete={handlePaymentComplete}
      />
    </div>
  );
}
