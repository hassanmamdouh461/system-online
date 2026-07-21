import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Order, OrderStatus } from '../../types/order';
import { X, Clock, CheckCircle2, XCircle, ArrowRight, ArrowLeft, Printer } from 'lucide-react';
import { useSwipe } from '../../hooks/useSwipe';
import { useIsMobile } from '../../hooks/useIsMobile';
import { filterItemsBySection } from '../../utils/orderSection';
import { useLanguage } from '../../context/LanguageContext';
import { printCustomerReceipt, printKitchenReceipt, printDrinksReceipt } from '../../utils/printReceipts';

interface OrderDetailsProps {
  order: Order | null;
  onClose: () => void;
  onUpdateStatus: (orderId: string, newStatus: OrderStatus) => void;
  type?: 'all' | 'kitchen' | 'drinks';
}

export function OrderDetails({ order, onClose, onUpdateStatus, type = 'all' }: OrderDetailsProps) {
  // Treat tablet (768–1023px) like mobile: a full-screen bottom-sheet is a much
  // better touch experience than a 448px-wide right-side drawer on a tablet.
  const isMobile = useIsMobile(1024);
  const { t, language } = useLanguage();
  const items = order ? filterItemsBySection(order.items, type) : [];
  
  const kitchenItems = order ? filterItemsBySection(order.items, 'kitchen') : [];
  const drinksItems = order ? filterItemsBySection(order.items, 'drinks') : [];
  const hasKitchen = kitchenItems.length > 0;
  const hasDrinks = drinksItems.length > 0;
  
  const swipeHandlers = useSwipe({
    onSwipeDown: () => {
      if (isMobile) onClose();
    },
  });

  return createPortal(
    <AnimatePresence>
      {order && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9998]"
            style={{ willChange: 'opacity' }}
          />
          <motion.div
            initial={isMobile ? { y: '100%' } : { x: '100%' }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: '100%' } : { x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className={`fixed ${
              isMobile 
                ? 'inset-0 rounded-t-3xl' 
                : 'right-0 top-0 bottom-0 w-full max-w-md rounded-none'
            } bg-white shadow-2xl z-[9999] flex flex-col touch-pan-y`}
            style={{ willChange: 'transform' }}
            {...swipeHandlers}
          >
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* Back Button — visible on mobile AND tablet (bottom-sheet mode) */}
              <button
                onClick={onClose}
                className="lg:hidden flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 tap-highlight-none active:bg-gray-100 transition-colors"
              >
                <ArrowLeft size={16} />
                Back to Orders
              </button>

              {/* Header */}
              <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h2 className="text-lg md:text-xl font-bold text-gray-900">Order #{order.orderNumber}</h2>
                  <p className="text-sm text-gray-500">
                    {order.tableId === 'Takeaway' || order.tableId === 'Dine-in' ? order.tableId : `Table ${order.tableId}`}
                  </p>
                </div>
                <button 
                  onClick={onClose} 
                  className="mobile-touch-target p-2 hover:bg-gray-200 rounded-full transition-colors tap-highlight-none"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 smooth-scroll">
                {/* Status Stepper (Simplified) */}
                {order.status === 'Cancelled' ? (
                  <div className="flex flex-col items-center gap-2 py-4">
                    <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                      <XCircle size={24} />
                    </div>
                    <span className="text-sm font-bold text-red-600">Order Cancelled</span>
                  </div>
                ) : (
                <div className="flex items-center justify-between text-sm">
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-sm md:text-base ${['New', 'Preparing', 'Ready', 'Completed'].includes(order.status) ? 'bg-mocha-700 text-white' : 'bg-gray-100'}`}>1</div>
                    <span className="text-xs">New</span>
                  </div>
                  <div className="h-0.5 flex-1 bg-gray-200 mx-2" />
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-sm md:text-base ${['Preparing', 'Ready', 'Completed'].includes(order.status) ? 'bg-caramel text-white' : 'bg-gray-100'}`}>2</div>
                    <span className="text-xs">Brewing</span>
                  </div>
                  <div className="h-0.5 flex-1 bg-gray-200 mx-2" />
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-sm md:text-base ${['Ready', 'Completed'].includes(order.status) ? 'bg-green-500 text-white' : 'bg-gray-100'}`}>3</div>
                    <span className="text-xs">Ready</span>
                  </div>
                </div>
                )}

                {/* Items List */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900">Items</h3>
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center p-3 md:p-4 bg-gray-50 rounded-lg gap-3">
                      <span className="bg-white w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-md border border-gray-200 font-bold text-sm shrink-0">
                        {item.quantity}x
                      </span>
                      <span className="font-medium text-gray-700 text-sm md:text-base">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="p-4 md:p-6 border-t border-gray-100 bg-gray-50/50 space-y-3 mobile-safe-area">
              <div className="grid grid-cols-2 gap-3">
                {order.status === 'New' && (
                  <button 
                    onClick={() => onUpdateStatus(order.id, 'Preparing')}
                    className="mobile-touch-target col-span-2 bg-mocha-700 text-white py-3 md:py-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-mocha-800 tap-highlight-none active:scale-95 transition-transform"
                  >
                    Start Brewing ☕ <ArrowRight size={18} />
                  </button>
                )}
                {order.status === 'Preparing' && (
                  <button 
                    onClick={() => onUpdateStatus(order.id, 'Ready')}
                    className="mobile-touch-target col-span-2 bg-caramel text-white py-3 md:py-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-caramel-dark tap-highlight-none active:scale-95 transition-transform"
                  >
                    Mark as Ready 🛎️ <CheckCircle2 size={18} />
                  </button>
                )}
                {order.status === 'Ready' && (
                  <button 
                    onClick={() => onUpdateStatus(order.id, 'Completed')}
                    className="mobile-touch-target col-span-2 bg-green-600 text-white py-3 md:py-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-green-700 tap-highlight-none active:scale-95 transition-transform"
                  >
                    Complete Order ✅ <CheckCircle2 size={18} />
                  </button>
                )}
              </div>
              
              <div className="flex gap-3">
                {order.status !== 'Cancelled' && order.status !== 'Completed' && (
                  <button 
                    onClick={() => {
                        if(confirm('Cancel this order?')) onUpdateStatus(order.id, 'Cancelled');
                    }}
                    className="mobile-touch-target flex-1 px-4 py-3 border border-red-200 text-red-600 rounded-xl font-semibold hover:bg-red-50 flex items-center justify-center gap-2 tap-highlight-none active:scale-95 transition-transform"
                  >
                    <XCircle size={18} /> Cancel Order
                  </button>
                )}
              </div>

              {/* Printing Actions */}
              <div className="border-t border-gray-200 pt-3 mt-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  {t('الطباعة / Printing')}
                </p>
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={() => order && printCustomerReceipt(order, language)}
                    className="mobile-touch-target w-full px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 flex items-center justify-center gap-2 tap-highlight-none text-xs md:text-sm transition-colors border border-gray-200/50"
                  >
                    <Printer size={14} /> {t('Print Invoice')}
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    {hasKitchen && (
                      <button 
                        onClick={() => order && printKitchenReceipt(order, language)}
                        className="mobile-touch-target px-3 py-2 bg-amber-50 text-amber-700 rounded-xl font-semibold hover:bg-amber-100 flex items-center justify-center gap-1.5 tap-highlight-none text-xs transition-colors border border-amber-100"
                      >
                        <Printer size={12} /> {t('Print Kitchen Ticket')}
                      </button>
                    )}
                    {hasDrinks && (
                      <button 
                        onClick={() => order && printDrinksReceipt(order, language)}
                        className="mobile-touch-target px-3 py-2 bg-blue-50 text-blue-700 rounded-xl font-semibold hover:bg-blue-100 flex items-center justify-center gap-1.5 tap-highlight-none text-xs transition-colors border border-blue-100"
                      >
                        <Printer size={12} /> {t('Print Drinks Ticket')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
