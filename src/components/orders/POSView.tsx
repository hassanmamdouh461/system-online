import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getTaxRate } from '../../utils/settingsConfig';
import {
  calcChangeDue,
  calcGrandTotal,
  calcTax,
  compareMoney,
  formatMoney,
  lineTotal,
  safeMoney,
  sumLineTotals,
} from '../../utils/money';
import { MenuItem } from '../../types/menu';
import { OrderItem, Order } from '../../types/order';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../ui/Toast';
import { Coffee, Trash2, Plus, Minus, CreditCard, DollarSign, Check, XCircle, Printer, Search, Settings, RotateCcw, X, BookUser, UserRound, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { needsStaffSelection } from '../../utils/staffAttribution';
import { printAllOrderTickets } from '../../utils/printReceipts';
import { CustomerLookupStep, CustomerLookupResult } from '../payment/CustomerLookupStep';
import { Customer } from '../../types/customer';
import { Company } from '../../types/company';
import { companiesService } from '../../services/companiesService';
import { PaymentMethod, BilledToType, PaymentStatus } from '../../types/order';
import { useCloudBackedList } from '../../hooks/useCloudBackedList';
import { describePersistOutcome } from '../../services/persistOutcomeReport';
import type { PersistOutcome } from '../../services/settingsCloudService';

/** Fallback table layout for a till that has never seen a real list. */
const DEFAULT_TABLES = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;
/** A till with no staff names yet. Module-level so its identity is stable. */
const EMPTY_STAFF_LIST: readonly string[] = [];

interface POSViewProps {
  menuItems: MenuItem[];
  onCreateOrder: (
    tableId: string,
    items: OrderItem[],
    paymentStatus: PaymentStatus,
    paymentMethod?: PaymentMethod,
    paidAmount?: number,
    customerPhone?: string,
    accountMeta?: {
      customerId?: string;
      customerName?: string;
      companyId?: string;
      companyName?: string;
      billedToType?: BilledToType;
      cashierName?: string;
    }
  ) => Promise<Order | null>;
  estimatedOrderNumber: string;
}

export function POSView({ menuItems, onCreateOrder, estimatedOrderNumber }: POSViewProps) {
  const { t, isRtl, language } = useLanguage();
  const toast = useToast();
  
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
  const [orderMode, setOrderMode] = useState<'Dine-in' | 'Takeaway'>(() => {
    return (localStorage.getItem('pos_orderMode') as 'Dine-in' | 'Takeaway') || 'Takeaway';
  });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(() => {
    const mode = localStorage.getItem('pos_orderMode');
    if (mode === 'Dine-in') return 'Cash';
    return (localStorage.getItem('pos_paymentMethod') as PaymentMethod) || 'Cash';
  });
  const [paymentStatus, setPaymentStatus] = useState<'Paid' | 'Unpaid'>(() => {
    return (localStorage.getItem('pos_paymentStatus') as 'Paid' | 'Unpaid') || 'Paid';
  });
  const [tableId, setTableId] = useState<string>(() => {
    return localStorage.getItem('pos_tableId') || '';
  });
  
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [customerPhone, setCustomerPhone] = useState<string>(() => {
    return localStorage.getItem('pos_customerPhone') || '';
  });
  const [linkedCustomer, setLinkedCustomer] = useState<Customer | null>(null);
  const [linkedCompany, setLinkedCompany] = useState<Company | null>(null);
  /** When charging OnAccount: personal customer ledger vs company ledger */
  const [billTo, setBillTo] = useState<'customer' | 'company'>('customer');

  // Dynamic Table Management State.
  //
  // Cloud-backed: seeded from the local cache, reconciled with D1 once the
  // settings hydrate lands, and uploaded ONLY on a real operator edit. Doing
  // this from a plain useEffect is what wiped the shop's real table names —
  // see hooks/useCloudBackedList.
  const { list: tables, setList: setTables } = useCloudBackedList(
    'pos_tables_list',
    DEFAULT_TABLES
  );
  const [isManageTablesOpen, setIsManageTablesOpen] = useState(false);
  const [newTableName, setNewTableName] = useState('');

  // Staff (cashier/waiter) attribution — the selected name is written on the
  // invoice so management can attribute each sale to the right person.
  // Cloud-backed like the table list: an empty staff list is only ever uploaded
  // when a human emptied it, never because this device has not hydrated yet.
  const { list: staffList, setList: setStaffList } = useCloudBackedList(
    'pos_staff_list',
    EMPTY_STAFF_LIST
  );
  const [selectedStaff, setSelectedStaff] = useState<string>(() => {
    return localStorage.getItem('pos_selected_staff') || '';
  });
  const [isStaffPickerOpen, setIsStaffPickerOpen] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  /** Pending checkout action waiting for customer phone step (skippable) */
  const [pendingCheckout, setPendingCheckout] = useState<'save' | 'print' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

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
    localStorage.setItem('pos_customerPhone', customerPhone);
  }, [customerPhone]);

  useEffect(() => {
    localStorage.setItem('pos_paymentStatus', paymentStatus);
  }, [paymentStatus]);

  useEffect(() => {
    localStorage.setItem('pos_orderMode', orderMode);
  }, [orderMode]);

  useEffect(() => {
    localStorage.setItem('pos_tableId', tableId);
  }, [tableId]);

  // NOTE: the table and staff lists are NOT mirrored/pushed from an effect here.
  // Effects run on mount, and a mount is not an edit — see useCloudBackedList.

  useEffect(() => {
    localStorage.setItem('pos_selected_staff', selectedStaff);
  }, [selectedStaff]);

  /**
   * Report a cloud-backed list edit that did not reach D1.
   *
   * Only a 'synced' outcome may be shown in green. The other three ('queued',
   * 'local_only', 'forbidden') all mean the change lives in this browser alone,
   * and a cache clear undoes it — the failure operators described as "I removed
   * the table, cleared the cache, and it came back".
   */
  const reportListOutcome = (outcome: PersistOutcome, successMessage: string) => {
    const report = describePersistOutcome(outcome, language);
    if (!report) {
      toast.success(successMessage);
      return;
    }
    if (report.tone === 'error') toast.error(report.message, report.title);
    else toast.warning(report.message, report.title);
  };

  /**
   * Add one table name and surface the push outcome. An addition that never
   * reaches D1 is less destructive than a deletion, but it is still invisible on
   * every other till and dies with the cache — so it is not reported as done.
   */
  const addTableName = async (cleanName: string) => {
    const outcome = await setTables(prev => [...prev, cleanName]);
    const report = describePersistOutcome(outcome, language);
    if (!report) return;
    if (report.tone === 'error') toast.error(report.message, report.title);
    else toast.warning(report.message, report.title);
  };

  const handleAddTable = async (tableNameToAdd?: string) => {
    const target = (tableNameToAdd || newTableName).trim();
    if (!target) return;
    const cleanName = target.replace(/^T(?=\d+$)/i, '');
    if (!tables.includes(cleanName)) {
      await addTableName(cleanName);
    }
    setTableId(cleanName);
    setNewTableName('');
  };

  /**
   * Removing a table is a DELETE against a durable, cloud-backed list, so it
   * carries the same hazard as deleting a customer: the row leaves the screen
   * and localStorage at once, but if the D1 write queued or was refused the
   * table is still alive in the cloud and returns on the next hydrate. The
   * outcome used to be discarded, so this always looked like it worked.
   */
  const handleDeleteTable = async (num: string) => {
    const outcome = await setTables(prev => prev.filter(t => t !== num));
    if (tableId === num) {
      setTableId('');
    }
    reportListOutcome(
      outcome,
      language === 'ar' ? `تم حذف ترابيزة ${num}` : `Table ${num} deleted`
    );
  };

  const handleResetTables = async () => {
    // Explicit operator action, so this one DOES upload the defaults. It is also
    // a mass REPLACEMENT of the shop's real table names, so a silent failure
    // here is as costly as a delete.
    const outcome = await setTables([...DEFAULT_TABLES]);
    reportListOutcome(
      outcome,
      language === 'ar' ? 'تمت إعادة ضبط الترابيزات' : 'Tables reset'
    );
  };



  const handleSetOrderMode = (mode: 'Dine-in' | 'Takeaway') => {
    setOrderMode(mode);
    if (mode === 'Takeaway') {
      setPaymentStatus('Paid');
    } else {
      setPaymentStatus('Unpaid');
      setPaymentMethod('Cash');
      setTableId('');
    }
  };

  // Dynamic categories from menu items: use the part before '|' (e.g. 'Hot Coffee' from 'Hot Coffee|Bar')
  const categories = useMemo(() => {
    const cats = Array.from(
      new Set(
        menuItems
          .filter(item => item.available)
          .map(item => {
            const parts = item.category ? item.category.split('|') : [];
            return parts[0] || '';
          })
          .filter(c => c)
      )
    );
    return ['All', ...cats];
  }, [menuItems]);

  // Filtered menu items
  const filteredMenuItems = useMemo(() => {
    const available = menuItems.filter(item => item.available);
    
    // Filter by category name (part before '|')
    const categoryFiltered = selectedCategory === 'All' 
      ? available 
      : available.filter(item => {
          const parts = item.category ? item.category.split('|') : [];
          const catName = parts[0] || '';
          return catName === selectedCategory;
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

  // Total invoice amount — piaster-exact sum of rounded line totals, so the
  // printed receipt lines always add up to this subtotal (see utils/money).
  const totalAmount = useMemo(() => sumLineTotals(invoiceItems), [invoiceItems]);

  const taxRate = getTaxRate();
  const taxAmount = useMemo(() => calcTax(totalAmount, taxRate), [totalAmount, taxRate]);
  const grandTotal = useMemo(
    () => calcGrandTotal(totalAmount, taxAmount),
    [totalAmount, taxAmount]
  );

  // Items count
  const itemsCount = useMemo(() => {
    return invoiceItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [invoiceItems]);

  // Change amount — exact subtraction, clamped at zero for under-payment.
  const changeAmount = useMemo(
    () => calcChangeDue(receivedAmount, grandTotal),
    [receivedAmount, grandTotal]
  );

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

  // Reset current invoice
  const handleReset = () => {
    setInvoiceItems([]);
    setReceivedAmount('0');
    setPaymentMethod('Cash');
    setPaymentStatus(orderMode === 'Takeaway' ? 'Paid' : 'Unpaid');
    setTableId('');
    setCustomerPhone('');
    setLinkedCustomer(null);
    setLinkedCompany(null);
    setBillTo('customer');
    localStorage.removeItem('pos_invoiceItems');
    localStorage.removeItem('pos_receivedAmount');
    localStorage.removeItem('pos_paymentMethod');
    localStorage.removeItem('pos_paymentStatus');
    localStorage.removeItem('pos_orderMode');
    localStorage.removeItem('pos_tableId');
    localStorage.removeItem('pos_customerPhone');
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
      toast.error(t('Please add items to invoice first'));
      return;
    }

    // Every invoice must name the cashier who took it. Enforced only while the
    // branch actually HAS staff: an empty list must never stop the sale, it
    // just means nobody has been added yet.
    if (needsStaffSelection(staffList, selectedStaff)) {
      toast.error(
        isRtl
          ? 'اختر الموظف المسؤول عن الطلب قبل إتمام الفاتورة'
          : 'Select the staff member responsible for this order before completing the invoice'
      );
      setIsStaffPickerOpen(true);
      return;
    }

    if (orderMode === 'Dine-in' && !tableId.trim()) {
      toast.error(t('Please select table number first'));
      return;
    }

    if (orderMode === 'Takeaway') {
      const received = safeMoney(receivedAmount);
      if (paymentMethod === 'Cash' && compareMoney(received, grandTotal) < 0) {
        toast.error(isRtl ? 'يجب دفع الفاتورة أولاً لطلبات التيك أواي' : 'Takeaway orders must be paid in full first');
        return;
      }
    }

    // OnAccount always requires a registered customer or company (both Takeaway & Dine-in)
    if (paymentMethod === 'OnAccount') {
      setPendingCheckout(action);
      return;
    }

    // Cash / Card: do not prompt for customer phone
    if (action === 'save') {
      void executeSaveOrder(undefined, linkedCustomer || undefined);
    } else {
      void executePrintAndPay(undefined, linkedCustomer || undefined);
    }
  };

  const handleCustomerLookupResolved = async (result: CustomerLookupResult) => {
    const action = pendingCheckout;
    setPendingCheckout(null);
    if (!action) return;

    // ── OnAccount: company or customer ledger ─────────────────────────
    if (paymentMethod === 'OnAccount') {
      // Direct company selection (search by company name)
      if (result.company && !result.customer && billTo === 'company') {
        setLinkedCompany(result.company);
        setLinkedCustomer(null);
        if (action === 'save') {
          void executeSaveOrder(undefined, undefined, result.company);
        } else {
          void executePrintAndPay(undefined, undefined, result.company);
        }
        return;
      }

      if (result.skipped || (!result.customer && !result.company)) {
        toast.error(
          isRtl
            ? 'الفاتورة على الحساب تتطلب عميل أو شركة'
            : 'Charging to account requires a customer or company'
        );
        return;
      }

      let company: Company | null = result.company || null;
      if (result.customer) {
        setLinkedCustomer(result.customer);
        setCustomerPhone(result.customer.phone);
        if (!company && result.customer.companyId) {
          try {
            company = await companiesService.getById(result.customer.companyId);
            // Fallback: match company by name if id lookup failed
            if (!company) {
              const all = await companiesService.getAll();
              company =
                all.find(c => c.id === result.customer!.companyId) ||
                all.find(
                  c => c.name.trim() === String(result.customer!.companyId).trim()
                ) ||
                null;
              // Never invent a company when only one exists in the DB.
            }
          } catch {
            company = null;
          }
        }
      }
      setLinkedCompany(company);

      if (billTo === 'company' && !company) {
        toast.error(
          isRtl
            ? 'لم يتم ربط الشركة — ابحث باسم الشركة مباشرة أو اربط العميل بالشركة من صفحة العملاء'
            : 'Company not linked — search company name directly or link the customer to a company'
        );
        return;
      }

      const phone = result.customer?.phone;
      if (phone) setCustomerPhone(phone);

      if (action === 'save') {
        void executeSaveOrder(phone, result.customer || undefined, company);
      } else {
        void executePrintAndPay(phone, result.customer || undefined, company);
      }
      return;
    }

    // ── Cash / Card: optional customer ────────────────────────────────
    if (result.skipped || !result.customer) {
      if (action === 'save') void executeSaveOrder(undefined);
      else void executePrintAndPay(undefined);
      return;
    }

    setLinkedCustomer(result.customer);
    setCustomerPhone(result.customer.phone);
    if (action === 'save') {
      void executeSaveOrder(result.customer.phone, result.customer);
    } else {
      void executePrintAndPay(result.customer.phone, result.customer);
    }
  };

  const buildAccountMeta = (customer?: Customer, company?: Company | null) => {
    const staff = selectedStaff.trim();
    if (paymentMethod !== 'OnAccount') {
      // Cash/Card invoices still carry the staff attribution.
      return staff ? { cashierName: staff } : undefined;
    }
    const co = company !== undefined ? company : linkedCompany;

    // Company ledger (even without a person on the invoice)
    if (billTo === 'company' && co) {
      return {
        customerId: customer?.id,
        customerName: customer?.name,
        companyId: co.id,
        companyName: co.name,
        billedToType: 'company' as BilledToType,
        ...(staff ? { cashierName: staff } : {}),
      };
    }

    // Personal ledger
    if (!customer) return staff ? { cashierName: staff } : undefined;
    return {
      customerId: customer.id,
      customerName: customer.name,
      companyId: undefined,
      companyName: undefined,
      billedToType: 'customer' as BilledToType,
      ...(staff ? { cashierName: staff } : {}),
    };
  };

  const executeSaveOrder = async (
    customerPhone?: string,
    customer?: Customer,
    company?: Company | null
  ) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const finalTableId = orderMode === 'Takeaway' ? 'Takeaway' : `${t('Table')} ${tableId}`;
      let finalStatus: PaymentStatus =
        orderMode === 'Takeaway' ? 'Paid' : (paymentStatus as PaymentStatus);
      let method: PaymentMethod = paymentMethod;
      if (paymentMethod === 'OnAccount') {
        finalStatus = 'OnAccount';
        method = 'OnAccount';
      }
      const paidAmt =
        finalStatus === 'Paid' || finalStatus === 'OnAccount'
          ? grandTotal
          : undefined;
      const accountMeta = buildAccountMeta(customer || linkedCustomer || undefined, company);

      const newOrder = await onCreateOrder(
        finalTableId,
        invoiceItems,
        finalStatus,
        method,
        paidAmt,
        customerPhone,
        accountMeta
      );

      if (!newOrder) {
        throw new Error(isRtl ? 'فشل حفظ الطلب — لم يُرجع النظام رقم طلب' : 'Failed to save order — no order returned');
      }

      try {
        printAllOrderTickets(newOrder, language);
      } catch (printErr) {
        console.warn('[POS] print failed (order was saved):', printErr);
      }

      handleReset();
      setSuccessMessage(
        finalStatus === 'OnAccount'
          ? isRtl
            ? 'تم التسجيل على الحساب'
            : 'Charged to account'
          : t('Successfully saved order')
      );
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(isRtl ? `فشل حفظ الطلب: ${msg}` : `Failed to save order: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const executePrintAndPay = async (
    customerPhone?: string,
    customer?: Customer,
    company?: Company | null
  ) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const finalTableId = orderMode === 'Takeaway' ? 'Takeaway' : `${t('Table')} ${tableId}`;
      let finalPaymentStatus: PaymentStatus = 'Paid';
      let method: PaymentMethod = paymentMethod;
      if (paymentMethod === 'OnAccount') {
        finalPaymentStatus = 'OnAccount';
        method = 'OnAccount';
      }
      const paidAmt = grandTotal;
      const accountMeta = buildAccountMeta(customer || linkedCustomer || undefined, company);

      const newOrder = await onCreateOrder(
        finalTableId,
        invoiceItems,
        finalPaymentStatus,
        method,
        paidAmt,
        customerPhone,
        accountMeta
      );

      if (!newOrder) {
        throw new Error(isRtl ? 'فشل حفظ الطلب — لم يُرجع النظام رقم طلب' : 'Failed to save order — no order returned');
      }

      try {
        printAllOrderTickets(newOrder, language);
      } catch (printErr) {
        console.warn('[POS] print failed (order was saved):', printErr);
      }

      handleReset();
      setSuccessMessage(
        finalPaymentStatus === 'OnAccount'
          ? isRtl
            ? 'تم التسجيل على الحساب'
            : 'Charged to account'
          : t('Successfully saved order')
      );
      setTimeout(() => setSuccessMessage(null), 3050);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(isRtl ? `فشل حفظ الطلب: ${msg}` : `Failed to process order: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:gap-2.5 md:gap-3 h-full overflow-hidden text-gray-800 w-full">
      
      {/* 1. LEFT COLUMN: Payments & Calculator (Width 280-320px) - Only visible for Takeaway */}
      {orderMode === 'Takeaway' && (
        <div className="w-full sm:w-[260px] md:w-[280px] lg:w-[300px] xl:w-[320px] sm:h-full bg-white p-2 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col justify-between overflow-hidden pos-calculator shrink-0">
          <div className="flex-1 flex flex-col justify-between gap-1 overflow-hidden">
            <h2 className="font-extrabold text-xs md:text-sm text-mocha-800 border-b border-gray-100 pb-1 shrink-0">
              <span className="font-sans">{t('Payment & Invoice')}</span>
            </h2>
            
            {/* Total Due & Received Amount Input */}
            <div className="grid grid-cols-2 gap-1.5 shrink-0">
              <div className="space-y-0.5">
                <label className="text-[10px] md:text-xs text-gray-500 font-extrabold"><span className="font-sans">{t('Total Due')}</span></label>
                <div className="w-full bg-gray-950 text-amber-400 font-mono text-sm md:text-base font-black px-2 py-0.5 rounded-lg border border-gray-800 flex justify-between items-center select-all h-[30px]">
                  <span>{formatMoney(grandTotal)}</span>
                  <span className="text-[10px] text-gray-500 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
                </div>
              </div>

              <div className="space-y-0.5">
                <label className="text-[10px] md:text-xs text-gray-500 font-extrabold"><span className="font-sans">{t('Received Amount')}</span></label>
                <div className="w-full bg-gray-950 text-emerald-400 font-mono text-sm md:text-base font-black px-2 py-0.5 rounded-lg border border-gray-800 flex justify-between items-center select-all h-[30px]">
                  <span>{receivedAmount}</span>
                  <span className="text-[10px] text-gray-500 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
                </div>
              </div>
            </div>

            {/* Change for Customer */}
            <div className="space-y-0.5 shrink-0">
              <label className="text-[10px] md:text-xs text-gray-500 font-extrabold"><span className="font-sans">{t('Change for Customer')}</span></label>
              <div className="w-full bg-gray-950 text-amber-400 font-mono text-sm md:text-base font-black px-2 py-0.5 rounded-lg border border-gray-800 flex justify-between items-center h-[30px]">
                <span>{formatMoney(changeAmount)}</span>
                <span className="text-[10px] text-gray-500 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span>
              </div>
            </div>



            {/* Keypad */}
            <div className="grid grid-cols-3 grid-rows-5 gap-1 font-mono flex-1 min-h-0 py-0.5">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '00'].map(num => (
                <button
                  key={num}
                  onClick={() => handleKeypadPress(num)}
                  className="bg-gray-50 hover:bg-gray-100 active:scale-95 transition-all text-sm md:text-base font-black text-gray-900 rounded-lg border border-gray-200 shadow-sm flex items-center justify-center h-full"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={() => handleKeypadPress('C')}
                className="col-span-3 bg-red-500 hover:bg-red-600 text-white text-sm md:text-base font-black rounded-lg border border-red-600 shadow-sm active:scale-95 transition-all flex items-center justify-center h-full py-1.5"
              >
                {language === 'ar' ? 'مسح الكل' : 'Clear All'}
              </button>

            </div>

            {/* Payment Method Selection */}
            <div className="pt-0.5 shrink-0">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 font-extrabold uppercase block">
                  <span className="font-sans">{t('Payment Method')}</span>
                </label>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('Cash')}
                    className={clsx(
                      "py-1.5 rounded-lg text-[10px] font-black transition-all flex flex-col items-center justify-center gap-0.5 border",
                      paymentMethod === 'Cash'
                        ? "bg-mocha-600 text-white border-mocha-700 shadow-sm"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-white"
                    )}
                  >
                    <DollarSign size={14} />
                    <span className="font-sans">{isRtl ? 'نقداً' : t('Cash')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('Card')}
                    className={clsx(
                      "py-1.5 rounded-lg text-[10px] font-black transition-all flex flex-col items-center justify-center gap-0.5 border",
                      paymentMethod === 'Card'
                        ? "bg-mocha-600 text-white border-mocha-700 shadow-sm"
                        : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-white"
                    )}
                  >
                    <CreditCard size={14} />
                    <span className="font-sans">{isRtl ? 'بطاقة' : t('Card')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('OnAccount')}
                    className={clsx(
                      "py-1.5 rounded-lg text-[10px] font-black transition-all flex flex-col items-center justify-center gap-0.5 border",
                      paymentMethod === 'OnAccount'
                        ? "bg-amber-500 text-white border-amber-600 shadow-sm"
                        : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                    )}
                    title={isRtl ? 'تسجيل على حساب العميل/الشركة (دفع مؤجل)' : 'Charge to customer/company account'}
                  >
                    <BookUser size={14} />
                    <span className="font-sans">{isRtl ? 'على الحساب' : 'On Account'}</span>
                  </button>
                </div>
                {paymentMethod === 'OnAccount' && (
                  <div className="flex gap-1 mt-1">
                    <button
                      type="button"
                      onClick={() => setBillTo('customer')}
                      className={clsx(
                        'flex-1 py-1.5 rounded-lg text-[10px] font-extrabold border transition-all',
                        billTo === 'customer'
                          ? 'bg-mocha-600 text-white border-mocha-700 shadow-xs'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {isRtl ? 'حساب عميل (شخصي)' : 'Personal Account'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillTo('company')}
                      className={clsx(
                        'flex-1 py-1.5 rounded-lg text-[10px] font-extrabold border transition-all',
                        billTo === 'company'
                          ? 'bg-purple-600 text-white border-purple-700 shadow-xs'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {isRtl ? 'حساب شركة' : 'Company Account'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Button Row */}
          <div className="space-y-1 pt-1 border-t border-gray-100 shrink-0">
            <button
              onClick={handlePrintAndPay}
              disabled={isProcessing}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-black py-1.5 rounded-xl border border-emerald-700 transition-all active:scale-95 text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Printer size={14} />
              <span className="font-sans">{isProcessing ? t('Processing...') : t('Print & Pay')}</span>
            </button>
            
            <button
              onClick={handleReset}
              disabled={isProcessing}
              className="w-full bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 font-black py-1.5 rounded-xl border border-red-200 transition-all active:scale-95 text-xs sm:text-sm text-center flex items-center justify-center gap-1.5 shadow-sm"
            >
              <span className="font-sans">{t('Clear / Reset')}</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. CENTER COLUMN: Product Grid & Category Filters (Width 2/4) */}
      <div className="flex-1 sm:h-full bg-white p-3 md:p-4 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col overflow-hidden min-w-0">
        {/* Category Selector & Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 shrink-0">
          {/* Categories */}
          <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={clsx(
                  "px-4 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm lg:text-base font-black whitespace-nowrap transition-all border",
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
              className={`w-full py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-mocha-500 focus:border-transparent text-xs md:text-sm font-semibold ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'}`}
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
        <div className="flex-1 overflow-y-auto mt-3 md:mt-4 pr-1 custom-scrollbar">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-2.5">
              {filteredMenuItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleAddItem(item)}
                  className="bg-gray-50 hover:bg-gray-100 active:scale-95 transition-all p-2 sm:p-2.5 rounded-xl border border-gray-200/60 hover:border-gray-300 shadow-sm flex flex-col justify-between items-start text-start min-h-[92px] sm:min-h-[100px] h-auto relative overflow-hidden group"
                >
                  <span className="font-bold text-xs sm:text-sm md:text-base text-gray-900 group-hover:text-mocha-700 font-sans leading-snug pt-0.5">{t(item.name)}</span>
                  <div className="w-full flex justify-between items-center z-10 mt-2">
                    <span className="font-mono text-sm sm:text-base md:text-lg font-black text-mocha-800">{formatMoney(item.price)} <span className="text-[10px] sm:text-xs text-gray-400 font-sans font-bold">{isRtl ? 'ج.م' : 'EGP'}</span></span>
                    <span className="bg-mocha-50 text-mocha-600 text-xs sm:text-sm px-2 py-0.5 rounded-lg border border-mocha-200 group-hover:bg-mocha-600 group-hover:text-white transition-colors font-black">+</span>
                  </div>
                  {/* Subtle hover icon decoration */}
                  <Coffee size={32} className="absolute -right-2 -bottom-2 text-gray-200/20 group-hover:text-mocha-200/10 transition-all pointer-events-none" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. RIGHT COLUMN: Current Bill & Summary (Expands in Dine-in mode) */}
      <div className={clsx(
        "sm:h-full bg-white p-3 md:p-4 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col justify-between overflow-hidden shrink-0 transition-all duration-300",
        orderMode === 'Dine-in'
          ? "w-full sm:w-[360px] md:w-[400px] lg:w-[420px] xl:w-[460px]"
          : "w-full sm:w-[240px] md:w-[250px] lg:w-[260px] xl:w-[280px]"
      )}>
        <div className="flex-1 flex flex-col overflow-hidden">
          <h2 className="font-extrabold text-xs md:text-sm text-mocha-800 border-b border-gray-100 pb-1 shrink-0">{t('Invoice Details')}</h2>
          
          {/* Staff picker — who is taking this order (printed on the invoice) */}
          <button
            type="button"
            onClick={() => setIsStaffPickerOpen(true)}
            className={clsx(
              "mt-1.5 w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border text-xs md:text-sm font-extrabold transition-all shrink-0 shadow-sm",
              selectedStaff
                ? "bg-mocha-600 text-white border-mocha-700"
                : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
            )}
            title={isRtl ? 'اختيار الموظف / الكاشير الواقف على الطلب' : 'Pick the staff member taking this order'}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <UserRound size={14} className="shrink-0" />
              <span className="truncate">
                {selectedStaff
                  ? `${isRtl ? 'الموظف' : 'Staff'}: ${selectedStaff}`
                  : isRtl ? 'اختر الموظف / الكاشير' : 'Select staff / cashier'}
              </span>
            </span>
            <Users size={14} className="shrink-0 opacity-70" />
          </button>

          {/* Table Mode Selector - Compact & Sleek */}
          <div className="flex bg-gray-100 rounded-xl p-0.5 border border-gray-200 mt-1.5 shrink-0">
            <button
              onClick={() => handleSetOrderMode('Dine-in')}
              className={clsx(
                "flex-1 py-1.5 rounded-lg text-xs md:text-sm font-extrabold transition-all",
                orderMode === 'Dine-in' ? "bg-white text-mocha-700 shadow-sm" : "text-gray-500 hover:bg-white/50"
              )}
            >
              {t('Dine-in')}
            </button>
            <button
              onClick={() => handleSetOrderMode('Takeaway')}
              className={clsx(
                "flex-1 py-1.5 rounded-lg text-xs md:text-sm font-extrabold transition-all",
                orderMode === 'Takeaway' ? "bg-white text-mocha-700 shadow-sm" : "text-gray-500 hover:bg-white/50"
              )}
            >
              {t('Takeaway')}
            </button>
          </div>



          {/* Table ID Selector (Only visible for Dine-in) - Compact & Dynamic */}
          {orderMode === 'Dine-in' && (
            <div className="mt-2 shrink-0 space-y-1.5 border-b border-gray-100 pb-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 shrink-0">
                  <label className="text-xs text-gray-600 font-extrabold">{t('Table')}:</label>
                  <button
                    type="button"
                    onClick={() => setIsManageTablesOpen(true)}
                    className="p-1 text-mocha-700 bg-mocha-50 hover:bg-mocha-100 border border-mocha-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"
                    title={isRtl ? 'إدارة / تعديل الطاولات' : 'Manage Tables'}
                  >
                    <Settings size={12} />
                    <span className="text-[10px]">{isRtl ? 'إدارة' : 'Manage'}</span>
                  </button>
                </div>

                <input
                  type="text"
                  value={tableId}
                  onChange={(e) => setTableId(e.target.value)}
                  onBlur={() => {
                    const clean = tableId.trim().replace(/^T(?=\d+$)/i, '');
                    if (clean && !tables.includes(clean)) {
                      void addTableName(clean);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const clean = tableId.trim().replace(/^T(?=\d+$)/i, '');
                      if (clean && !tables.includes(clean)) {
                        void addTableName(clean);
                      }
                    }
                  }}
                  placeholder={t('Enter Table Number')}
                  className="w-full px-3 py-1 bg-gray-50 border border-gray-300 rounded-lg font-black text-xs md:text-sm focus:outline-none focus:border-mocha-600 text-gray-900"
                />
              </div>

              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-0.5 custom-scrollbar">
                {tables.map(num => (
                  <button
                    key={num}
                    onClick={() => setTableId(num)}
                    className={clsx(
                      "px-2.5 py-1 text-xs font-black rounded-lg border transition-all shadow-sm flex items-center justify-center min-w-[36px]",
                      tableId === num
                        ? "bg-mocha-600 text-white border-mocha-700 shadow-sm"
                        : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                    )}
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setIsManageTablesOpen(true)}
                  className="px-2.5 py-1 text-xs font-black rounded-lg border border-dashed border-mocha-300 text-mocha-700 bg-mocha-50/50 hover:bg-mocha-100 transition-colors flex items-center gap-0.5"
                  title={isRtl ? 'إضافة طاولة جديد' : 'Add Table'}
                >
                  <Plus size={12} />
                  <span>{isRtl ? 'إضافة' : 'Add'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Current Invoice List - Prominently Displayed for Both Dine-in & Takeaway */}
          <div className="flex-1 min-h-[160px] sm:min-h-[220px] overflow-y-auto mt-2 pr-1 custom-scrollbar border-b border-gray-100 pb-2">
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
                      <span className="text-[11px] md:text-xs text-mocha-700 font-extrabold font-mono">{formatMoney(lineTotal(item.price, item.quantity))} <span className="font-sans text-[9px] md:text-[10px]">{isRtl ? 'ج.م' : 'EGP'}</span></span>
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

        {/* Invoice Summary Box - Ultra Compact & Space Efficient */}
        <div className="mt-1.5 space-y-1 shrink-0 text-xs">
          {/* Top row: 3 status badges in 1 tight row */}
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <div className="bg-gray-50 px-1.5 py-1 rounded-lg border border-gray-200 flex flex-col items-center justify-center">
              <span className="text-gray-400 font-extrabold text-[8px]">{t('Invoice Number')}</span>
              <span className="font-black text-gray-900 mt-0.5">#{estimatedOrderNumber}</span>
            </div>
            <div className="bg-gray-50 px-1.5 py-1 rounded-lg border border-gray-200 flex flex-col items-center justify-center">
              <span className="text-gray-400 font-extrabold text-[8px]">{t('Items Count')}</span>
              <span className="font-black text-gray-900 mt-0.5">{itemsCount}</span>
            </div>
            <div className="bg-gray-50 px-1.5 py-1 rounded-lg border border-gray-200 flex flex-col items-center justify-center">
              <span className="text-gray-400 font-extrabold text-[8px]">{t('Invoice Date')}</span>
              <span className="font-bold text-gray-800 mt-0.5">{new Date().toLocaleDateString(isRtl ? 'ar-EG' : 'en-US')}</span>
            </div>
          </div>

          {/* Highlighted Total Bar */}
          <div className="bg-amber-50/80 px-2.5 py-1 rounded-xl border border-amber-200 flex items-center justify-between shadow-xs">
            <span className="text-[11px] font-extrabold text-amber-900">{t('Total')}:</span>
            <span className="font-mono text-sm font-black text-amber-950">
              {formatMoney(grandTotal)} <span className="text-[9px] font-sans font-bold text-amber-800">{isRtl ? 'ج.م' : 'EGP'}</span>
            </span>
          </div>
          
          {/* Action buttons & OnAccount for Dine-in */}
          {orderMode === 'Dine-in' && (
            <div className="space-y-1 pt-0.5">
              {/* Payment Method for Dine-in */}
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 font-extrabold uppercase block">
                  <span className="font-sans">{t('Payment Method')}</span>
                </label>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('OnAccount')}
                    className={clsx(
                      "py-1.5 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 border",
                      paymentMethod === 'OnAccount'
                        ? "bg-amber-500 text-white border-amber-600 shadow-sm"
                        : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                    )}
                    title={isRtl ? 'تسجيل على حساب العميل/الشركة (دفع مؤجل)' : 'Charge to customer/company account'}
                  >
                    <BookUser size={14} />
                    <span className="font-sans">{isRtl ? 'على الحساب' : 'On Account'}</span>
                  </button>
                </div>
                {paymentMethod === 'OnAccount' && (
                  <div className="flex gap-1 mt-1">
                    <button
                      type="button"
                      onClick={() => setBillTo('customer')}
                      className={clsx(
                        'flex-1 py-1.5 rounded-lg text-[10px] font-extrabold border transition-all',
                        billTo === 'customer'
                          ? 'bg-mocha-600 text-white border-mocha-700 shadow-xs'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {isRtl ? 'حساب عميل (شخصي)' : 'Personal Account'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillTo('company')}
                      className={clsx(
                        'flex-1 py-1.5 rounded-lg text-[10px] font-extrabold border transition-all',
                        billTo === 'company'
                          ? 'bg-purple-600 text-white border-purple-700 shadow-xs'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {isRtl ? 'حساب شركة' : 'Company Account'}
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={handleReset}
                  className="bg-red-50 hover:bg-red-100 text-red-600 font-black py-1.5 rounded-xl border border-red-200 transition-all active:scale-95 text-xs text-center"
                >
                  {t('Clear / Reset')}
                </button>
                <button
                  onClick={handleSaveOrder}
                  className="bg-mocha-600 hover:bg-mocha-700 text-white font-black py-1.5 rounded-xl border border-mocha-700 transition-all active:scale-95 text-xs text-center flex items-center justify-center gap-1 shadow-sm"
                >
                  <Check size={14} />
                  {t('Save Invoice')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Staff Picker Modal — pick who is on the till / took the order */}
      {isStaffPickerOpen && (
        <AnimatePresence>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl border border-gray-100 space-y-4 text-gray-900"
            >
              <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                <h3 className="font-extrabold text-lg text-mocha-800 flex items-center gap-2">
                  <UserRound className="w-5 h-5 text-mocha-700" />
                  {isRtl ? 'مين واقف على الكاشير؟' : 'Who is on the till?'}
                </h3>
                <button
                  onClick={() => setIsStaffPickerOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Staff list */}
              <div className="space-y-1.5">
                {staffList.length === 0 ? (
                  <p className="text-xs text-gray-400 font-bold text-center py-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    {isRtl
                      ? 'لا يوجد موظفون بعد — أضف أول اسم من الأسفل'
                      : 'No staff yet — add the first name below'}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto custom-scrollbar p-0.5">
                    {staffList.map(name => (
                      <div key={name} className="relative group">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedStaff(name);
                            setIsStaffPickerOpen(false);
                          }}
                          className={clsx(
                            "w-full px-3 py-2.5 rounded-xl border text-xs md:text-sm font-black transition-all flex items-center justify-center gap-1.5 shadow-sm",
                            selectedStaff === name
                              ? "bg-mocha-600 text-white border-mocha-700"
                              : "bg-gray-50 text-gray-800 border-gray-200 hover:bg-gray-100"
                          )}
                        >
                          <UserRound size={13} className="shrink-0" />
                          <span className="truncate">{name}</span>
                          {selectedStaff === name && <Check size={13} className="shrink-0" />}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            // A removed staff name that never reaches D1 is back
                            // on the next hydrate, and every other till never
                            // stopped showing it. Report the real outcome.
                            const outcome = await setStaffList(prev =>
                              prev.filter(n => n !== name)
                            );
                            if (selectedStaff === name) setSelectedStaff('');
                            reportListOutcome(
                              outcome,
                              language === 'ar'
                                ? `تم حذف ${name}`
                                : `${name} removed`
                            );
                          }}
                          className="absolute -top-1.5 -end-1.5 bg-white text-red-500 hover:text-red-700 border border-red-200 rounded-full p-0.5 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                          title={isRtl ? 'حذف الاسم' : 'Remove'}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add new staff member */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = newStaffName.trim();
                  if (!clean) return;
                  if (!staffList.includes(clean)) {
                    void setStaffList(prev => [...prev, clean]).then(outcome => {
                      const report = describePersistOutcome(outcome, language);
                      if (!report) return;
                      if (report.tone === 'error') toast.error(report.message, report.title);
                      else toast.warning(report.message, report.title);
                    });
                  }
                  setSelectedStaff(clean);
                  setNewStaffName('');
                  setIsStaffPickerOpen(false);
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  placeholder={isRtl ? 'اسم الموظف (مثال: أحمد)' : 'Staff name (e.g. Ahmed)'}
                  className="flex-1 px-4 py-2 bg-gray-50 border border-gray-300 rounded-xl text-sm font-extrabold text-gray-900 focus:outline-none focus:border-mocha-600"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-mocha-600 hover:bg-mocha-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1 shrink-0 shadow-sm"
                >
                  <Plus size={16} />
                  {isRtl ? 'إضافة واختيار' : 'Add & pick'}
                </button>
              </form>

              {/* Clear / close */}
              <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStaff('');
                    setIsStaffPickerOpen(false);
                  }}
                  className="text-xs font-extrabold text-red-600 hover:text-red-700 flex items-center gap-1"
                >
                  <X size={14} />
                  {isRtl ? 'بدون اسم (إخفاء من الفاتورة)' : 'No name (hide from receipt)'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsStaffPickerOpen(false)}
                  className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-xl text-xs font-extrabold transition-all"
                >
                  {isRtl ? 'تم / إغلاق' : 'Done'}
                </button>
              </div>
            </motion.div>
          </div>
        </AnimatePresence>
      )}

      {/* Manage Tables Modal */}
      {isManageTablesOpen && (
        <AnimatePresence>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl border border-gray-100 space-y-4 text-gray-900"
            >
              <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                <h3 className="font-extrabold text-lg text-mocha-800 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-mocha-700" />
                  {isRtl ? 'إدارة طاولات المطعم' : 'Manage Restaurant Tables'}
                </h3>
                <button
                  onClick={() => setIsManageTablesOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Add New Table Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddTable();
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder={isRtl ? 'رقم أو اسم الطاولة (مثال: 9 أو VIP)' : 'Table Name / No (e.g. 9 or VIP)'}
                  className="flex-1 px-4 py-2 bg-gray-50 border border-gray-300 rounded-xl text-sm font-extrabold text-gray-900 focus:outline-none focus:border-mocha-600"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-mocha-600 hover:bg-mocha-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1 shrink-0 shadow-sm"
                >
                  <Plus size={16} />
                  {isRtl ? 'إضافة' : 'Add'}
                </button>
              </form>

              {/* Table Badges List */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500 font-extrabold uppercase block">
                  {isRtl ? 'الطاولات الحالية (اضغط على × للحذف):' : 'Current Tables (click × to delete):'}
                </label>
                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 bg-gray-50 rounded-xl border border-gray-200 custom-scrollbar">
                  {tables.map(num => (
                    <div
                      key={num}
                      className={clsx(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-black transition-all shadow-sm",
                        tableId === num ? "bg-mocha-600 text-white border-mocha-700" : "bg-white text-gray-800 border-gray-200"
                      )}
                    >
                      <span>{num}</span>
                      <button
                        onClick={() => handleDeleteTable(num)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-0.5 rounded transition-colors"
                        title={isRtl ? 'حذف' : 'Delete'}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Reset to Default & Close */}
              <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={handleResetTables}
                  className="text-xs font-extrabold text-red-600 hover:text-red-700 flex items-center gap-1"
                >
                  <RotateCcw size={14} />
                  {isRtl ? 'إعادة تعيين للأصل (T1-T8)' : 'Reset to Default'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsManageTablesOpen(false)}
                  className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-xl text-xs font-extrabold transition-all"
                >
                  {isRtl ? 'تم / إغلاق' : 'Done'}
                </button>
              </div>
            </motion.div>
          </div>
        </AnimatePresence>
      )}

      {/* Customer phone lookup before checkout (skippable) */}
      {pendingCheckout && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setPendingCheckout(null)}
          />
          <div className="relative bg-white rounded-2xl w-full max-w-md tablet:max-w-lg shadow-2xl z-10 overflow-hidden p-5">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-extrabold text-gray-900">
                {language === 'ar' ? 'قبل إتمام الطلب' : 'Before completing order'}
              </h3>
              <button
                type="button"
                onClick={() => setPendingCheckout(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
              >
                <X size={18} />
              </button>
            </div>
            <CustomerLookupStep
              initialPhone={customerPhone}
              onResolved={handleCustomerLookupResolved}
              onCancel={() => setPendingCheckout(null)}
              compact
              accountMode={
                paymentMethod === 'OnAccount'
                  ? billTo === 'company'
                    ? 'company'
                    : 'customer'
                  : 'any'
              }
            />
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
