import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getTaxRate } from '../../utils/settingsConfig';
import { MenuItem, CATEGORIES } from '../../types/menu';
import { OrderItem, Order } from '../../types/order';
import { useLanguage } from '../../context/LanguageContext';
import { Coffee, Trash2, Plus, Minus, CreditCard, DollarSign, Check, XCircle, Printer, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { printCustomerReceipt } from '../../utils/printReceipts';

interface POSViewProps {
  menuItems: MenuItem[];
  onCreateOrder: (
    tableId: string,
    items: OrderItem[],
    paymentStatus: 'Paid' | 'Unpaid',
    paymentMethod?: 'Cash' | 'Card',
    paidAmount?: number,
    customerPhone?: string,
    pointsEarned?: number,
    pointsRedeemed?: number
  ) => Promise<Order | null>;
  estimatedOrderNumber: string;
}

export function POSView({ menuItems, onCreateOrder, estimatedOrderNumber }: POSViewProps) {
  const { t, isRtl, language } = useLanguage();
  
  const [invoiceItems, setInvoiceItems] = useState<OrderItem[]>(() => {
    try {
      const saved = localStorage.getItem('pos_invoiceItems');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [receivedAmount, setReceivedAmount] = useState<string>(() => {
    return localStorage.getItem('pos_receivedAmount') || '0';
  });
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Card'>(() => {
    return (localStorage.getItem('pos_paymentMethod') as 'Cash' | 'Card') || 'Cash';
  });
  const [paymentStatus, setPaymentStatus] = useState<'Paid' | 'Unpaid'>(() => {
    return (localStorage.getItem('pos_paymentStatus') as 'Paid' | 'Unpaid') || 'Paid';
  });
  const [orderMode, setOrderMode] = useState<'Dine-in' | 'Takeaway'>(() => {
    return (localStorage.getItem('pos_orderMode') as 'Dine-in' | 'Takeaway') || 'Takeaway';
  });
  const [tableId, setTableId] = useState<string>(() => {
    return localStorage.getItem('pos_tableId') || '';
  });
  
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('pos_invoiceItems', JSON.stringify(invoiceItems));
  }, [invoiceItems]);

  useEffect(() => {
    localStorage.setItem('pos_receivedAmount', receivedAmount);
  }, [receivedAmount]);

  useEffect(() => {
    localStorage.setItem('pos_paymentMethod', paymentMethod);
  }, [paymentMethod]);

  useEffect(() => {
    localStorage.setItem('pos_paymentStatus', paymentStatus);
  }, [paymentStatus]);

  useEffect(() => {
    localStorage.setItem('pos_orderMode', orderMode);
  }, [orderMode]);

  useEffect(() => {
    localStorage.setItem('pos_tableId', tableId);
  }, [tableId]);

  const [isLoyaltyModalOpen, setIsLoyaltyModalOpen] = useState(false);
  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [loyaltyName, setLoyaltyName] = useState('');
  const [existingCustomer, setExistingCustomer] = useState<any>(null);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [pendingCheckoutAction, setPendingCheckoutAction] = useState<'save' | 'print'>('save');

  const handleSetOrderMode = (mode: 'Dine-in' | 'Takeaway') => {
    setOrderMode(mode);
    if (mode === 'Takeaway') {
      setPaymentStatus('Paid');
    } else {
      setPaymentStatus('Unpaid');
      setTableId('');
    }
  };

  // Available categories for cashier: only All, Bar (بار), Kitchen (مطبخ)
  const categories = useMemo(() => {
    return ['All', 'Bar', 'Kitchen'];
  }, []);

  // Filtered menu items
  const filteredMenuItems = useMemo(() => {
    const available = menuItems.filter(item => item.available);
    
    // Filter by preparation destination (part after '|')
    const categoryFiltered = selectedCategory === 'All' 
      ? available 
      : available.filter(item => {
          const parts = item.category ? item.category.split('|') : [];
          const prepDest = parts[1] || parts[0] || '';
          return prepDest === selectedCategory;
        });
      
    // Next, filter by search query (Arabic & English support)
    if (!searchQuery.trim()) return categoryFiltered;
    
    const query = searchQuery.toLowerCase().trim();
    return categoryFiltered.filter(item => {
      const nameTranslated = t(item.name).toLowerCase();
      const descTranslated = t(item.description || '').toLowerCase();
      const nameOriginal = item.name.toLowerCase();
      const descOriginal = (item.description || '').toLowerCase();
      
      return nameOriginal.includes(query) || 
             descOriginal.includes(query) ||
             nameTranslated.includes(query) ||
             descTranslated.includes(query);
    });
  }, [menuItems, selectedCategory, searchQuery, t]);

  // Total invoice amount
  const totalAmount = useMemo(() => {
    return invoiceItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [invoiceItems]);

  const taxRate = getTaxRate();
  const taxAmount = useMemo(() => totalAmount * taxRate, [totalAmount, taxRate]);
  const grandTotal = useMemo(() => totalAmount + taxAmount, [totalAmount, taxAmount]);

  // Items count
  const itemsCount = useMemo(() => {
    return invoiceItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [invoiceItems]);

  // Change amount
  const changeAmount = useMemo(() => {
    const received = parseFloat(receivedAmount);
    if (isNaN(received) || received <= grandTotal) return 0;
    return received - grandTotal;
  }, [receivedAmount, grandTotal]);

  // Add item to invoice
  const handleAddItem = (menuItem: MenuItem) => {
    setInvoiceItems(prev => {
      const existing = prev.find(item => item.id === menuItem.id);
      if (existing) {
        return prev.map(item =>
          item.id === menuItem.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          id: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: 1,
          category: menuItem.category,
        },
      ];
    });
  };

  // Adjust item quantity
  const handleAdjustQuantity = (itemId: string, amount: number) => {
    setInvoiceItems(prev => {
      return prev
        .map(item => {
          if (item.id === itemId) {
            const nextQty = item.quantity + amount;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as OrderItem[];
    });
  };

  // Remove item from invoice
  const handleRemoveItem = (itemId: string) => {
    setInvoiceItems(prev => prev.filter(item => item.id !== itemId));
  };

  // Keypad presses
  const handleKeypadPress = (val: string) => {
    setReceivedAmount(prev => {
      if (val === 'C') return '0';
      if (val === '.') {
        if (prev.includes('.')) return prev;
        return prev + '.';
      }
      if (prev === '0') return val;
      return prev + val;
    });
  };

  // Quick cash buttons
  const handleQuickCash = (amount: number) => {
    setReceivedAmount(prev => {
      const current = parseFloat(prev) || 0;
      return String(current + amount);
    });
  };

  // Reset current invoice
  const handleReset = () => {
    setInvoiceItems([]);
    setReceivedAmount('0');
    setPaymentMethod('Cash');
    setPaymentStatus(orderMode === 'Takeaway' ? 'Paid' : 'Unpaid');
    setTableId('');
    localStorage.removeItem('pos_invoiceItems');
    localStorage.removeItem('pos_receivedAmount');
    localStorage.removeItem('pos_paymentMethod');
    localStorage.removeItem('pos_paymentStatus');
    localStorage.removeItem('pos_orderMode');
    localStorage.removeItem('pos_tableId');
  };

  // Save and place order
  const handleSaveOrder = () => {
    triggerCheckout('save');
  };

  const handlePrintAndPay = () => {
    triggerCheckout('print');
  };

  const triggerCheckout = (action: 'save' | 'print') => {
    if (invoiceItems.length === 0) {
      alert(t('Please add items to invoice first'));
      return;
    }

    if (orderMode === 'Dine-in' && !tableId.trim()) {
      alert(t('Please select table number first'));
      return;
    }

    setPendingCheckoutAction(action);
    setLoyaltyPhone('');
    setLoyaltyName('');
    setExistingCustomer(null);
    setRedeemPoints(false);
    setIsLoyaltyModalOpen(true);
  };

  const handlePhoneChange = async (phone: string) => {
    // Only numbers allowed, max 11 digits
    const cleaned = phone.replace(/\D/g, '').slice(0, 11);
    setLoyaltyPhone(cleaned);
    if (cleaned.length === 11) {
      try {
        const cust = await window.electronAPI.getCustomerByPhone(cleaned);
        setExistingCustomer(cust);
        if (cust) {
          setLoyaltyName(cust.name);
        } else {
          setLoyaltyName('');
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      setExistingCustomer(null);
      setLoyaltyName('');
    }
  };

  const handleConfirmLoyalty = async () => {
    let customerPhone: string | undefined = undefined;
    let pointsEarned = 0;
    let pointsRedeemed = 0;

    const trimmedPhone = loyaltyPhone.trim();
    if (trimmedPhone) {
      if (trimmedPhone.length !== 11) {
        alert(t('Phone number must be exactly 11 digits'));
        return;
      }
      customerPhone = trimmedPhone;
      
      if (redeemPoints && existingCustomer) {
        pointsRedeemed = Math.min(existingCustomer.points, grandTotal);
      }
      
      const remainingAmount = Math.max(0, grandTotal - pointsRedeemed);
      pointsEarned = Math.floor(remainingAmount / 50);

      const newPoints = (existingCustomer ? existingCustomer.points : 0) - pointsRedeemed + pointsEarned;
      try {
        await window.electronAPI.saveCustomer({
          phone: trimmedPhone,
          name: loyaltyName.trim() || 'Customer',
          points: newPoints
        });
      } catch (err) {
        console.error('Failed to save customer loyalty points:', err);
      }
    }

    setIsLoyaltyModalOpen(false);
    
    // Proceed with checkout
    if (pendingCheckoutAction === 'save') {
      await executeSaveOrder(customerPhone, pointsEarned, pointsRedeemed);
    } else {
      await executePrintAndPay(customerPhone, pointsEarned, pointsRedeemed);
    }
  };

  const handleSkipLoyalty = async () => {
    setIsLoyaltyModalOpen(false);
    if (pendingCheckoutAction === 'save') {
      await executeSaveOrder();
    } else {
      await executePrintAndPay();
    }
  };

  const executeSaveOrder = async (customerPhone?: string, pointsEarned?: number, pointsRedeemed?: number) => {
    try {
      const finalTableId = orderMode === 'Takeaway' ? 'Takeaway' : `${t('Table')} ${tableId}`;
      const paidAmt = paymentStatus === 'Paid' ? (grandTotal - (pointsRedeemed || 0)) : undefined;
      await onCreateOrder(finalTableId, invoiceItems, paymentStatus, paymentMethod, paidAmt, customerPhone, pointsEarned, pointsRedeemed);
      
      handleReset();
      setSuccessMessage(t('Successfully saved order'));
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error(err);
      alert('Failed to save order');
    }
  };

  const executePrintAndPay = async (customerPhone?: string, pointsEarned?: number, pointsRedeemed?: number) => {
    try {
      const finalTableId = orderMode === 'Takeaway' ? 'Takeaway' : `${t('Table')} ${tableId}`;
      const finalPaymentStatus = 'Paid';
      const paidAmt = grandTotal - (pointsRedeemed || 0);

      // Create order
      const newOrder = await onCreateOrder(finalTableId, invoiceItems, finalPaymentStatus, paymentMethod, paidAmt, customerPhone, pointsEarned, pointsRedeemed);

      if (newOrder) {
        printCustomerReceipt(newOrder, language);
      }

      handleReset();
      setSuccessMessage(t('Successfully saved order'));
      setTimeout(() => setSuccessMessage(null), 3050);
    } catch (err) {
      console.error(err);
      alert('Failed to process print and save');
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full overflow-hidden text-gray-800">
      
      {/* 1. LEFT COLUMN: Payments & Calculator (Width 28%) - Only visible for Takeaway */}
      {orderMode === 'Takeaway' && (
        <div className="w-full lg:w-[28%] lg:h-full bg-white p-2 md:p-2.5 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col justify-between overflow-hidden pos-calculator">
          <div className="overflow-y-auto hide-scrollbar flex-1 pr-0.5 flex flex-col justify-start gap-2 h-full">
            <h2 className="font-extrabold text-xs md:text-sm text-mocha-800 border-b border-gray-100 pb-1.5 shrink-0">
              <span className="font-sans">{t('Payment & Invoice')}</span>
            </h2>
            
            {/* Total Due & Received Amount Input */}
            <div className="grid grid-cols-2 gap-2 shrink-0">
              <div className="space-y-0.5">
                <label className="text-xs text-gray-500 font-extrabold"><span className="font-sans">{t('Total Due')}</span></label>
                <div className="w-full bg-gray-950 text-amber-400 font-mono text-base md:text-lg font-black px-2 py-0.5 rounded-xl border border-gray-800 flex justify-between items-center select-all h-[36px]">
                  <span>{grandTotal.toFixed(2)}</span>
                  <span className="text-[10px] text-gray-500 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
                </div>
              </div>

              <div className="space-y-0.5">
                <label className="text-xs text-gray-500 font-extrabold"><span className="font-sans">{t('Received Amount')}</span></label>
                <div className="w-full bg-gray-950 text-emerald-400 font-mono text-base md:text-lg font-black px-2 py-0.5 rounded-xl border border-gray-800 flex justify-between items-center select-all h-[36px]">
                  <span>{receivedAmount}</span>
                  <span className="text-[10px] text-gray-500 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
                </div>
              </div>
            </div>

            {/* Change for Customer */}
            <div className="space-y-0.5 shrink-0">
              <label className="text-xs text-gray-500 font-extrabold"><span className="font-sans">{t('Change for Customer')}</span></label>
              <div className="w-full bg-gray-950 text-amber-400 font-mono text-base md:text-lg font-black px-2 py-0.5 rounded-xl border border-gray-800 flex justify-between items-center h-[36px]">
                <span>{changeAmount.toFixed(2)}</span>
                <span className="text-[10px] text-gray-500 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
              </div>
            </div>

            {/* Quick Cash Buttons */}
            <div className="grid grid-cols-3 gap-1.5 shrink-0">
              {[10, 20, 50, 100, 200, 500].map(amt => (
                <button
                  key={amt}
                  onClick={() => handleQuickCash(amt)}
                  className="bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all text-xs md:text-sm font-black text-gray-800 py-1.5 rounded-xl border border-gray-200 shadow-sm"
                >
                  {amt}
                </button>
              ))}
            </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 grid-rows-5 gap-1.5 font-mono flex-grow min-h-[160px]">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '00'].map(num => (
                <button
                  key={num}
                  onClick={() => handleKeypadPress(num)}
                  className="bg-gray-50 hover:bg-gray-100 active:scale-95 transition-all text-base md:text-lg font-black text-gray-900 rounded-xl border border-gray-200 shadow-sm flex items-center justify-center h-full"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={() => handleKeypadPress('C')}
                className="col-span-3 bg-red-500 hover:bg-red-600 text-white text-base md:text-lg font-black rounded-xl border border-red-600 shadow-sm active:scale-95 transition-all flex items-center justify-center h-full"
              >
                C
              </button>
            </div>

            {/* Payment Method Selection */}
            <div className="mt-1 border-t border-gray-100 pt-1.5 shrink-0">
              <div className="space-y-0.5">
                <label className="text-[10px] md:text-xs text-gray-500 font-extrabold uppercase block"><span className="font-sans">{t('Payment Method')}</span></label>
                <div className="flex bg-gray-100 rounded-xl p-0.5 border border-gray-200">
                  <button
                    onClick={() => setPaymentMethod('Cash')}
                    className={clsx(
                      "flex-1 py-1 rounded-lg text-xs md:text-sm font-black transition-all flex items-center justify-center gap-1.5",
                      paymentMethod === 'Cash' ? "bg-white text-mocha-700 shadow-sm" : "text-gray-500 hover:bg-white/30"
                    )}
                  >
                    <DollarSign size={14} />
                    <span className="font-sans">{t('Cash')}</span>
                  </button>
                  <button
                    onClick={() => setPaymentMethod('Card')}
                    className={clsx(
                      "flex-1 py-1 rounded-lg text-xs md:text-sm font-black transition-all flex items-center justify-center gap-1.5",
                      paymentMethod === 'Card' ? "bg-white text-mocha-700 shadow-sm" : "text-gray-500 hover:bg-white/30"
                    )}
                  >
                    <CreditCard size={14} />
                    <span className="font-sans">{t('Card')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Action Button Row */}
          <div className="space-y-1.5 mt-2 pt-1.5 border-t border-gray-100 shrink-0">
            <button
              onClick={handlePrintAndPay}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-1.5 rounded-xl border border-emerald-700 transition-all active:scale-95 text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Printer size={14} />
              <span className="font-sans">{t('Print & Pay')}</span>
            </button>
            
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={handleReset}
                className="bg-red-50 hover:bg-red-100 text-red-600 font-black py-1.5 rounded-xl border border-red-200 transition-all active:scale-95 text-xs sm:text-sm text-center"
              >
                <span className="font-sans">{t('Clear / Reset')}</span>
              </button>
              <button
                onClick={handleSaveOrder}
                className="bg-mocha-600 hover:bg-mocha-700 text-white font-black py-1.5 rounded-xl border border-mocha-700 transition-all active:scale-95 text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Check size={14} />
                <span className="font-sans">{t('Save Invoice')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. CENTER COLUMN: Product Grid & Category Filters (Width 2/4) */}
      <div className="flex-1 lg:h-full bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col overflow-hidden">
        {/* Category Selector & Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 shrink-0">
          {/* Categories */}
          <div className="flex gap-2 overflow-x-auto hide-scrollbar">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={clsx(
                  "px-5 py-2.5 rounded-xl text-sm md:text-base font-black whitespace-nowrap transition-all border",
                  selectedCategory === cat
                    ? "bg-mocha-600 text-white border-mocha-700 shadow-sm"
                    : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                )}
              >
                {t(cat)}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 ${isRtl ? 'right-3' : 'left-3'}`} />
            <input
              type="text"
              placeholder={t('Search items...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-mocha-500 focus:border-transparent text-sm font-semibold ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'}`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className={`absolute top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 ${isRtl ? 'left-3' : 'right-3'}`}
              >
                <XCircle size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Products Grid */}
        <div className="flex-1 overflow-y-auto mt-4 pr-1 custom-scrollbar">
          {successMessage && (
            <div className="bg-green-50 text-green-700 border border-green-200 rounded-xl p-3 mb-4 font-bold text-center text-xs animate-bounce">
              {successMessage}
            </div>
          )}
          {filteredMenuItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
              <Coffee size={50} className="stroke-1 mb-2" />
              <p className="text-sm md:text-base font-bold">{t('No items')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-4 gap-3">
              {filteredMenuItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleAddItem(item)}
                  className="bg-gray-50 hover:bg-gray-100 active:scale-95 transition-all p-2.5 rounded-xl border border-gray-200/60 hover:border-gray-300 shadow-sm flex flex-col justify-between items-start text-start h-24 sm:h-26 relative overflow-hidden group"
                >
                  <span className="font-bold text-sm sm:text-base md:text-[16px] text-gray-900 group-hover:text-mocha-700 font-sans leading-snug pt-0.5">{t(item.name)}</span>
                  <div className="w-full flex justify-between items-center z-10 mt-1">
                    <span className="font-mono text-base sm:text-lg md:text-xl font-black text-mocha-800">{item.price.toFixed(2)} <span className="text-[10px] sm:text-xs text-gray-400 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span></span>
                    <span className="bg-mocha-50 text-mocha-600 text-sm sm:text-base px-2.5 py-0.5 rounded-lg border border-mocha-200 group-hover:bg-mocha-600 group-hover:text-white transition-colors font-black">+</span>
                  </div>
                  {/* Subtle hover icon decoration */}
                  <Coffee size={32} className="absolute -right-2 -bottom-2 text-gray-200/20 group-hover:text-mocha-200/10 transition-all pointer-events-none" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. RIGHT COLUMN: Current Bill & Summary (Width 23%) */}
      <div className="w-full lg:w-[23%] lg:h-full bg-white p-3 md:p-3.5 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col justify-between overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <h2 className="font-extrabold text-base md:text-lg text-mocha-800 border-b border-gray-100 pb-2 shrink-0">{t('Invoice Details')}</h2>
          
          {/* Table Mode Selector */}
          <div className="flex bg-gray-100 rounded-xl p-1 border border-gray-200 mt-3 shrink-0">
            <button
              onClick={() => handleSetOrderMode('Dine-in')}
              className={clsx(
                "flex-1 py-2.5 rounded-lg text-sm md:text-base font-black transition-all",
                orderMode === 'Dine-in' ? "bg-white text-mocha-700 shadow-sm" : "text-gray-500 hover:bg-white/50"
              )}
            >
              {t('Dine-in')}
            </button>
            <button
              onClick={() => handleSetOrderMode('Takeaway')}
              className={clsx(
                "flex-1 py-2.5 rounded-lg text-sm md:text-base font-black transition-all",
                orderMode === 'Takeaway' ? "bg-white text-mocha-700 shadow-sm" : "text-gray-500 hover:bg-white/50"
              )}
            >
              {t('Takeaway')}
            </button>
          </div>

          {/* Table ID Selector (Only visible for Dine-in) */}
          {orderMode === 'Dine-in' && (
            <div className="mt-3 shrink-0 space-y-2 border-b border-gray-100 pb-3">
              <label className="text-sm text-gray-600 font-extrabold">{t('Table')}</label>
              <input
                type="text"
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
                placeholder={t('Enter Table Number')}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl font-extrabold text-base md:text-lg focus:outline-none focus:border-mocha-600 focus:ring-2 focus:ring-mocha-100"
              />
              <div className="flex flex-wrap gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map(num => (
                  <button
                    key={num}
                    onClick={() => setTableId(num)}
                    className={clsx(
                      "px-3.5 py-2 text-sm md:text-base font-extrabold rounded-xl border transition-all shadow-sm",
                      tableId === num
                        ? "bg-mocha-600 text-white border-mocha-700"
                        : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                    )}
                  >
                    T{num}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Current Invoice List */}
          <div className="flex-1 overflow-y-auto mt-2 pr-1 hide-scrollbar border-b border-gray-100 pb-2">
            {invoiceItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 py-6">
                <Coffee size={32} className="stroke-1 mb-1" />
                <p className="text-xs font-bold">{t('No items')}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {invoiceItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex justify-between items-center bg-gray-50 p-2 rounded-xl border border-gray-200 text-xs md:text-sm gap-1.5 shadow-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="font-extrabold text-[10px] md:text-xs text-gray-400 font-sans">{idx + 1}.</span>
                        <span className="font-extrabold text-gray-900 truncate text-xs md:text-sm font-sans">{t(item.name)}</span>
                      </div>
                      <span className="text-[11px] md:text-xs text-mocha-700 font-extrabold font-mono">{(item.price * item.quantity).toFixed(2)} <span className="font-sans text-[9px] md:text-[10px]">{isRtl ? 'ج.م' : 'EGP'}</span></span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <div className="flex items-center bg-white border border-gray-200 rounded-md p-0.5 shadow-sm">
                        <button
                          onClick={() => handleAdjustQuantity(item.id, -1)}
                          className="p-1 hover:bg-gray-100 rounded text-gray-500"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="px-1.5 font-black text-gray-900 text-xs md:text-sm">{item.quantity}</span>
                        <button
                          onClick={() => handleAdjustQuantity(item.id, 1)}
                          className="p-1 hover:bg-gray-100 rounded text-gray-500"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-1 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Invoice Summary Box */}
        <div className="mt-2 space-y-1.5 shrink-0">
          <div className="grid grid-cols-2 gap-1.5 text-xs md:text-sm">
            <div className="bg-gray-50 p-2 rounded-xl border border-gray-200 flex flex-col justify-between shadow-sm">
              <span className="text-gray-500 text-[10px] md:text-xs font-extrabold">{t('Invoice Number')}</span>
              <span className="font-black text-gray-950 mt-1 text-xs md:text-sm">{estimatedOrderNumber}</span>
            </div>
            <div className="bg-gray-50 p-2 rounded-xl border border-gray-200 flex flex-col justify-between shadow-sm">
              <span className="text-gray-500 text-[10px] md:text-xs font-extrabold">{t('Items Count')}</span>
              <span className="font-black text-gray-950 mt-1 text-xs md:text-sm">{itemsCount}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-xs md:text-sm">
            <div className="bg-gray-50 p-2 rounded-xl border border-gray-200 flex flex-col justify-between shadow-sm">
              <span className="text-gray-500 text-[10px] md:text-xs font-extrabold">{t('Invoice Date')}</span>
              <span className="font-extrabold text-gray-900 mt-1 text-xs md:text-sm">{new Date().toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</span>
            </div>
            
            {/* Invoice Total - Highlighted in Caramel/Yellow */}
            <div className="bg-amber-50/50 rounded-xl p-1.5 border border-amber-200/60 flex flex-col items-center justify-center min-h-[44px] relative">
              <span className="text-[8px] text-amber-600/80 font-extrabold mb-0.5 font-sans">{t('Total')}</span>
              <span className="font-mono text-xs font-black text-amber-900 mt-0.5">{grandTotal.toFixed(2)} <span className="text-[9px] font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span></span>
              <span className="absolute bottom-0.5 text-[6px] text-amber-600/60 font-sans">{isRtl ? 'شامل الضريبة' : 'incl. tax'}</span>
            </div>
          </div>
          
          {/* Action buttons (only visible here for Dine-in orders to save space) */}
          {orderMode === 'Dine-in' && (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                onClick={handleReset}
                className="bg-red-50 hover:bg-red-100 text-red-600 font-black py-2 rounded-xl border border-red-200 transition-all active:scale-95 text-xs md:text-sm text-center"
              >
                {t('Clear / Reset')}
              </button>
              <button
                onClick={handleSaveOrder}
                className="bg-mocha-600 hover:bg-mocha-700 text-white font-black py-2 rounded-xl border border-mocha-700 transition-all active:scale-95 text-xs md:text-sm text-center flex items-center justify-center gap-1 shadow-sm"
              >
                <Check size={14} />
                {t('Save Invoice')}
              </button>
            </div>
          )}
        </div>

      </div>

      {/* ─── Customer Loyalty Points Modal ─── */}
      <AnimatePresence>
        {isLoyaltyModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 max-w-md w-full relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-mocha-500 to-caramel" />
              
              <div className="mb-6 mt-2">
                <h3 className="text-xl font-bold text-gray-900 text-left">{t('Register New Customer')}</h3>
                <p className="text-xs text-gray-400 mt-1 text-left">
                  {t('Enter customer phone number to accumulate or redeem loyalty points.')}
                </p>
              </div>

              <div className="space-y-4">
                {/* Phone Input */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 block text-left">{t('Phone Number')}</label>
                  <input
                    type="tel"
                    placeholder={t('Enter customer phone')}
                    value={loyaltyPhone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel text-left font-mono"
                    autoFocus
                  />
                </div>

                {/* Name Input (Visible ONLY when phone is exactly 11 digits) */}
                {loyaltyPhone.length === 11 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-1"
                  >
                    <label className="text-xs font-semibold text-gray-500 block text-left">{t('Customer Name')}</label>
                    <input
                      type="text"
                      placeholder={t('Customer Name')}
                      value={loyaltyName}
                      onChange={(e) => setLoyaltyName(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel text-left"
                      disabled={!!existingCustomer}
                    />
                  </motion.div>
                )}



                {/* Points Redemption Info */}
                {existingCustomer && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 bg-mocha-50/50 rounded-2xl border border-mocha-100 flex flex-col gap-2"
                  >
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-650 font-medium">{t('Points Balance')}:</span>
                      <span className="font-bold text-mocha-800">{existingCustomer.points} {t('Points')}</span>
                    </div>
                    {existingCustomer.points > 0 && (
                      <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={redeemPoints}
                          onChange={(e) => setRedeemPoints(e.target.checked)}
                          className="w-4 h-4 rounded text-mocha-650 focus:ring-mocha-500 border-gray-300"
                        />
                        <span className="text-xs font-semibold text-gray-700">
                          {t('Redeem Points')} ({Math.min(existingCustomer.points, grandTotal).toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'} {t('discount')})
                        </span>
                      </label>
                    )}
                  </motion.div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-8">
                <button
                  onClick={handleSkipLoyalty}
                  className="flex-1 py-3 border border-gray-200 text-gray-500 rounded-2xl font-bold hover:bg-gray-50 transition-colors"
                >
                  {t('Skip')}
                </button>
                <button
                  onClick={handleConfirmLoyalty}
                  className="flex-1 py-3 bg-mocha-700 hover:bg-mocha-800 text-white rounded-2xl font-bold transition-all shadow-lg shadow-mocha-200 active:scale-[0.98]"
                >
                  {t('Confirm')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
