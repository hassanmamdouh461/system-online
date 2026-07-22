import React, { useState, useMemo, useEffect } from 'react';
import { Order, getOrderGrandTotal } from '../types/order';
import { PaymentModal, PaymentCompletePayload } from '../components/payment/PaymentModal';
import {
  CreditCard,
  DollarSign,
  Search,
  Calculator,
  User,
  Building2,
  Wallet,
  Printer,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useOrders } from '../hooks/useOrders';
import { useLanguage } from '../context/LanguageContext';
import {
  getTaxRate,
} from '../utils/settingsConfig';
import { customersService } from '../services/customersService';
import { companiesService } from '../services/companiesService';
import { Customer } from '../types/customer';
import { Company } from '../types/company';
import { useToast } from '../components/ui/Toast';
import { isCompanyBilledOrder } from '../utils/accountBalance';
import { formatOrderNumber, orderSeqSortValue } from '../utils/orderNumber';
import { printCompanyStatement, printCustomerReceipt } from '../utils/printReceipts';
import { clsx } from 'clsx';

type AccountHolder = {
  key: string;
  type: 'customer' | 'company';
  name: string;
  phone?: string;
  balance: number;
  invoiceCount: number;
  orders: Order[];
};

function normalize(s: string) {
  return s.replace(/[\s\-()]/g, '').trim().toLowerCase();
}

/** Treat generic placeholders as missing so we fall through to phone / lookup. */
function realName(name?: string | null): string | undefined {
  const n = (name || '').trim();
  if (!n) return undefined;
  const lower = n.toLowerCase();
  if (lower === 'عميل' || lower === 'customer' || lower === 'شركة' || lower === 'company' || n === '—') {
    return undefined;
  }
  return n;
}

