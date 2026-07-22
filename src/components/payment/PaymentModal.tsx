import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Order } from '../../types/order';
import { Customer } from '../../types/customer';
import {
  X,
  CheckCircle2,
  Printer,
  CreditCard,
  Banknote,
  User,
  Undo2,
  Lock,
  BookUser,
  Star,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../../context/LanguageContext';
import {
  getTaxRate,
  getLoyaltyConfig,
  pointsToDiscount,
  verifyAdminPin,
  hasAdminPin,
  getStoreConfig,
} from '../../utils/settingsConfig';
import { printCustomerReceipt } from '../../utils/printReceipts';
import { CustomerLookupStep, CustomerLookupResult } from './CustomerLookupStep';
import { customersService } from '../../services/customersService';
import { companiesService } from '../../services/companiesService';
import { Company } from '../../types/company';
import { PaymentMethod } from '../../types/order';
import { formatOrderNumber } from '../../utils/orderNumber';

export interface PaymentCompletePayload {
  orderId: string;
  method: 'Cash' | 'Card' | 'OnAccount';
  customerPhone?: string;
  customer?: Customer | null;
  pointsRedeemed?: number;
  customerId?: string;
  customerName?: string;
  companyId?: string;
  companyName?: string;
  billedToType?: 'customer' | 'company';
}

interface PaymentModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onPaymentComplete: (payload: PaymentCompletePayload) => void;
  onRefund?: (orderId: string, reason: string) => Promise<void>;
}

type Step = 'customer' | 'pay' | 'receipt' | 'refund';

