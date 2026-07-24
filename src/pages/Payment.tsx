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
  SlidersHorizontal,
  ChevronDown,
  Check,
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

export type SearchFieldType = 'all' | 'invoice' | 'phone' | 'customer' | 'table' | 'item' | 'amount';

export const SEARCH_FIELDS: {
  id: SearchFieldType;
  icon: string;
  labelAr: string;
  labelEn: string;
  placeholderAr: string;
  placeholderEn: string;
}[] = [
  { id: 'all', icon: '', labelAr: 'الكل (بحث شامل)', labelEn: 'All Fields', placeholderAr: 'بحث شامل بجميع البيانات (فاتورة / هاتف / عميل / صنف)...', placeholderEn: 'Search all fields (invoice / phone / customer / item)...' },
  { id: 'invoice', icon: '📄', labelAr: 'رقم الفاتورة #', labelEn: 'Invoice #', placeholderAr: 'ابحث برقم الفاتورة (مثال: 12 أو #12)...', placeholderEn: 'Search invoice # (e.g. 12 or #12)...' },
  { id: 'phone', icon: '📞', labelAr: 'رقم الهاتف', labelEn: 'Phone Number', placeholderAr: 'ابحث برقم هاتف العميل...', placeholderEn: 'Search customer phone number...' },
  { id: 'customer', icon: '👤', labelAr: 'اسم العميل / الشركة', labelEn: 'Customer / Company Name', placeholderAr: 'ابحث باسم العميل أو الشركة...', placeholderEn: 'Search customer or company name...' },
  { id: 'table', icon: '🪑', labelAr: 'رقم الطاولة', labelEn: 'Table Number', placeholderAr: 'ابحث برقم أو اسم الطاولة (مثال: 1 أو VIP)...', placeholderEn: 'Search table # or name...' },
  { id: 'item', icon: '☕', labelAr: 'اسم الصنف', labelEn: 'Item Name', placeholderAr: 'ابحث باسم الصنف في الفاتورة (مثال: لاتيه)...', placeholderEn: 'Search item name in invoice...' },
  { id: 'amount', icon: '💵', labelAr: 'المبلغ / القيمة', labelEn: 'Amount / Price', placeholderAr: 'ابحث بمبلغ الفاتورة (مثال: 120)...', placeholderEn: 'Search invoice total amount...' },
];