function orderMatchesSearch(o: Order, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const qDigits = normalize(term);
  const hay = [
    o.tableId,
    o.orderNumber,
    o.customerPhone,
    o.customerName,
    o.companyName,
    o.customerId,
    o.companyId,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (hay.includes(q)) return true;
  if (qDigits && (o.customerPhone || '').replace(/[\s\-()]/g, '').includes(qDigits)) return true;
  return false;
}

function holderMatchesSearch(h: AccountHolder, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const qDigits = normalize(term);
  if (h.name.toLowerCase().includes(q)) return true;
  if (h.phone && normalize(h.phone).includes(qDigits)) return true;
  if (h.orders.some(o => orderMatchesSearch(o, term))) return true;
  return false;
}

export default function Payment() {
  const toast = useToast();
  const { t, isRtl, language } = useLanguage();
  const { orders: allOrders, error, completeWithPayment, updateOrder, refundOrder } = useOrders();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterStartTime, setFilterStartTime] = useState('');
  const [filterEndTime, setFilterEndTime] = useState('');
  const [selectedHolderKey, setSelectedHolderKey] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  const [activeTab, setActiveTab] = useState<'pending' | 'accounts' | 'paid'>('pending');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      customersService.getAll().then(list => {
        if (!cancelled) setCustomers(list);
      }).catch(() => {});
      companiesService.getAll().then(list => {
        if (!cancelled) setCompanies(list);
      }).catch(() => {});
    };
    load();
    // Re-load after cloud hydrate / sync so company affiliation appears
    const t = window.setInterval(load, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const customerByPhone = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of customers) {
      const p = normalize(c.phone || '');
      if (p) m.set(p, c);
      if (c.id) m.set(`id:${c.id}`, c);
    }
    return m;
  }, [customers]);

  const companyById = useMemo(() => {
    const m = new Map<string, Company>();
    companies.forEach(c => m.set(c.id, c));
    return m;
  }, [companies]);

  const resolveCustomerName = (o: Order): string | undefined => {
    const fromOrder = realName(o.customerName);
    if (fromOrder) return fromOrder;
    if (o.customerId) {
      const byId = customerByPhone.get(`id:${o.customerId}`);
      const n = realName(byId?.name);
      if (n) return n;
    }
    if (o.customerPhone) {
      const byPhone = customerByPhone.get(normalize(o.customerPhone));
      const n = realName(byPhone?.name);
      if (n) return n;
    }
    return undefined;
  };

  const resolveCompanyName = (o: Order): string | undefined => {
    const fromOrder = realName(o.companyName);
    if (fromOrder) return fromOrder;
    if (o.companyId) {
      const co = companyById.get(o.companyId);
      const n = realName(co?.name);
      if (n) return n;
    }
    // Via affiliated customer
    if (o.customerId) {
      const c = customerByPhone.get(`id:${o.customerId}`);
      if (c?.companyId) {
        const co = companyById.get(c.companyId);
        const n = realName(co?.name);
        if (n) return n;
      }
    }
    if (o.customerPhone) {
      const c = customerByPhone.get(normalize(o.customerPhone));
      if (c?.companyId) {
        const co = companyById.get(c.companyId);
        const n = realName(co?.name);
        if (n) return n;
      }
    }
    return undefined;
  };

  const resolveCompanyId = (o: Order): string | undefined => {
    if (o.companyId) return o.companyId;
    if (o.customerId) {
      const c = customerByPhone.get(`id:${o.customerId}`);
      if (c?.companyId) return c.companyId;
    }
    if (o.customerPhone) {
      const c = customerByPhone.get(normalize(o.customerPhone));
      if (c?.companyId) return c.companyId;
    }
    return undefined;
  };

  /** Display title for an order card: name → phone → never bare «عميل» when phone exists. */
  const orderDisplayLabel = (o: Order): { name?: string; phone?: string; company?: string } => {
    const name = resolveCustomerName(o);
    const phone = o.customerPhone?.trim() || undefined;
    const company = resolveCompanyName(o);
    return { name, phone, company };
  };

  const pendingOrders = useMemo(
    () => allOrders.filter(o => o.paymentStatus === 'Unpaid' && o.status !== 'Cancelled'),
    [allOrders]
  );

  const accountOrders = useMemo(
    () => allOrders.filter(o => o.paymentStatus === 'OnAccount' && o.status !== 'Cancelled'),
    [allOrders]
  );

  const paidOrders = useMemo(
    () => allOrders.filter(o => o.paymentStatus === 'Paid' || o.paymentStatus === 'Refunded'),
    [allOrders]
  );

  const fallbackTax = getTaxRate();
  const currency = language === 'ar' ? 'ج.م' : 'EGP';

  // Group open account invoices by customer / company with balances.
  // Affiliated members' personal OnAccount debts roll under their company.
  const accountHolders = useMemo((): AccountHolder[] => {
    const map = new Map<string, AccountHolder>();

    for (const o of accountOrders) {
      const total = getOrderGrandTotal(o, fallbackTax);
      const custName = resolveCustomerName(o);
      const coId = resolveCompanyId(o);
      const coName = resolveCompanyName(o) || (coId ? companyById.get(coId)?.name : undefined);

      // Roll under company when billed to company OR customer is affiliated
      if (coId) {
        const key = `co:${coId}`;
        const resolvedCoName = coName || (language === 'ar' ? 'شركة' : 'Company');
        const existing = map.get(key);
        if (existing) {
          existing.balance += total;
          existing.invoiceCount += 1;
          existing.orders.push(o);
          if (coName && (existing.name === (language === 'ar' ? 'شركة' : 'Company') || !existing.name)) {
            existing.name = coName;
          } else if (coName) {
            existing.name = coName;
          }
        } else {
          map.set(key, {
            key,
            type: 'company',
            name: resolvedCoName,
            phone: companyById.get(coId)?.phone,
            balance: total,
            invoiceCount: 1,
            orders: [o],
          });
        }
        continue;
      }

      // Pure personal account (no company affiliation)
      const phoneKey = o.customerPhone ? normalize(o.customerPhone) : '';
      const idPart = o.customerId || phoneKey || o.id;
      const key = `cu:${idPart}`;
      const existing = map.get(key);
      // Prefer real name → phone → last-resort generic (only when nothing else)
      const displayName =
        custName ||
        o.customerPhone?.trim() ||
        (language === 'ar' ? 'عميل' : 'Customer');

      if (existing) {
        existing.balance += total;
        existing.invoiceCount += 1;
        existing.orders.push(o);
        if (!existing.phone && o.customerPhone) existing.phone = o.customerPhone;
        // Upgrade placeholder title when we later discover a real name/phone
        if (custName) {
          existing.name = custName;
        } else if (
          o.customerPhone &&
          (existing.name === 'عميل' || existing.name === 'Customer')
        ) {
          existing.name = o.customerPhone;
        }
      } else {
        map.set(key, {
          key,
          type: 'customer',
          name: displayName,
          phone: o.customerPhone,
          balance: total,
          invoiceCount: 1,
          orders: [o],
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.balance - a.balance);
  }, [accountOrders, fallbackTax, language, customerByPhone, companyById, customers]);

  const filteredHolders = useMemo(() => {
    if (!searchTerm.trim()) return accountHolders;
    return accountHolders.filter(h => holderMatchesSearch(h, searchTerm));
  }, [accountHolders, searchTerm]);

  // When a holder is selected (or single search match), focus their invoices
  const focusedHolder = useMemo(() => {
    if (selectedHolderKey) {
      return filteredHolders.find(h => h.key === selectedHolderKey) || null;
    }
    if (searchTerm.trim() && filteredHolders.length === 1) {
      return filteredHolders[0];
    }
    return null;
  }, [selectedHolderKey, filteredHolders, searchTerm]);

  const searchTotalBalance = useMemo(
    () => filteredHolders.reduce((s, h) => s + h.balance, 0),
    [filteredHolders]
  );

  const orders =
    activeTab === 'pending'
      ? pendingOrders
      : activeTab === 'accounts'
        ? accountOrders
        : paidOrders;

  const handleOpenPayment = (order: Order) => {
    setSelectedOrder(order);
    setIsPaymentModalOpen(true);
  };

  const handlePaymentComplete = async (payload: PaymentCompletePayload) => {
    try {
      const order = allOrders.find(o => o.id === payload.orderId);
      const taxRate = typeof order?.taxRate === 'number' ? order.taxRate : getTaxRate();
      const taxAmount =
        typeof order?.taxAmount === 'number'
          ? order.taxAmount
          : (order?.totalAmount || 0) * taxRate;

      const grandTotal = Math.max(0, (order?.totalAmount || 0) + taxAmount);

      await updateOrder(payload.orderId, {
        ...(payload.customerPhone ? { customerPhone: payload.customerPhone } : {}),
        ...(payload.customerId ? { customerId: payload.customerId } : {}),
        ...(payload.customerName ? { customerName: payload.customerName } : {}),
        ...(payload.companyId ? { companyId: payload.companyId } : {}),
        ...(payload.companyName ? { companyName: payload.companyName } : {}),
        ...(payload.billedToType ? { billedToType: payload.billedToType } : {}),
        taxRate,
        taxAmount,
        grandTotal,
      });
      await completeWithPayment(payload.orderId, payload.method);
    } catch (err) {
      console.error('Failed to complete payment:', err);
      alert(t('Failed to complete payment'));
    }
  };

  const handleRefund = async (orderId: string, reason: string) => {
    try {
      await refundOrder(orderId, reason);
    } catch (err) {
      console.error('Refund failed:', err);
      toast.error(language === 'ar' ? 'فشل الاسترجاع' : 'Refund failed');
      throw err;
    }
  };

  const STATUS_PRIORITY: Record<string, number> = {
    Ready: 1,
    Preparing: 2,
    New: 3,
    Completed: 4,
    Cancelled: 5,
  };

  const filteredOrders = useMemo(() => {
    let source = orders;

    // On accounts tab: if a holder is focused, only their invoices
    if (activeTab === 'accounts' && focusedHolder) {
      source = focusedHolder.orders;
    }

    const list = source.filter(o => {
      const matchesSearch =
        activeTab === 'accounts' && focusedHolder
          ? true
          : orderMatchesSearch(o, searchTerm);

      const orderDate = new Date(o.paidAt || o.createdAt).toLocaleDateString('en-CA');
      const matchesDate = !filterDate || orderDate === filterDate;

      let matchesTime = true;
      if (filterStartTime || filterEndTime) {
        const orderDateObj = new Date(o.paidAt || o.createdAt);
        const orderMinutes = orderDateObj.getHours() * 60 + orderDateObj.getMinutes();
        if (filterStartTime) {
          const [sH, sM] = filterStartTime.split(':').map(Number);
          if (orderMinutes < sH * 60 + sM) matchesTime = false;
        }
        if (filterEndTime) {
          const [eH, eM] = filterEndTime.split(':').map(Number);
          if (orderMinutes > eH * 60 + eM) matchesTime = false;
        }
      }

      return matchesSearch && matchesDate && matchesTime;
    });

    if (activeTab === 'pending') {
      return list.sort((a, b) => {
        const na = orderSeqSortValue(a);
        const nb = orderSeqSortValue(b);
        if (na !== nb) return na - nb;
        const priorityA = STATUS_PRIORITY[a.status] || 99;
        const priorityB = STATUS_PRIORITY[b.status] || 99;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    }

    // accounts + paid: ascending invoice numbers
    return list.sort((a, b) => {
      const na = orderSeqSortValue(a);
      const nb = orderSeqSortValue(b);
      if (na !== nb) return na - nb;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [
    orders,
    searchTerm,
    activeTab,
    filterDate,
    filterStartTime,
    filterEndTime,
    focusedHolder,
  ]);

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
    .filter(
      o =>
        o.paymentStatus === 'Paid' &&
        new Date(o.paidAt || o.createdAt).toDateString() === today
    )
    .reduce((sum, o) => sum + getOrderGrandTotal(o, fallbackTax), 0);

  const totalReceivables = accountHolders.reduce((s, h) => s + h.balance, 0);

  const renderOrderCard = (order: Order) => (
    <motion.div
      layout
      key={order.id}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:border-gray-300 transition-colors"
    >
      <div className="flex justify-between items-start mb-3">
        <div className="min-w-0">
          <h3 className="text-lg font-black text-gray-900">{t(order.tableId)}</h3>
          <span className="inline-block mt-1 text-xs font-black text-mocha-800 bg-mocha-50 px-2.5 py-0.5 rounded-lg border border-mocha-200">
            {language === 'ar' ? 'طلب' : 'Order'} #{formatOrderNumber(order)}
          </span>
          {(() => {
            const { name: cName, phone, company: coName } = orderDisplayLabel(order);
            const coId = resolveCompanyId(order);
            const resolvedCo =
              coName || (coId ? realName(companyById.get(coId)?.name) : undefined);
            // Resolve via customer affiliation if no direct coId
            const affCoName = !resolvedCo
              ? (() => {
                  const cid = order.customerId;
                  if (cid) {
                    const c = customerByPhone.get(`id:${cid}`);
                    if (c?.companyId) return realName(companyById.get(c.companyId)?.name);
                  }
                  return undefined;
                })()
              : undefined;
            const finalCo = resolvedCo || affCoName;
            return (
              <>
                {(cName || phone) && (
                  <p className="text-xs text-gray-700 font-bold mt-2 bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-200/80 space-y-0.5">
                    {cName && (
                      <span className="block text-gray-900 font-extrabold">{cName}</span>
                    )}
                    {!cName && phone && (
                      <span className="block text-gray-900 font-extrabold font-mono" dir="ltr">
                        {phone}
                      </span>
                    )}
                    {cName && phone && (
                      <span className="block font-mono text-mocha-900 text-[11px]" dir="ltr">
                        {phone}
                      </span>
                    )}
                  </p>
                )}
                {finalCo && (
                  <p className="text-[11px] text-purple-700 mt-1 font-bold flex items-center gap-1 bg-purple-50 px-2 py-1 rounded-lg border border-purple-100">
                    <Building2 size={11} />
                    <span>{finalCo}</span>
                    {cName && (
                      <span className="text-gray-400 font-semibold">
                        · {language === 'ar' ? 'بواسطة' : 'via'} {cName}
                      </span>
                    )}
                  </p>
                )}
              </>
            );
          })()}
        </div>
        <div
          className={clsx(
            'px-2.5 py-1 rounded-full text-xs font-bold shrink-0',
            order.paymentStatus === 'Paid' && 'bg-green-50 text-green-700 border border-green-200',
            order.paymentStatus === 'Refunded' && 'bg-red-50 text-red-600 border border-red-200',
            order.paymentStatus === 'OnAccount' &&
              (resolveCompanyId(order) || isCompanyBilledOrder(order)
                ? 'bg-purple-50 text-purple-800 border border-purple-200'
                : 'bg-amber-50 text-amber-800 border border-amber-200'),
            order.paymentStatus === 'Unpaid' && 'bg-blue-50 text-blue-700 border border-blue-100'
          )}
        >
          {order.paymentStatus === 'Paid'
            ? `${t('Paid')} (${t(order.paymentMethod || 'Cash')})`
            : order.paymentStatus === 'Refunded'
              ? language === 'ar'
                ? 'مسترجع'
                : 'Refunded'
              : order.paymentStatus === 'OnAccount'
                ? resolveCompanyId(order) || isCompanyBilledOrder(order)
                  ? language === 'ar'
                    ? 'حساب شركة'
                    : 'Company'
                  : language === 'ar'
                    ? 'حساب عميل'
                    : 'Customer'
                : t(order.status)}
        </div>
      </div>

      <div className="space-y-1.5 mb-4">
        {order.items.slice(0, 2).map((item, idx) => (
          <div key={idx} className="flex justify-between text-sm text-gray-600">
            <span>
              {item.quantity}x {t(item.name)}
            </span>
            <span>
              {(item.price * item.quantity).toFixed(2)} {currency}
            </span>
          </div>
        ))}
        {order.items.length > 2 && (
          <p className="text-xs text-gray-400 italic">
            +{order.items.length - 2} {t('more items...')}
          </p>
        )}
        <div className="border-t border-gray-100 pt-2 flex justify-between font-bold text-lg text-gray-900">
          <span>{t('Total')}</span>
          <span>
            {getOrderGrandTotal(order, fallbackTax).toFixed(2)} {currency}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => handleOpenPayment(order)}
          className={clsx(
            'flex-1 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors',
            activeTab === 'paid'
              ? 'bg-mocha-600 text-white hover:bg-mocha-700'
              : 'bg-gray-900 text-white hover:bg-black'
          )}
        >
          <CreditCard size={18} />
          {activeTab === 'accounts'
            ? language === 'ar'
              ? 'تحصيل / سداد'
              : 'Collect Payment'
            : activeTab === 'pending'
              ? t('Process Payment')
              : t('View Invoice')}
        </button>
        <button
          onClick={() => printCustomerReceipt(order, language === 'ar' ? 'ar' : 'en')}
          className="py-3 px-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors"
          title={language === 'ar' ? 'طباعة الفاتورة' : 'Print receipt'}
        >
          <Printer size={18} />
        </button>
      </div>
    </motion.div>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900">{t('Payment & Billing')}</h1>
          <p className="text-xs md:text-base text-gray-500">
            {t('Process customer payments and view daily revenue.')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="bg-white px-4 py-2.5 rounded-xl border border-mocha-100 shadow-sm flex items-center gap-2">
            <div className="p-1.5 bg-green-50 text-green-600 rounded-lg">
              <DollarSign size={18} />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 font-medium">
                {t("Today's Revenue (incl. tax)")}
              </p>
              <p className="text-base font-bold text-gray-900">
                {totalRevenue.toFixed(2)} {currency}
              </p>
            </div>
          </div>
          {totalReceivables > 0 && (
            <div className="bg-white px-4 py-2.5 rounded-xl border border-amber-100 shadow-sm flex items-center gap-2">
              <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                <Wallet size={18} />
              </div>
              <div>
                <p className="text-[10px] text-gray-500 font-medium">
                  {language === 'ar' ? 'إجمالي المبالغ المستحقة' : 'Total amounts due'}
                </p>
                <p className="text-base font-bold text-amber-800">
                  {totalReceivables.toFixed(2)} {currency}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-4 md:gap-6 overflow-x-auto">
        {(
          [
            {
              id: 'pending' as const,
              label: t('Pending Payments'),
              count: pendingOrders.length,
            },
            {
              id: 'accounts' as const,
              label: language === 'ar' ? 'على الحساب' : 'On Account',
              count: accountOrders.length,
            },
            {
              id: 'paid' as const,
              label: t('Paid Invoices'),
              count: paidOrders.length,
            },
          ] as const
        ).map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setSelectedHolderKey(null);
            }}
            className={clsx(
              'pb-3 font-semibold text-sm transition-all border-b-2 px-1 relative whitespace-nowrap',
              activeTab === tab.id
                ? 'border-mocha-700 text-mocha-800'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {tab.label} ({tab.count})
            {activeTab === tab.id && (
              <motion.div
                layoutId="activeTabUnderline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-mocha-700"
              />
            )}
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="space-y-3">
        <div className="relative w-full">
          <Search
            className={clsx(
              'absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none z-10',
              isRtl ? 'right-3.5' : 'left-3.5'
            )}
          />
          <input
            type="search"
            dir={isRtl ? 'rtl' : 'ltr'}
            placeholder={
              activeTab === 'accounts'
                ? language === 'ar'
                  ? 'ابحث باسم العميل أو الشركة أو الهاتف...'
                  : 'Search customer, company, or phone...'
                : language === 'ar'
                  ? 'ابحث برقم الطاولة أو الطلب أو الهاتف...'
                  : 'Search table, order, or phone...'
            }
            value={searchTerm}
            onChange={e => {
              setSearchTerm(e.target.value);
              setSelectedHolderKey(null);
            }}
            className={clsx(
              'w-full py-3 bg-white border border-gray-200 rounded-2xl',
              'focus:outline-none focus:ring-2 focus:ring-caramel/50 focus:border-caramel',
              'shadow-sm text-sm text-gray-900 placeholder:text-gray-400',
              isRtl ? 'pr-11 pl-4 text-right' : 'pl-11 pr-4 text-left'
            )}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className="py-2.5 px-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 shadow-sm min-w-[150px]"
          />
          {(filterDate || filterStartTime || filterEndTime || searchTerm || selectedHolderKey) && (
            <button
              type="button"
              onClick={() => {
                setFilterDate('');
                setFilterStartTime('');
                setFilterEndTime('');
                setSearchTerm('');
                setSelectedHolderKey(null);
              }}
              className="py-2.5 px-3 text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 rounded-xl border border-red-200"
            >
              {t('Clear Filter')}
            </button>
          )}
        </div>
      </div>

      {/* ── Accounts tab: balance lookup + split layout ── */}
      {activeTab === 'accounts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: holders list with balances */}
          <div className="lg:col-span-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-gray-800">
                {language === 'ar' ? 'الحسابات المدينة' : 'Account balances'}
              </h2>
              {(searchTerm.trim() || focusedHolder) && (
                <span className="text-xs font-black text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                  {language === 'ar' ? 'المطلوب:' : 'Due:'}{' '}
                  {(focusedHolder ? focusedHolder.balance : searchTotalBalance).toFixed(2)}{' '}
                  {currency}
                </span>
              )}
            </div>

            {filteredHolders.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center text-gray-400 text-sm">
                {searchTerm.trim()
                  ? language === 'ar'
                    ? 'لا يوجد حساب مطابق للبحث'
                    : 'No matching account'
                  : language === 'ar'
                    ? 'لا توجد مبالغ مستحقة'
                    : 'No open receivables'}
              </div>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {filteredHolders.map(h => {
                  const active = focusedHolder?.key === h.key;
                  return (
                    <div
                      key={h.key}
                      className={clsx(
                        'p-3.5 rounded-2xl border transition-all shadow-sm',
                        active
                          ? h.type === 'company'
                            ? 'bg-purple-50 border-purple-300 ring-2 ring-purple-200'
                            : 'bg-mocha-50 border-mocha-300 ring-2 ring-mocha-200'
                          : 'bg-white border-gray-100 hover:border-gray-300'
                      )}
                    >
                      {/* Main clickable area */}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedHolderKey(prev => (prev === h.key ? null : h.key))
                        }
                        className="w-full text-right"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={clsx(
                              'p-2 rounded-xl shrink-0',
                              h.type === 'company'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-mocha-100 text-mocha-700'
                            )}
                          >
                            {h.type === 'company' ? (
                              <Building2 size={18} />
                            ) : (
                              <User size={18} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-extrabold text-gray-900 truncate text-sm">
                                  {h.name}
                                </p>
                                {h.phone && (
                                  <p className="text-[11px] font-mono font-bold text-gray-500 mt-0.5" dir="ltr">
                                    {h.phone}
                                  </p>
                                )}
                                <p className="text-[10px] font-bold text-gray-400 mt-0.5">
                                  {h.type === 'company'
                                    ? language === 'ar'
                                      ? 'شركة'
                                      : 'Company'
                                    : language === 'ar'
                                      ? 'عميل'
                                      : 'Customer'}
                                  {' · '}
                                  {h.invoiceCount}{' '}
                                  {language === 'ar' ? 'فاتورة' : 'invoices'}
                                </p>
                              </div>
                              <div className="text-left shrink-0">
                                <p className="text-sm font-black text-red-600">
                                  {h.balance.toFixed(2)}
                                </p>
                                <p className="text-[10px] text-gray-400">{currency}</p>
                              </div>
                            </div>
                            <p className="text-[11px] text-gray-500 mt-1.5 font-semibold">
                              {language === 'ar' ? 'الإجمالي المستحق' : 'Total due'}:{' '}
                              <span className="text-red-700 font-black">{h.balance.toFixed(2)}</span>{' '}
                              {currency} · {h.invoiceCount}{' '}
                              {language === 'ar' ? 'فاتورة مفتوحة' : 'open invoices'}
                            </p>
                          </div>
                        </div>
                      </button>

                      {/* Company: print statement button */}
                      {h.type === 'company' && h.orders.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-purple-100">
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              printCompanyStatement({
                                companyName: h.name,
                                companyPhone: h.phone,
                                orders: h.orders,
                                taxRate: fallbackTax,
                                lang: language === 'ar' ? 'ar' : 'en',
                                resolveCustomerLabel: o =>
                                  resolveCustomerName(o) || o.customerPhone || '—',
                              });
                            }}
                            className="w-full text-[11px] font-bold bg-purple-100 hover:bg-purple-200 text-purple-800 px-3 py-2 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Printer size={13} />
                            {language === 'ar'
                              ? `طباعة كشف «${h.name}» (${h.orders.length} فاتورة · ${h.balance.toFixed(2)} ${currency})`
                              : `Print statement (${h.orders.length} invoices · ${h.balance.toFixed(2)} ${currency})`}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: invoices for selection / all */}
          <div className="lg:col-span-8 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-extrabold text-gray-800">
                {focusedHolder
                  ? language === 'ar'
                    ? `فواتير: ${focusedHolder.name}`
                    : `Invoices: ${focusedHolder.name}`
                  : language === 'ar'
                    ? 'كل فواتير الحساب'
                    : 'All account invoices'}
              </h2>
              {focusedHolder && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-black bg-red-50 text-red-700 border border-red-100 px-3 py-1.5 rounded-xl">
                    {language === 'ar' ? 'عليه' : 'Owes'} {focusedHolder.balance.toFixed(2)}{' '}
                    {currency}
                  </span>
                  {focusedHolder.type === 'company' && focusedHolder.orders.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        printCompanyStatement({
                          companyName: focusedHolder.name,
                          companyPhone: focusedHolder.phone,
                          orders: focusedHolder.orders,
                          taxRate: fallbackTax,
                          lang: language === 'ar' ? 'ar' : 'en',
                          resolveCustomerLabel: o =>
                            resolveCustomerName(o) || o.customerPhone || '—',
                        });
                      }}
                      className="text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-xl flex items-center gap-1.5"
                    >
                      <Printer size={14} />
                      {language === 'ar' ? 'طباعة كشف الشركة' : 'Print company statement'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedHolderKey(null)}
                    className="text-xs font-bold text-gray-500 hover:text-gray-800 underline"
                  >
                    {language === 'ar' ? 'عرض الكل' : 'Show all'}
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredOrders.length > 0 ? (
                filteredOrders.map(renderOrderCard)
              ) : (
                <div className="col-span-full text-center py-16 text-gray-400">
                  <Calculator className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">
                    {language === 'ar' ? 'لا توجد فواتير على الحساب' : 'No account invoices'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pending / Paid grids (unchanged structure) */}
      {activeTab !== 'accounts' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
          {filteredOrders.length > 0 ? (
            filteredOrders.map(renderOrderCard)
          ) : (
            <div className="col-span-full text-center py-20 text-gray-500">
              <div className="bg-gray-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Calculator className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-lg font-medium">
                {activeTab === 'pending'
                  ? t('No payable orders found')
                  : t('No paid invoices found')}
              </p>
            </div>
          )}
        </div>
      )}

      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        order={selectedOrder}
        onPaymentComplete={handlePaymentComplete}
        onRefund={handleRefund}
      />
    </div>
  );
}