export function PaymentModal({
  order,
  isOpen,
  onClose,
  onPaymentComplete,
  onRefund,
}: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<Step>('customer');
  const [linkedCustomer, setLinkedCustomer] = useState<Customer | null>(null);
  const [linkedCompany, setLinkedCompany] = useState<Company | null>(null);
  const [billTo, setBillTo] = useState<'customer' | 'company'>('customer');
  const [customerPhone, setCustomerPhone] = useState<string | undefined>(undefined);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [refundReason, setRefundReason] = useState('');
  const [refundPin, setRefundPin] = useState('');
  const [refundError, setRefundError] = useState('');
  const [isRefunding, setIsRefunding] = useState(false);
  const { t, language } = useLanguage();
  const paymentFiredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const store = getStoreConfig();
  const loyalty = getLoyaltyConfig();

  useEffect(() => {
    if (isOpen && order) {
      if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Refunded') {
        setPaymentMethod(
          order.paymentMethod === 'OnAccount' ? 'Cash' : (order.paymentMethod || 'Cash')
        );
        setIsProcessing(false);
        setStep('receipt');
        setCustomerPhone(order.customerPhone);
        setLinkedCustomer(null);
        setLinkedCompany(null);
        if (order.customerPhone) {
          customersService.getByPhone(order.customerPhone).then(c => {
            if (c) setLinkedCustomer(c);
          }).catch(() => {});
        }
      } else if (order.paymentStatus === 'OnAccount') {
        // Settling an account invoice — collect cash/card now
        setPaymentMethod('Cash');
        setIsProcessing(false);
        setStep('pay');
        setCustomerPhone(order.customerPhone);
        setLinkedCustomer(null);
        setLinkedCompany(null);
        setBillTo(
          order.billedToType === 'company' || !!order.companyId ? 'company' : 'customer'
        );
        setRedeemPoints(0);

        // Restore company first (company-only invoices may have no phone)
        if (order.companyId) {
          companiesService
            .getById(order.companyId)
            .then(co => {
              if (co) setLinkedCompany(co);
              else if (order.companyName) {
                setLinkedCompany({
                  id: order.companyId!,
                  name: order.companyName,
                  tags: [],
                  phone: undefined,
                  createdAt: new Date().toISOString(),
                });
              }
            })
            .catch(() => {
              if (order.companyName) {
                setLinkedCompany({
                  id: order.companyId!,
                  name: order.companyName,
                  tags: [],
                  createdAt: new Date().toISOString(),
                });
              }
            });
        }

        if (order.customerPhone) {
          customersService.getByPhone(order.customerPhone).then(async c => {
            if (c) {
              setLinkedCustomer(c);
              if (!order.companyId && c.companyId) {
                try {
                  setLinkedCompany(await companiesService.getById(c.companyId));
                } catch { /* ignore */ }
              }
            } else if (order.customerName) {
              setLinkedCustomer({
                id: order.customerId || `tmp_${order.customerPhone}`,
                name: order.customerName,
                phone: order.customerPhone!,
                points: 0,
                createdAt: new Date().toISOString(),
              });
            }
          }).catch(() => {});
        } else if (order.customerName && order.customerId) {
          setLinkedCustomer({
            id: order.customerId,
            name: order.customerName,
            phone: order.customerPhone || '',
            points: 0,
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        setPaymentMethod('Cash');
        setIsProcessing(false);
        setStep('customer');
        setCustomerPhone(order.customerPhone);
        setLinkedCustomer(null);
        setLinkedCompany(null);
        setRedeemPoints(0);
        setBillTo('customer');
        if (order.customerPhone) {
          customersService.getByPhone(order.customerPhone).then(async c => {
            if (c) {
              setLinkedCustomer(c);
              if (c.companyId) {
                try {
                  setLinkedCompany(await companiesService.getById(c.companyId));
                } catch { /* ignore */ }
              }
            }
          }).catch(() => {});
        }
      }
      paymentFiredRef.current = false;
      setRefundReason('');
      setRefundPin('');
      setRefundError('');
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOpen, order?.id]);

  if (!isOpen || !order) return null;

  const subtotal = order.totalAmount;
  const taxRate = typeof order.taxRate === 'number' ? order.taxRate : getTaxRate();
  const tax = typeof order.taxAmount === 'number' ? order.taxAmount : subtotal * taxRate;
  const total =
    typeof order.grandTotal === 'number' && order.grandTotal > 0
      ? order.grandTotal
      : Math.max(0, subtotal + tax);

  const handleCustomerResolved = async (result: CustomerLookupResult) => {
    if (result.skipped) {
      if (paymentMethod === 'OnAccount') {
        alert(
          language === 'ar'
            ? 'الفاتورة على الحساب تتطلب عميل أو شركة'
            : 'Charging to account requires a customer or company'
        );
        return;
      }
      setLinkedCustomer(null);
      setLinkedCompany(null);
      setCustomerPhone(undefined);
      setRedeemPoints(0);
      setStep('pay');
      return;
    }

    // Company selected directly by name
    if (result.company && !result.customer) {
      setLinkedCompany(result.company);
      setLinkedCustomer(null);
      setCustomerPhone(undefined);
      setBillTo('company');
      setRedeemPoints(0);
      setStep('pay');
      return;
    }

    setLinkedCustomer(result.customer);
    setCustomerPhone(result.customer?.phone);
    setRedeemPoints(0);

    let company: Company | null = result.company || null;
    if (!company && result.customer?.companyId) {
      try {
        company = await companiesService.getById(result.customer.companyId);
        if (!company) {
          const all = await companiesService.getAll();
          company =
            all.find(c => c.id === result.customer!.companyId) ||
            all.find(c => c.name.trim() === String(result.customer!.companyId).trim()) ||
            null;
        }
      } catch {
        company = null;
      }
    }
    setLinkedCompany(company);
    setStep('pay');
  };

  const handleProcessPayment = () => {
    if (paymentMethod === 'OnAccount') {
      if (billTo === 'company' && !linkedCompany) {
        alert(
          language === 'ar'
            ? 'اختر شركة (ابحث باسم الشركة أو بعميل تابع لها)'
            : 'Select a company (search by name or affiliated customer)'
        );
        setStep('customer');
        return;
      }
      if (billTo === 'customer' && !linkedCustomer) {
        alert(
          language === 'ar'
            ? 'اختر عميل مسجّل قبل التسجيل على الحساب الشخصي'
            : 'Select a registered customer for personal account'
        );
        setStep('customer');
        return;
      }
    }

    setIsProcessing(true);
    timerRef.current = setTimeout(() => {
      const orderId = order.id;
      const method = paymentMethod;
      const useCompany = method === 'OnAccount' && billTo === 'company' && !!linkedCompany;
      if (!paymentFiredRef.current) {
        paymentFiredRef.current = true;
        onPaymentComplete({
          orderId,
          method,
          customerPhone: customerPhone || linkedCustomer?.phone || undefined,
          customer: linkedCustomer,
          pointsRedeemed: undefined,
          customerId: linkedCustomer?.id,
          customerName: linkedCustomer?.name,
          companyId: useCompany ? linkedCompany?.id : undefined,
          companyName: useCompany ? linkedCompany?.name : undefined,
          billedToType:
            method === 'OnAccount' ? (useCompany ? 'company' : 'customer') : undefined,
        });
      }
      setIsProcessing(false);
      setStep('receipt');
    }, 100);
  };

  const handleClose = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsProcessing(false);
    setStep('customer');
    onClose();
  };

  const handlePrintReceipt = () => {
    printCustomerReceipt(
      {
        ...order,
        customerPhone: customerPhone || order.customerPhone,
        paymentStatus: order.paymentStatus === 'Unpaid' ? 'Paid' : order.paymentStatus,
        paymentMethod,
        grandTotal: total,
        taxRate,
        taxAmount: tax,
        pointsRedeemed: order.pointsRedeemed,
      },
      language
    );
  };

  const handleRefundSubmit = async () => {
    setRefundError('');
    if (!onRefund) return;
    if (hasAdminPin() && !verifyAdminPin(refundPin)) {
      setRefundError(language === 'ar' ? 'رمز PIN غير صحيح' : 'Invalid PIN');
      return;
    }
    if (!refundReason.trim()) {
      setRefundError(language === 'ar' ? 'أدخل سبب الاسترجاع' : 'Enter refund reason');
      return;
    }
    setIsRefunding(true);
    try {
      await onRefund(order.id, refundReason.trim());
      setStep('receipt');
      onClose();
    } catch {
      setRefundError(language === 'ar' ? 'فشل الاسترجاع' : 'Refund failed');
    } finally {
      setIsRefunding(false);
    }
  };

  const showReceipt = step === 'receipt';
  const isPaidView = order.paymentStatus === 'Paid' || order.paymentStatus === 'Refunded';

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
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              {step === 'refund' ? (
                <>
                  <Undo2 className="text-red-600" size={20} />
                  {language === 'ar' ? 'استرجاع / إلغاء مالي' : 'Refund / Void'}
                </>
              ) : step === 'customer' ? (
                <>
                  <User className="text-mocha-700" size={20} />
                  {language === 'ar' ? 'بيانات العميل' : 'Customer'}
                </>
              ) : showReceipt ? (
                <>
                  <CheckCircle2 className="text-green-600" size={20} />
                  {order.paymentStatus === 'Refunded'
                    ? language === 'ar'
                      ? 'تم الاسترجاع'
                      : 'Refunded'
                    : t('Payment Successful')}
                </>
              ) : (
                <>
                  <CreditCard className="text-mocha-700" size={20} />
                  {t('Process Payment')}
                </>
              )}
            </h2>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500"
            >
              <X size={20} />
            </button>
          </div>

          {!isPaidView && step !== 'refund' && (
            <div className="px-6 pt-3 flex items-center gap-2">
              <StepDot active={step === 'customer'} done={step !== 'customer'} label={language === 'ar' ? 'عميل' : 'Customer'} />
              <div className="flex-1 h-0.5 bg-gray-100 rounded" />
              <StepDot active={step === 'pay'} done={step === 'receipt'} label={language === 'ar' ? 'دفع' : 'Pay'} />
              <div className="flex-1 h-0.5 bg-gray-100 rounded" />
              <StepDot active={step === 'receipt'} done={false} label={language === 'ar' ? 'إيصال' : 'Receipt'} />
            </div>
          )}

          <div className="p-6 overflow-y-auto flex-1">
            {step === 'refund' ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  {language === 'ar'
                    ? 'سيتم استرجاع المبلغ من الإيراد واستعادة المخزون وإلغاء الطلب.'
                    : 'This will reverse revenue, restore stock, and cancel the order.'}
                </p>
                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">
                    {language === 'ar' ? 'سبب الاسترجاع' : 'Reason'}
                  </label>
                  <textarea
                    value={refundReason}
                    onChange={e => setRefundReason(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-red-400 outline-none"
                    placeholder={language === 'ar' ? 'مثال: خطأ كاشير / طلب خاطئ' : 'e.g. cashier error / wrong order'}
                  />
                </div>
                {hasAdminPin() && (
                  <div>
                    <label className="text-xs font-bold text-gray-500 block mb-1 flex items-center gap-1">
                      <Lock size={12} /> {language === 'ar' ? 'PIN المدير' : 'Manager PIN'}
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      value={refundPin}
                      onChange={e => setRefundPin(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl p-3 text-sm tracking-widest focus:ring-2 focus:ring-red-400 outline-none"
                      placeholder="••••"
                    />
                  </div>
                )}
                {refundError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{refundError}</p>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep('receipt')}
                    className="flex-1 py-3 border border-gray-200 rounded-xl font-medium"
                  >
                    {language === 'ar' ? 'رجوع' : 'Back'}
                  </button>
                  <button
                    type="button"
                    disabled={isRefunding}
                    onClick={handleRefundSubmit}
                    className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 disabled:opacity-60"
                  >
                    {isRefunding
                      ? language === 'ar'
                        ? 'جارٍ...'
                        : 'Working...'
                      : language === 'ar'
                        ? 'تأكيد الاسترجاع'
                        : 'Confirm Refund'}
                  </button>
                </div>
              </div>
            ) : step === 'customer' ? (
              <CustomerLookupStep
                initialPhone={order.customerPhone || ''}
                onResolved={handleCustomerResolved}
                onCancel={handleClose}
                compact
                accountMode={
                  paymentMethod === 'OnAccount'
                    ? billTo === 'company'
                      ? 'company'
                      : 'customer'
                    : 'any'
                }
              />
            ) : !showReceipt ? (
              <div className="space-y-6">
                {(linkedCustomer || customerPhone) && (
                  <div className="flex items-center justify-between gap-2 bg-mocha-50 border border-mocha-100 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <User size={16} className="text-mocha-700 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">
                          {linkedCustomer?.name || (language === 'ar' ? 'عميل' : 'Customer')}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {customerPhone}
                          {loyalty.enabled && linkedCustomer && (
                            <span className="ms-2 text-amber-700 font-bold">
                              · {linkedCustomer.points || 0}{' '}
                              {language === 'ar' ? 'نقطة' : 'pts'}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep('customer')}
                      className="text-[11px] font-bold text-mocha-700 hover:underline shrink-0"
                    >
                      {language === 'ar' ? 'تغيير' : 'Change'}
                    </button>
                  </div>
                )}

                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-500">{t('Table')}</span>
                    <span className="font-bold text-gray-900">{t(order.tableId)}</span>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-500">{t('Order ID')}</span>
                    <span className="font-mono text-xs bg-gray-200 px-2 py-1 rounded">
                      {formatOrderNumber(order)}
                    </span>
                  </div>

                  <div className="mt-3 bg-white border border-gray-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                    <p className="text-xs font-bold text-gray-500 mb-2 border-b border-gray-100 pb-1">
                      {t('Items')}
                    </p>
                    <div className="space-y-2">
                      {order.items.map((item, idx) => (
                        <div key={item.id || idx} className="flex justify-between text-xs text-gray-700">
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-400 font-mono">x{item.quantity}</span>
                            <span className="font-medium">{t(item.name)}</span>
                          </div>
                          <span className="font-mono">
                            {(item.price * item.quantity).toFixed(2)}{' '}
                            {language === 'ar' ? 'ج.م' : 'EGP'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-gray-200 my-3" />
                  <div className="space-y-1.5 text-xs text-gray-500">
                    <div className="flex justify-between">
                      <span>{t('Subtotal')}</span>
                      <span className="font-mono">
                        {subtotal.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>
                        {language === 'ar'
                          ? `الضريبة (${taxRate * 100}%)`
                          : `Tax (${taxRate * 100}%)`}
                      </span>
                      <span className="font-mono">
                        {tax.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}
                      </span>
                    </div>
                  </div>
                  <div className="border-t border-gray-200 my-3" />
                  <div className="flex justify-between items-center text-lg font-bold">
                    <span>{t('Total to Pay')}</span>
                    <span className="text-mocha-700">
                      {total.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    {t('Select Payment Method')}
                  </label>
                  <div className={clsx(
                    'grid gap-3',
                    order.paymentStatus === 'OnAccount' ? 'grid-cols-2' : 'grid-cols-3'
                  )}>
                    <button
                      onClick={() => setPaymentMethod('Cash')}
                      className={clsx(
                        'flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all',
                        paymentMethod === 'Cash'
                          ? 'border-mocha-700 bg-mocha-100 text-mocha-800'
                          : 'border-gray-100 hover:border-gray-200 text-gray-600'
                      )}
                    >
                      <Banknote size={22} />
                      <span className="font-medium text-sm">{t('Cash')}</span>
                    </button>
                    <button
                      onClick={() => setPaymentMethod('Card')}
                      className={clsx(
                        'flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all',
                        paymentMethod === 'Card'
                          ? 'border-mocha-700 bg-mocha-100 text-mocha-800'
                          : 'border-gray-100 hover:border-gray-200 text-gray-600'
                      )}
                    >
                      <CreditCard size={22} />
                      <span className="font-medium text-sm">{t('Card')}</span>
                    </button>
                    {order.paymentStatus !== 'OnAccount' && (
                      <button
                        onClick={() => setPaymentMethod('OnAccount')}
                        className={clsx(
                          'flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all',
                          paymentMethod === 'OnAccount'
                            ? 'border-mocha-700 bg-mocha-100 text-mocha-800'
                            : 'border-gray-100 hover:border-gray-200 text-gray-600'
                        )}
                      >
                        <BookUser size={22} />
                        <span className="font-medium text-sm">
                          {language === 'ar' ? 'حساب' : 'Account'}
                        </span>
                      </button>
                    )}
                  </div>
                  {paymentMethod === 'OnAccount' && order.paymentStatus !== 'OnAccount' && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setBillTo('customer')}
                        className={clsx(
                          'py-2 rounded-xl text-xs font-bold border',
                          billTo === 'customer'
                            ? 'bg-mocha-50 border-mocha-300 text-mocha-800'
                            : 'bg-white border-gray-200 text-gray-500'
                        )}
                      >
                        {language === 'ar' ? 'حساب عميل' : 'Customer account'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setBillTo('company')}
                        className={clsx(
                          'py-2 rounded-xl text-xs font-bold border',
                          billTo === 'company'
                            ? 'bg-purple-50 border-purple-300 text-purple-800'
                            : 'bg-white border-gray-200 text-gray-500'
                        )}
                      >
                        {language === 'ar' ? 'حساب شركة' : 'Company account'}
                      </button>
                      {billTo === 'company' && linkedCompany && (
                        <p className="col-span-2 text-[11px] text-purple-700 font-semibold">
                          {language === 'ar' ? 'الشركة:' : 'Company:'} {linkedCompany.name}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleProcessPayment}
                  disabled={isProcessing}
                  className="w-full bg-mocha-700 text-white py-4 rounded-xl font-bold text-lg hover:bg-mocha-800 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isProcessing
                    ? t('Processing...')
                    : paymentMethod === 'OnAccount'
                      ? (language === 'ar'
                          ? `تسجيل على الحساب ${total.toFixed(2)} ج.م`
                          : `Charge account ${total.toFixed(2)} EGP`)
                      : `${t('Pay')} ${total.toFixed(2)} ${language === 'ar' ? 'ج.م' : 'EGP'}`}
                </button>
              </div>
            ) : (
              <div className="text-center space-y-6">
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${
                    order.paymentStatus === 'Refunded'
                      ? 'bg-red-100 text-red-600'
                      : 'bg-green-100 text-green-600'
                  }`}
                >
                  {order.paymentStatus === 'Refunded' ? (
                    <Undo2 size={32} />
                  ) : (
                    <CheckCircle2 size={32} />
                  )}
                </div>

                <div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-1">
                    {order.paymentStatus === 'Refunded'
                      ? language === 'ar'
                        ? 'تم الاسترجاع'
                        : 'Refunded'
                      : t('Payment Received!')}
                  </h3>
                  <p className="text-gray-500">
                    {order.paymentStatus === 'Refunded'
                      ? order.refundReason || ''
                      : t('Transaction completed successfully.')}
                  </p>
                </div>

                <div className="bg-gray-50 p-6 rounded-xl border border-gray-100 text-left font-mono text-sm shadow-inner text-gray-900">
                  <div className="text-center border-b border-gray-200 pb-4 mb-4">
                    <p className="font-bold text-lg">{store.storeName || t('BREWMASTER')}</p>
                    {store.address && (
                      <p className="text-xs text-gray-400">{store.address}</p>
                    )}
                    {store.phone && (
                      <p className="text-xs text-gray-400">{store.phone}</p>
                    )}
                  </div>
                  <div className="flex justify-between font-bold text-base">
                    <span>{t('TOTAL')}</span>
                    <span>
                      {total.toFixed(2)} {language === 'ar' ? 'ج.م' : 'EGP'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex gap-3">
                    <button
                      onClick={handlePrintReceipt}
                      className="flex-1 py-3 border border-gray-200 rounded-xl font-medium hover:bg-gray-50 flex items-center justify-center gap-2"
                    >
                      <Printer size={18} /> {t('Print Receipt')}
                    </button>
                    <button
                      onClick={handleClose}
                      className="flex-1 py-3 bg-mocha-700 text-white rounded-xl font-medium hover:bg-mocha-800"
                    >
                      {t('Done')}
                    </button>
                  </div>
                  {order.paymentStatus === 'Paid' && onRefund && (
                    <button
                      type="button"
                      onClick={() => setStep('refund')}
                      className="w-full py-3 border border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-50 flex items-center justify-center gap-2"
                    >
                      <Undo2 size={18} />
                      {language === 'ar' ? 'استرجاع / إلغاء مالي' : 'Refund / Void'}
                    </button>
                  )}
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

function StepDot({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[3.5rem]">
      <div
        className={clsx(
          'w-2.5 h-2.5 rounded-full',
          active ? 'bg-mocha-700' : done ? 'bg-green-500' : 'bg-gray-200'
        )}
      />
      <span className={clsx('text-[9px] font-bold', active ? 'text-mocha-800' : 'text-gray-400')}>
        {label}
      </span>
    </div>
  );
}
