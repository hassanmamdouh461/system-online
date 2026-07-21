import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Order } from '../../types/order';
import { X, CheckCircle2, Receipt, Printer, CreditCard, Banknote } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../../context/LanguageContext';
import { getTaxRate } from '../../utils/settingsConfig';
import { printCustomerReceipt } from '../../utils/printReceipts';

interface PaymentModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onPaymentComplete: (orderId: string, method: 'Cash' | 'Card') => void;
}

export function PaymentModal({ order, isOpen, onClose, onPaymentComplete }: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Card'>('Cash');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const { t, language } = useLanguage();
  // Track whether onPaymentComplete has already been called for this session.
  // Prevents double-firing if the user clicks Done twice or if any stale timer fires.
  const paymentFiredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset all state when the modal opens on a fresh order
  useEffect(() => {
    if (isOpen && order) {
      if (order.paymentStatus === 'Paid') {
        setPaymentMethod(order.paymentMethod || 'Cash');
        setIsProcessing(false);
        setShowReceipt(true);
      } else {
        setPaymentMethod('Cash');
        setIsProcessing(false);
        setShowReceipt(false);
      }
      paymentFiredRef.current = false;
    }
    // Cleanup: cancel any pending timer if the modal is closed externally (e.g. backdrop)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOpen, order?.id]); // re-run only when a different order opens

  if (!isOpen || !order) return null;

  const subtotal = order.totalAmount;
  const taxRate = getTaxRate();
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  const handleProcessPayment = () => {
    setIsProcessing(true);
    timerRef.current = setTimeout(() => {
      // Fire the DB write immediately when payment "succeeds" — not on modal dismiss.
      // Capture orderId/method in closure so stale state can never target the wrong order.
      const orderId = order.id;
      const method  = paymentMethod;
      if (!paymentFiredRef.current) {
        paymentFiredRef.current = true;
        onPaymentComplete(orderId, method);
      }
      setIsProcessing(false);
      setShowReceipt(true);
    }, 100);
  };

  const handleClose = () => {
    // Cancel any in-flight timer to prevent the stale-receipt bug
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsProcessing(false);
    setShowReceipt(false);
    onClose();
  };

  const handlePrintReceipt = () => {
    printCustomerReceipt(order, language);
  };

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        />

        <motion.div
           initial={{ opacity: 0, scale: 0.95 }}
           animate={{ opacity: 1, scale: 1 }}
           exit={{ opacity: 0, scale: 0.95 }}
           className="bg-white rounded-2xl w-full max-w-lg shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90dvh]"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <CreditCard className="text-mocha-700" />
              {showReceipt ? t('Payment Successful') : t('Process Payment')}
            </h2>
            <button onClick={handleClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
              <X size={20} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            {!showReceipt ? (
              <div className="space-y-6">
                 {/* Order Summary */}
                 <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-gray-500">{t('Table')}</span>
                      <span className="font-bold text-gray-900">{t(order.tableId)}</span>
                    </div>
                    <div className="flex justify-between items-center mb-2">
                       <span className="text-sm text-gray-500">{t('Order ID')}</span>
                       <span className="font-mono text-xs bg-gray-200 px-2 py-1 rounded">{order.orderNumber}</span>
                    </div>
                    
                    {/* Order Items Details */}
                    <div className="mt-3 bg-white border border-gray-100 rounded-lg p-3 max-h-48 overflow-y-auto">
                      <p className="text-xs font-bold text-gray-500 mb-2 border-b border-gray-100 pb-1">{t('Items')}</p>
                      <div className="space-y-2">
                        {order.items.map((item, idx) => (
                          <div key={item.id || idx} className="flex justify-between text-xs text-gray-700">
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-400 font-mono">x{item.quantity}</span>
                              <span className="font-medium">{t(item.name)}</span>
                            </div>
                            <span className="font-mono">{(item.price * item.quantity).toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-gray-200 my-3" />
                    
                    <div className="space-y-1.5 text-xs text-gray-500">
                      <div className="flex justify-between">
                        <span>{t('Subtotal')} ({t('Price')})</span>
                        <span className="font-mono">{subtotal.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                      </div>
                      <div className="flex justify-between items-center text-gray-500 mb-2">
                        <span>{language === 'ar' ? `الضريبة (${taxRate * 100}%)` : `Tax (${taxRate * 100}%)`}</span>
                        <span className="font-mono">{tax.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 my-3" />
                    <div className="flex justify-between items-center text-lg font-bold">
                       <span>{t('Total to Pay')}</span>
                       <span className="text-mocha-700">{total.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                    </div>
                 </div>

                 {/* Payment Method Selection */}
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">{t('Select Payment Method')}</label>
                    <div className="grid grid-cols-2 gap-4">
                       <button
                          onClick={() => setPaymentMethod('Cash')}
                          className={clsx(
                             "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
                             paymentMethod === 'Cash' ? "border-mocha-700 bg-mocha-100 text-mocha-800" : "border-gray-100 hover:border-gray-200 text-gray-600"
                          )}
                       >
                          <Banknote size={24} />
                          <span className="font-medium">{t('Cash')}</span>
                       </button>
                       <button
                          onClick={() => setPaymentMethod('Card')}
                          className={clsx(
                             "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
                             paymentMethod === 'Card' ? "border-mocha-700 bg-mocha-100 text-mocha-800" : "border-gray-100 hover:border-gray-200 text-gray-600"
                          )}
                       >
                          <CreditCard size={24} />
                          <span className="font-medium">{t('Card')}</span>
                       </button>
                    </div>
                 </div>

                 <button
                    onClick={handleProcessPayment}
                    disabled={isProcessing}
                    className="w-full bg-mocha-700 text-white py-4 rounded-xl font-bold text-lg hover:bg-mocha-800 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                 >
                    {isProcessing ? t('Processing...') : `${t('Pay')} ${total.toFixed(2)} ${language === 'ar' ? 'ج.م' : 'EGP'}`}
                 </button>
              </div>
            ) : (
              <div className="text-center space-y-6">
                 <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 size={32} />
                 </div>
                 
                 <div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-1">{t('Payment Received!')}</h3>
                    <p className="text-gray-500">{t('Transaction completed successfully.')}</p>
                 </div>

                 {/* Mock Receipt Preview */}
                 <div className="bg-gray-50 p-6 rounded-xl border border-gray-100 text-left font-mono text-sm shadow-inner relative overflow-hidden text-gray-900">
                    {/* Jaggered edge effect */}
                    <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-transparent to-white bg-[length:10px_100%]" />
                    
                    <div className="text-center border-b border-gray-200 pb-4 mb-4">
                       <p className="font-bold text-lg">{t('BREWMASTER')}</p>
                       <p className="text-xs text-gray-400">{t('42 Roast Street, Coffee District')}</p>
                    </div>

                    <div className="space-y-2 mb-4">
                       {order.items.map((item, i) => (
                          <div key={i} className="flex justify-between">
                             <span>{item.quantity}x {t(item.name)}</span>
                             <span>{(item.price * item.quantity).toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                          </div>
                       ))}
                    </div>

                    <div className="border-t border-gray-200 pt-4 space-y-1">
                       <div className="flex justify-between">
                          <span>{t('Subtotal')}</span>
                          <span>{subtotal.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                       </div>
                       <div className="flex justify-between items-center text-sm font-bold text-gray-700">
                          <span>{language === 'ar' ? `الضريبة (${taxRate * 100}%)` : `Tax (${taxRate * 100}%)`}</span>
                          <span>{tax.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                       </div>
                       <div className="flex justify-between font-bold text-base pt-2">
                          <span>{t('TOTAL')}</span>
                          <span>{total.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}</span>
                       </div>
                    </div>
                    
                    <div className="text-center mt-6 text-xs text-gray-400">
                       <p>{t('Paid via')} {t(paymentMethod)}</p>
                       <p>{new Date().toLocaleString()}</p>
                       <p>{t('Thank you for choosing BrewMaster! ☕')}</p>
                    </div>
                 </div>

                 <div className="flex gap-4">
                    <button 
                      onClick={handlePrintReceipt} 
                      className="flex-1 py-3 border border-gray-200 rounded-xl font-medium hover:bg-gray-50 flex items-center justify-center gap-2"
                    >
                       <Printer size={18} /> {t('Print Receipt')}
                    </button>
                    <button onClick={handleClose} className="flex-1 py-3 bg-mocha-700 text-white rounded-xl font-medium hover:bg-mocha-800 shadow-lg shadow-mocha-500/20">
                       {t('Done')}
                    </button>
                 </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