function orderMatchesSearch(
  o: Order,
  term: string,
  searchField: SearchFieldType = 'all',
  customerMap?: Map<string, Customer>,
  companyMap?: Map<string, Company>
): boolean {
  const qRaw = term.trim();
  if (!qRaw) return true;

  const qLower = qRaw.toLowerCase();
  const qClean = qRaw.replace(/[\s\-()#]/g, '').toLowerCase();
  const digitsOnly = qRaw.replace(/\D/g, '');

  // 1. Order Number
  if (searchField === 'all' || searchField === 'invoice') {
    const orderNumStr = String(o.orderNumber || '');
    const formattedNum = formatOrderNumber(o).toLowerCase();
    const formattedClean = formattedNum.replace('#', '');

    const isMatch =
      orderNumStr.toLowerCase().includes(qLower) ||
      formattedNum.includes(qLower) ||
      formattedClean.includes(qLower) ||
      (qClean && orderNumStr.toLowerCase().includes(qClean)) ||
      (digitsOnly && (orderNumStr === digitsOnly || formattedClean === digitsOnly));

    if (isMatch) {
      if (searchField === 'invoice' || searchField === 'all') return true;
    } else if (searchField === 'invoice') {
      return false;
    }
  }

  // 2. Table ID
  if (searchField === 'all' || searchField === 'table') {
    const tableIdStr = String(o.tableId || '').toLowerCase();
    const cleanTable = tableIdStr
      .replace(/^table\s*/i, '')
      .replace(/^طاولة\s*/i, '')
      .trim();

    const isMatch =
      tableIdStr.includes(qLower) ||
      (digitsOnly && cleanTable === digitsOnly) ||
      (qClean && tableIdStr.replace(/[\s\-()]/g, '').includes(qClean));

    if (isMatch) {
      if (searchField === 'table' || searchField === 'all') return true;
    } else if (searchField === 'table') {
      return false;
    }
  }

  // 3. Phone Number
  if (searchField === 'all' || searchField === 'phone') {
    const phone = (o.customerPhone || '').replace(/[\s\-()]/g, '');
    let matchedPhone = false;
    if (phone && (phone.includes(qClean) || (digitsOnly && phone.includes(digitsOnly)))) {
      matchedPhone = true;
    }
    if (!matchedPhone && o.customerId && customerMap) {
      const c = customerMap.get(o.customerId) || customerMap.get(`id:${o.customerId}`);
      if (c && (c.phone || '').replace(/[\s\-()]/g, '').includes(qClean)) {
        matchedPhone = true;
      }
    }
    if (matchedPhone) {
      if (searchField === 'phone' || searchField === 'all') return true;
    } else if (searchField === 'phone') {
      return false;
    }
  }

  // 4. Customer / Company Name
  if (searchField === 'all' || searchField === 'customer') {
    const custName = (o.customerName || '').toLowerCase();
    const compName = (o.companyName || '').toLowerCase();
    let matchedName = custName.includes(qLower) || compName.includes(qLower);

    if (!matchedName && o.customerId && customerMap) {
      const c = customerMap.get(o.customerId) || customerMap.get(`id:${o.customerId}`);
      if (c && (c.name || '').toLowerCase().includes(qLower)) matchedName = true;
    }
    if (!matchedName && o.companyId && companyMap) {
      const co = companyMap.get(o.companyId);
      if (co && (co.name || '').toLowerCase().includes(qLower)) matchedName = true;
    }

    if (matchedName) {
      if (searchField === 'customer' || searchField === 'all') return true;
    } else if (searchField === 'customer') {
      return false;
    }
  }

  // 5. Order Items
  if (searchField === 'all' || searchField === 'item') {
    let itemMatch = false;
    if (o.items && Array.isArray(o.items)) {
      itemMatch = o.items.some(item => {
        const iName = (item.name || '').toLowerCase();
        const iCat = (item.category || '').toLowerCase();
        return iName.includes(qLower) || iCat.includes(qLower);
      });
    }
    if (itemMatch) {
      if (searchField === 'item' || searchField === 'all') return true;
    } else if (searchField === 'item') {
      return false;
    }
  }

  // 6. Total Price / Amount
  if (searchField === 'all' || searchField === 'amount') {
    const total = o.grandTotal != null ? o.grandTotal : o.totalAmount || 0;
    const totalStr = total.toFixed(2);
    const totalRoundedStr = Math.round(total).toString();

    const isMatch = totalStr.includes(qLower) || (digitsOnly && totalRoundedStr === digitsOnly);

    if (isMatch) {
      if (searchField === 'amount' || searchField === 'all') return true;
    } else if (searchField === 'amount') {
      return false;
    }
  }

  return false;
}

function holderMatchesSearch(
  h: AccountHolder,
  term: string,
  searchField: SearchFieldType = 'all',
  customerMap?: Map<string, Customer>,
  companyMap?: Map<string, Company>
): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const qDigits = normalize(term);
  if (searchField === 'all' || searchField === 'customer') {
    if (h.name.toLowerCase().includes(q)) return true;
  }
  if (searchField === 'all' || searchField === 'phone') {
    if (h.phone && normalize(h.phone).includes(qDigits)) return true;
  }
  if (h.orders.some(o => orderMatchesSearch(o, term, searchField, customerMap, companyMap))) return true;
  return false;
}

export default function Payment() {
  const toast = useToast();
  const { t, isRtl, language } = useLanguage();
  const { orders: allOrders, error, completeWithPayment, updateOrder, refundOrder } = useOrders();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState<string>('');
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
    if (o.billedToType === 'customer') return undefined;
    if (o.companyId) return o.companyId;
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

  const [searchField, setSearchField] = useState<SearchFieldType>('all');
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const filterDropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setIsFilterDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredHolders = useMemo(() => {
    if (!searchTerm.trim()) return accountHolders;
    return accountHolders.filter(h => holderMatchesSearch(h, searchTerm, searchField, customerByPhone, companyById));
  }, [accountHolders, searchTerm, searchField, customerByPhone, companyById]);

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
          : orderMatchesSearch(o, searchTerm, searchField, customerByPhone, companyById);

      const orderDate = new Date(o.paidAt || o.createdAt).toLocaleDateString('en-CA');
      
      let matchesDate = true;
      if (activeTab === 'paid') {
        matchesDate = orderDate === (filterDate || new Date().toLocaleDateString('en-CA'));
      } else {
        if (filterDate) {
          matchesDate = orderDate === filterDate;
        }
      }

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
                {t("Today's Revenue")}
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
              count: pendingOrders.filter(o => !filterDate || new Date(o.paidAt || o.createdAt).toLocaleDateString('en-CA') === filterDate).length,
            },
            {
              id: 'accounts' as const,
              label: language === 'ar' ? 'على الحساب' : 'On Account',
              count: accountOrders.filter(o => !filterDate || new Date(o.paidAt || o.createdAt).toLocaleDateString('en-CA') === filterDate).length,
            },
            {
              id: 'paid' as const,
              label: t('Paid Invoices'),
              count: paidOrders.filter(o => new Date(o.paidAt || o.createdAt).toLocaleDateString('en-CA') === (filterDate || new Date().toLocaleDateString('en-CA'))).length,
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
        <div className="relative w-full flex items-center">
          <div className="relative flex-1">
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
                language === 'ar'
                  ? (SEARCH_FIELDS.find(f => f.id === searchField)?.placeholderAr || 'بحث شامل...')
                  : (SEARCH_FIELDS.find(f => f.id === searchField)?.placeholderEn || 'Search...')
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
                isRtl ? 'pr-11 pl-44 text-right' : 'pl-11 pr-44 text-left'
              )}
            />

            {/* Interactive Filter Dropdown Button */}
            <div
              ref={filterDropdownRef}
              className={clsx(
                'absolute top-1/2 -translate-y-1/2 z-20',
                isRtl ? 'left-2' : 'right-2'
              )}
            >
              <button
                type="button"
                onClick={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
                className="px-3 py-1.5 bg-mocha-50 hover:bg-mocha-100 text-mocha-900 border border-mocha-200 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-xs active:scale-95"
                title={language === 'ar' ? 'تخصيص هدف البحث' : 'Filter search target'}
              >
                <SlidersHorizontal size={14} className="text-mocha-700" />
                <span>{SEARCH_FIELDS.find(f => f.id === searchField)?.icon}</span>
                <span className="hidden sm:inline">
                  {language === 'ar'
                    ? SEARCH_FIELDS.find(f => f.id === searchField)?.labelAr
                    : SEARCH_FIELDS.find(f => f.id === searchField)?.labelEn}
                </span>
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 text-mocha-600 ${
                    isFilterDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Dropdown Options List */}
              {isFilterDropdownOpen && (
                <div
                  className={clsx(
                    'absolute top-full mt-1.5 w-60 bg-white rounded-2xl shadow-2xl border border-gray-200 py-1.5 z-50 text-gray-800 font-sans',
                    isRtl ? 'left-0' : 'right-0'
                  )}
                >
                  <div className="px-3.5 py-1.5 text-[10px] font-extrabold text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    {language === 'ar' ? 'البحث بواسطة:' : 'Filter Search By:'}
                  </div>
                  {SEARCH_FIELDS.map(field => (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => {
                        setSearchField(field.id);
                        setIsFilterDropdownOpen(false);
                      }}
                      className={clsx(
                        'w-full px-3.5 py-2.5 text-xs font-bold flex items-center justify-between transition-colors',
                        searchField === field.id
                          ? 'bg-mocha-600 text-white font-black'
                          : 'text-gray-700 hover:bg-mocha-50 hover:text-mocha-900'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {field.icon ? <span className="text-sm">{field.icon}</span> : null}
                        <span>{language === 'ar' ? field.labelAr : field.labelEn}</span>
                      </div>
                      {searchField === field.id && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {activeTab === 'paid' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={filterDate || new Date().toLocaleDateString('en-CA')}
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
                {language === 'ar' ? 'إعادة ضبط' : 'Reset'}
              </button>
            )}
          </div>
        )}
        {activeTab !== 'paid' && (searchTerm || selectedHolderKey) && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setSelectedHolderKey(null);
            }}
            className="py-2.5 px-3 text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 rounded-xl border border-red-200"
          >
            {language === 'ar' ? 'إعادة ضبط' : 'Reset'}
          </button>
        )}
      </div>

      {/* ── Accounts tab: balance lookup + split layout ── */}
      {activeTab === 'accounts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Right Column: Debtors / Account Holders Selection Panel */}
          <div className="lg:col-span-4 bg-slate-50/80 p-4 rounded-3xl border border-slate-200/80 shadow-xs space-y-3">
            {/* Panel Header */}
            <div className="bg-slate-900 text-white p-3.5 rounded-2xl shadow-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
                  <User size={16} />
                </div>
                <div>
                  <h2 className="text-xs font-black tracking-wide">
                    {language === 'ar' ? 'الحسابات والمدينون' : 'Account Debtors'}
                  </h2>
                  <p className="text-[10px] text-slate-400 font-semibold">
                    {language === 'ar' ? 'اختر حساباً لعرض فواتيره' : 'Click to focus account'}
                  </p>

                </div>
              </div>

              {(searchTerm.trim() || focusedHolder) && (
                <span className="text-[11px] font-black text-rose-300 bg-rose-500/20 border border-rose-500/30 px-2.5 py-1 rounded-xl">
                  {(focusedHolder ? focusedHolder.balance : searchTotalBalance).toFixed(2)}{' '}
                  <span className="text-[9px] font-bold">{currency}</span>
                </span>
              )}
            </div>

            {/* Debtors List */}
            {filteredHolders.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400 text-xs font-bold">
                {searchTerm.trim()
                  ? language === 'ar'
                    ? 'لا يوجد حساب مطابق للبحث'
                    : 'No matching account'
                  : language === 'ar'
                    ? 'لا توجد مبالغ مستحقة'
                    : 'No open receivables'}
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[62vh] overflow-y-auto pr-0.5">
                {filteredHolders.map(h => {
                  const active = focusedHolder?.key === h.key;
                  return (
                    <div
                      key={h.key}
                      className={clsx(
                        'p-3.5 rounded-2xl border transition-all shadow-2xs cursor-pointer',
                        active
                          ? h.type === 'company'
                            ? 'bg-purple-100/80 border-purple-400 ring-2 ring-purple-400/50 shadow-sm'
                            : 'bg-amber-100/80 border-amber-400 ring-2 ring-amber-400/50 shadow-sm'
                          : 'bg-white border-slate-200/90 hover:border-slate-300 hover:shadow-xs'
                      )}
                    >
                      {/* Clickable Area */}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedHolderKey(prev => (prev === h.key ? null : h.key))
                        }
                        className="w-full text-right"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={clsx(
                                'w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 shadow-2xs',
                                h.type === 'company'
                                  ? 'bg-purple-700 text-white'
                                  : 'bg-mocha-700 text-white'
                              )}
                            >
                              {h.type === 'company' ? (
                                <Building2 size={16} />
                              ) : (
                                <User size={16} />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-extrabold text-slate-900 truncate text-xs">
                                {h.name}
                              </p>
                              {h.phone && (
                                <p className="text-[10px] font-mono font-bold text-slate-500 mt-0.5" dir="ltr">
                                  {h.phone}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="inline-flex items-center gap-1 text-xs font-black bg-rose-50 text-rose-700 border border-rose-200/90 px-2.5 py-1 rounded-xl shadow-2xs">
                              <span>{h.balance.toFixed(2)}</span>
                              <span className="text-[9px] font-bold">{currency}</span>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-200/60 text-[10px] font-bold text-slate-400">
                          <span>
                            {h.type === 'company'
                              ? language === 'ar' ? 'شركة' : 'Company'
                              : language === 'ar' ? 'عميل' : 'Customer'}
                          </span>
                          <span>
                            {h.invoiceCount} {language === 'ar' ? 'فاتورة مفتوحة' : 'open invoices'}
                          </span>
                        </div>
                      </button>

                      {/* Company: print statement button */}
                      {h.type === 'company' && h.orders.length > 0 && (
                        <div className="mt-2.5 pt-2 border-t border-purple-200/70">
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
                            className="w-full text-[10px] font-bold bg-purple-200/60 hover:bg-purple-200 text-purple-950 px-2.5 py-1.5 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Printer size={12} />
                            {language === 'ar'
                              ? `طباعة كشف «${h.name}» (${h.orders.length} فاتورة)`
                              : `Print statement (${h.orders.length} invoices)`}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Left Column: Invoices Details & Settlement Panel */}
          <div className="lg:col-span-8 bg-white p-4 sm:p-5 rounded-3xl border border-gray-200 shadow-xs space-y-4">
            {/* Header Banner */}
            <div className="bg-gradient-to-l from-mocha-800 to-coffee-dark text-white p-3.5 sm:p-4 rounded-2xl shadow-md flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/10 text-caramel rounded-xl backdrop-blur-xs">
                  <CreditCard size={20} />
                </div>
                <div>
                  <h2 className="text-sm font-extrabold text-white tracking-tight">
                    {focusedHolder
                      ? language === 'ar'
                        ? `فواتير الحساب: ${focusedHolder.name}`
                        : `Invoices: ${focusedHolder.name}`
                      : language === 'ar'
                        ? 'عرض كافة فواتير الحساب والآجل'
                        : 'All Account Invoices'}
                  </h2>
                  <p className="text-[11px] text-white/70 font-medium mt-0.5">
                    {focusedHolder
                      ? language === 'ar'
                        ? `تم تصفية الفواتير المفتوحة الخاصة بـ (${focusedHolder.name})`
                        : `Showing open invoices for ${focusedHolder.name}`
                      : language === 'ar'
                        ? 'انقر على أي عميل يميناً للتصفية، أو اضغط تحصيل لسداد الفاتورة'
                        : 'Click any debtor on the right to filter invoices'}
                  </p>
                </div>
              </div>

              {focusedHolder && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black bg-rose-500/30 text-rose-100 border border-rose-400/40 px-3 py-1.5 rounded-xl">
                    {language === 'ar' ? 'إجمالي المطلوب:' : 'Due:'} {focusedHolder.balance.toFixed(2)} {currency}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedHolderKey(null)}
                    className="text-xs font-bold bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-xl transition-colors"
                  >
                    {language === 'ar' ? 'إظهار الكل ✕' : 'Show All ✕'}
                  </button>
                </div>
              )}
            </div>

            {/* Invoices Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredOrders.length > 0 ? (
                filteredOrders.map(renderOrderCard)
              ) : (
                <div className="col-span-full text-center py-20 text-gray-400 bg-gray-50/60 rounded-2xl border border-dashed border-gray-200">
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
