import React from 'react';
import { motion } from 'framer-motion';
import { Order, OrderStatus } from '../../types/order';
import { Clock, CheckCircle2, ChefHat, Coffee, AlertCircle, ShoppingBag, XCircle, X } from 'lucide-react';
import { clsx } from 'clsx';

import { filterItemsBySection, getOrderStatusForSection } from '../../utils/orderSection';
import { useLanguage } from '../../context/LanguageContext';

interface OrderCardProps {
  order: Order;
  onClick: (order: Order) => void;
  onCancel?: (orderId: string) => void;
  selected?: boolean;
  type?: 'all' | 'kitchen' | 'drinks';
}

const statusColors: Record<OrderStatus, { bg: string; text: string; gradient: string; icon: string }> = {
  New: { 
    bg: 'bg-blue-50', 
    text: 'text-blue-700', 
    gradient: 'from-blue-400 to-cyan-400',
    icon: 'text-blue-600'
  },
  Preparing: { 
    bg: 'bg-amber-50', 
    text: 'text-amber-700', 
    gradient: 'from-amber-400 to-orange-400',
    icon: 'text-amber-600'
  },
  Ready: { 
    bg: 'bg-green-50', 
    text: 'text-green-700', 
    gradient: 'from-green-400 to-emerald-400',
    icon: 'text-green-600'
  },
  Completed: { 
    bg: 'bg-gray-50', 
    text: 'text-gray-600', 
    gradient: 'from-gray-300 to-slate-300',
    icon: 'text-gray-500'
  },
  Cancelled: { 
    bg: 'bg-red-50', 
    text: 'text-red-600', 
    gradient: 'from-red-400 to-rose-400',
    icon: 'text-red-500'
  },
};

const statusIcons: Record<OrderStatus, React.ElementType> = {
  New: AlertCircle,
  Preparing: ChefHat,
  Ready: CheckCircle2,
  Completed: ShoppingBag,
  Cancelled: XCircle,
};

export const OrderCard = React.forwardRef<HTMLDivElement, OrderCardProps>(
  function OrderCard({ order, onClick, onCancel, selected, type = 'all' }, ref) {
  const { t } = useLanguage();
  const cardStatus = getOrderStatusForSection(order, type);
  const StatusIcon = statusIcons[cardStatus];
  const colors = statusColors[cardStatus];
  const items = filterItemsBySection(order.items, type);
  
  const kitchenItems = filterItemsBySection(order.items, 'kitchen');
  const drinksItems = filterItemsBySection(order.items, 'drinks');
  const hasKitchen = kitchenItems.length > 0;
  const hasDrinks = drinksItems.length > 0;

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.96 }}
      transition={{ type: 'spring', damping: 22, stiffness: 280 }}
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onClick(order)}
      className={clsx(
        "mobile-touch-target cursor-pointer p-3 md:p-4 rounded-xl md:rounded-2xl transition-all relative overflow-hidden group",
        selected 
          ? "bg-white shadow-xl shadow-caramel/20 border-2 border-caramel/30" 
          : "bg-white/90 backdrop-blur-sm shadow-md hover:shadow-xl border border-gray-200/50 hover:border-gray-300/50"
      )}
    >
      {/* Soft gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-mocha-50/0 to-caramel-light/0 group-hover:from-mocha-50/20 group-hover:to-caramel-light/20 transition-all duration-300 pointer-events-none rounded-2xl" />

      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="flex justify-between items-start mb-2 md:mb-3">
          <div className="flex items-center gap-1.5 md:gap-2">
            <span className="font-bold text-base md:text-lg text-gray-900">{order.tableId}</span>
            <span className="text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
              #{order.orderNumber}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Status badge - softer */}
            <div className={clsx(
              "px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm border",
              colors.bg,
              colors.text,
              "border-current/10"
            )}>
              <StatusIcon size={14} className={colors.icon} />
              {cardStatus}
            </div>

            {onCancel && order.status !== 'Cancelled' && order.status !== 'Completed' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel(order.id);
                }}
                className="p-1 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors border border-gray-200/60 z-20"
                title="Cancel Order"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="space-y-2 mb-4">
          {items && items.length > 0 ? items.map((item, idx) => (
            <div key={idx} className="flex justify-between text-sm items-center">
              <span className="text-gray-600">
                <span className="inline-flex items-center justify-center min-w-[24px] h-6 rounded-lg bg-mocha-50 text-mocha-700 font-bold text-xs mr-2 px-1.5 border border-mocha-100/50">
                  {item.quantity}×
                </span>
                {item.name}
              </span>
            </div>
          )) : (
            <div className="text-xs text-gray-400 italic">No items</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 pt-3 border-t border-gray-100">
          <div className="flex justify-between items-center text-xs">
            {/* Time */}
            <div className="flex items-center gap-1.5 text-gray-500">
              <div className="p-1 rounded-lg bg-gray-100">
                <Clock size={12} />
              </div>
              <span className="font-medium">
                {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>

          {/* Destinations */}
          {(hasKitchen || hasDrinks) && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 bg-gray-50/80 p-1.5 rounded-lg border border-gray-100">
              <span className="text-gray-400">{t('الوجهة:')}</span>
              <div className="flex flex-wrap gap-1">
                {hasKitchen && (
                  <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100">
                    <ChefHat size={10} />
                    {t('المطبخ')}
                  </span>
                )}
                {hasDrinks && (
                  <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">
                    <Coffee size={10} />
                    {t('المشروبات')}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
);
