import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Building2, Plus, Search, Phone, Tag, X, Save,
  ShoppingBag, Trash2, Edit3, UserCircle, BarChart3, Printer,
  Wallet, DollarSign, Star, ChevronLeft, ChevronRight, FileText,
  AlertCircle, Check, Award
} from 'lucide-react';
import { customersService } from '../services/customersService';
import { companiesService } from '../services/companiesService';
import { Customer } from '../types/customer';
import { Company } from '../types/company';
import { Order, getOrderGrandTotal } from '../types/order';

import { useOrders } from '../hooks/useOrders';
import { useLanguage } from '../context/LanguageContext';
import { getTaxRate } from '../utils/settingsConfig';
import { useAuth } from '../context/AuthContext';
import { clsx } from 'clsx';
import { useToast } from '../components/ui/Toast';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  getCustomerAccountBalance,
  getCompanyAccountBalance,
  getCustomerOpenInvoices,
  getCompanyOpenInvoices,
  isCompanyBilledOrder,
} from '../utils/accountBalance';
import { printCompanyStatement, printCustomerStatement, printCustomerReceipt } from '../utils/printReceipts';
import { formatOrderNumber } from '../utils/orderNumber';

type Tab = 'customers' | 'companies';

interface CustomersPageProps {
  /** When true, hide header actions that conflict with manager chrome */
  managerMode?: boolean;
}

function parseTags(input: string): string[] {
  return input
    .split(/[,،]/)
    .map(t => t.trim())
    .filter(Boolean);
}

function tagsToString(tags?: string[]): string {
  return (tags || []).join(', ');
}

function orderStats(orders: Order[], taxRate: number) {
  const paid = orders.filter(o => o.paymentStatus === 'Paid');
  const revenue = paid.reduce((s, o) => s + getOrderGrandTotal(o, taxRate), 0);
  return {
    totalOrders: orders.length,
    paidOrders: paid.length,
    revenue,
    avgTicket: paid.length > 0 ? revenue / paid.length : 0,
  };
}

/** Get initials for avatar */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '👤';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Avatar color palette based on name */
const AVATAR_COLORS = [
  'from-amber-500 to-orange-600 text-white',
  'from-blue-500 to-indigo-600 text-white',
  'from-emerald-500 to-teal-600 text-white',
  'from-purple-500 to-pink-600 text-white',
  'from-mocha-600 to-coffee-dark text-white',
  'from-rose-500 to-red-600 text-white',
];

function getAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export default function CustomersPage({ managerMode = false }: CustomersPageProps) {
  const { t, language, isRtl } = useLanguage();
  const { user, branch } = useAuth();
  const { orders, deleteOrder } = useOrders();

  const taxRate = getTaxRate();
  const branchId = branch?.branchId === 'manager' ? undefined : branch?.branchId;

  const [tab, setTab] = useState<Tab>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Forms / profiles
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [companyFormOpen, setCompanyFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [profileCustomer, setProfileCustomer] = useState<Customer | null>(null);
  const [profileCompany, setProfileCompany] = useState<Company | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [c, cos] = await Promise.all([
        customersService.getAll(branchId),
        companiesService.getAll(branchId),
      ]);
      setCustomers(c);
      setCompanies(cos);
    } catch (e) {
      console.error(e);
      setLoadError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const companyMap = useMemo(() => {
    const m: Record<string, Company> = {};
    companies.forEach(c => { m[c.id] = c; });
    return m;
  }, [companies]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c => {
      const co = c.companyId ? companyMap[c.companyId] : null;
      const hay = [
        c.name, c.phone, ...(c.tags || []), co?.name, ...(co?.tags || [])
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [customers, search, companyMap]);

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(c => {
      const hay = [c.name, c.phone, ...(c.tags || [])].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [companies, search]);

  const customerOrders = useCallback(
    (phone: string, customerId?: string) =>
      orders
        .filter(o => {
          if (customerId && o.customerId === customerId) return true;
          return !!(o.customerPhone && o.customerPhone === phone);
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [orders]
  );

  const companyMembers = useCallback(
    (companyId: string) => customers.filter(c => c.companyId === companyId),
    [customers]
  );

  const companyOrders = useCallback(
    (companyId: string) => {
      return orders
        .filter(o => {
          if (isCompanyBilledOrder(o) && o.companyId === companyId) return true;
          if (o.companyId === companyId && o.billedToType !== 'customer') return true;
          return false;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    [orders]
  );

  // Total Receivables calculated across all customers & companies
  const totalCustomerReceivables = useMemo(() => {
    return customers.reduce((sum, c) => sum + getCustomerAccountBalance(orders, c, taxRate), 0);
  }, [customers, orders, taxRate]);

  const totalCompanyReceivables = useMemo(() => {
    return companies.reduce((sum, co) => {
      const members = companyMembers(co.id);
      return sum + getCompanyAccountBalance(
        orders, co.id, taxRate,
        members.map(m => m.phone),
        members.map(m => m.id),
        false
      );
    }, 0);
  }, [companies, orders, taxRate, companyMembers]);

  // ── Customer form state ──────────────────────────────────────────
  const [cForm, setCForm] = useState({ name: '', phone: '', points: '0', companyId: '', tags: '', notes: '' });
  const [coForm, setCoForm] = useState({ name: '', phone: '', tags: '', notes: '' });

  const openNewCustomer = () => {
    setEditingCustomer(null);
    setCForm({ name: '', phone: '', points: '0', companyId: '', tags: '', notes: '' });
    setCustomerFormOpen(true);
  };

  const openEditCustomer = (c: Customer) => {
    setEditingCustomer(c);
    setCForm({
      name: c.name,
      phone: c.phone,
      points: String(c.points || 0),
      companyId: c.companyId || '',
      tags: tagsToString(c.tags),
      notes: c.notes || '',
    });
    setCustomerFormOpen(true);
  };

  const openNewCompany = () => {
    setEditingCompany(null);
    setCoForm({ name: '', phone: '', tags: '', notes: '' });
    setCompanyFormOpen(true);
  };

  const openEditCompany = (co: Company) => {
    setEditingCompany(co);
    setCoForm({
      name: co.name,
      phone: co.phone || '',
      tags: tagsToString(co.tags),
      notes: co.notes || '',
    });
    setCompanyFormOpen(true);
  };

  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'customer' | 'company' } | null>(null);

  const saveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cForm.phone.trim()) {
      toast.error(language === 'ar' ? 'أدخل رقم هاتف العميل' : 'Enter customer phone');
      return;
    }
    try {
      await customersService.save(
        {
          id: editingCustomer?.id,
          name: cForm.name.trim() || cForm.phone.trim(),
          phone: cForm.phone.trim(),
          points: parseInt(cForm.points, 10) || 0,
          companyId: cForm.companyId || undefined,
          tags: parseTags(cForm.tags),
          notes: cForm.notes.trim() || undefined,
        },
        branchId
      );
      setCustomerFormOpen(false);
      setProfileCustomer(null);
      toast.success(language === 'ar' ? 'تم حفظ العميل بنجاح' : 'Customer saved successfully');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(language === 'ar' ? 'فشل حفظ العميل' : 'Failed to save customer');
    }
  };

  const deleteCustomer = async (id: string) => {
    setDeleteTarget({ id, type: 'customer' });
  };

  const saveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coForm.name.trim()) {
      toast.error(language === 'ar' ? 'أدخل اسم الشركة' : 'Enter company name');
      return;
    }
    try {
      await companiesService.save(
        {
          id: editingCompany?.id,
          name: coForm.name.trim(),
          phone: coForm.phone.trim() || undefined,
          tags: parseTags(coForm.tags),
          notes: coForm.notes.trim() || undefined,
        },
        branchId
      );
      setCompanyFormOpen(false);
      setProfileCompany(null);
      toast.success(language === 'ar' ? 'تم حفظ الشركة بنجاح' : 'Company saved successfully');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(language === 'ar' ? 'فشل حفظ الشركة' : 'Failed to save company');
    }
  };

  const deleteCompany = async (id: string) => {
    setDeleteTarget({ id, type: 'company' });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'customer') {
        await customersService.delete(deleteTarget.id);
        toast.success(language === 'ar' ? 'تم حذف العميل' : 'Customer deleted');
      } else {
        await companiesService.delete(deleteTarget.id);
        toast.success(language === 'ar' ? 'تم حذف الشركة' : 'Company deleted');
      }
      setProfileCustomer(null);
      setProfileCompany(null);
      await load();
    } catch {
      toast.error(language === 'ar' ? 'فشل الحذف' : 'Failed to delete');
    } finally {
      setDeleteTarget(null);
    }
  };

  const currency = language === 'ar' ? 'ج.م' : 'EGP';

  return (
    <div className="space-y-4 md:space-y-6">
      {/* ── Page Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-gray-150">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-br from-mocha-600 to-coffee-dark rounded-2xl shadow-md text-white">
            <Users size={24} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-extrabold text-gray-900 tracking-tight">
              {language === 'ar' ? 'إدارة العملاء والشركات' : 'Customers & Companies'}
            </h1>
            <p className="text-xs text-gray-500 font-medium mt-0.5">
              {language === 'ar' ? 'متابعة سجلات العملاء، حسابات الآجل، ونقاط الولاء' : 'Manage customer profiles, credit accounts, and loyalty rewards.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={openNewCompany}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-mocha-200 bg-mocha-50/50 hover:bg-mocha-100/60 text-mocha-900 text-xs font-bold transition-all shadow-xs active:scale-95"
          >
            <Building2 size={16} className="text-mocha-700" />
            <span>{language === 'ar' ? '+ إضافة شركة' : '+ Add Company'}</span>
          </button>
          <button
            onClick={openNewCustomer}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-mocha-700 to-coffee-dark hover:from-mocha-800 hover:to-coffee-dark text-white text-xs font-bold shadow-md shadow-mocha-700/20 transition-all active:scale-95"
          >
            <Plus size={16} />
            <span>{language === 'ar' ? 'إضافة عميل جديد' : 'Add Customer'}</span>
          </button>
        </div>
      </div>

      {/* ── Executive Stat Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Customers */}
        <StatCard
          icon={Users}
          title={language === 'ar' ? 'إجمالي العملاء' : 'Total Customers'}
          value={customers.length.toLocaleString()}
          subtitle={language === 'ar' ? 'عميل مسجل بالنظام' : 'Registered members'}
          gradient="from-amber-50 to-orange-50/40 border-amber-100/80 text-amber-700"
          iconBg="bg-amber-100/80 text-amber-800"
        />

        {/* Total Companies */}
        <StatCard
          icon={Building2}
          title={language === 'ar' ? 'إجمالي الشركات' : 'Corporate Accounts'}
          value={companies.length.toLocaleString()}
          subtitle={language === 'ar' ? 'حساب شركة ومؤسسة' : 'Active companies'}
          gradient="from-purple-50 to-indigo-50/40 border-purple-100/80 text-purple-700"
          iconBg="bg-purple-100/80 text-purple-800"
        />

        {/* Linked Orders */}
        <StatCard
          icon={ShoppingBag}
          title={language === 'ar' ? 'الطلبات المرتبطة' : 'Linked Orders'}
          value={orders.filter(o => o.customerPhone || o.customerId).length.toLocaleString()}
          subtitle={language === 'ar' ? 'عملية مباعة للعملاء' : 'Customer checkouts'}
          gradient="from-emerald-50 to-teal-50/40 border-emerald-100/80 text-emerald-700"
          iconBg="bg-emerald-100/80 text-emerald-800"
        />

        {/* Total Receivables */}
        <StatCard
          icon={Wallet}
          title={language === 'ar' ? 'ديون آجل قائمة' : 'Total Receivables'}
          value={`${(totalCustomerReceivables + totalCompanyReceivables).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`}
          subtitle={language === 'ar' ? 'مستحقات آجل للعملاء والشركات' : 'Outstanding credit due'}
          gradient="from-rose-50 to-red-50/40 border-rose-100/80 text-rose-700"
          iconBg="bg-rose-100/80 text-rose-800"
        />
      </div>

      {/* ── Tabs & Search Control Panel ─────────────────────────────────────────── */}
      <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-gray-150 flex flex-col sm:flex-row gap-3 items-center justify-between">
        {/* Pill Tab Switcher */}
        <div className="flex bg-gray-100/80 p-1.5 rounded-xl border border-gray-200/60 w-full sm:w-auto">
          <button
            onClick={() => setTab('customers')}
            className={clsx(
              'flex-1 sm:flex-initial px-5 py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-2',
              tab === 'customers'
                ? 'bg-white text-gray-900 shadow-sm border border-gray-200/80'
                : 'text-gray-500 hover:text-gray-800'
            )}
          >
            <Users size={15} className={tab === 'customers' ? 'text-mocha-600' : 'text-gray-400'} />
            <span>{language === 'ar' ? 'العملاء' : 'Customers'}</span>
            <span className={clsx(
              'px-2 py-0.5 rounded-full text-[10px] font-bold',
              tab === 'customers' ? 'bg-mocha-100 text-mocha-800' : 'bg-gray-200 text-gray-600'
            )}>
              {filteredCustomers.length}
            </span>
          </button>

          <button
            onClick={() => setTab('companies')}
            className={clsx(
              'flex-1 sm:flex-initial px-5 py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-2',
              tab === 'companies'
                ? 'bg-white text-gray-900 shadow-sm border border-gray-200/80'
                : 'text-gray-500 hover:text-gray-800'
            )}
          >
            <Building2 size={15} className={tab === 'companies' ? 'text-purple-600' : 'text-gray-400'} />
            <span>{language === 'ar' ? 'الشركات والمؤسسات' : 'Companies'}</span>
            <span className={clsx(
              'px-2 py-0.5 rounded-full text-[10px] font-bold',
              tab === 'companies' ? 'bg-purple-100 text-purple-800' : 'bg-gray-200 text-gray-600'
            )}>
              {filteredCompanies.length}
            </span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-80">
          <Search className={clsx('absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none', isRtl ? 'right-3.5' : 'left-3.5')} />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={
              tab === 'customers'
                ? (language === 'ar' ? 'بحث باسم العميل أو رقم الهاتف أو الوسم...' : 'Search customer by name, phone or tag...')
                : (language === 'ar' ? 'بحث باسم الشركة أو الرقم...' : 'Search company name or phone...')
            }
            className={clsx(
              'w-full py-2.5 bg-gray-50/80 border border-gray-200 rounded-xl text-xs font-medium text-gray-900',
              'focus:outline-none focus:ring-2 focus:ring-mocha-500/30 focus:border-mocha-500 focus:bg-white transition-all',
              isRtl ? 'pr-10 pl-4' : 'pl-10 pr-4'
            )}
          />
        </div>
      </div>

      {/* ── Content Grid ────────────────────────────────────────────────────────── */}
      {loadError ? (
        <div className="flex items-center justify-center py-20 bg-white rounded-2xl border border-gray-150">
          <div className="text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
            <p className="text-sm font-bold text-gray-800">{language === 'ar' ? 'فشل تحميل بيانات العملاء' : 'Failed to load customer data'}</p>
            <p className="text-xs text-gray-400">{loadError}</p>
            <button onClick={() => load()} className="px-5 py-2.5 rounded-xl bg-mocha-700 text-white text-xs font-bold shadow-sm">
              {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs animate-pulse space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 rounded bg-gray-200" />
                  <div className="h-3 w-20 rounded bg-gray-200" />
                </div>
              </div>
              <div className="h-3 w-full rounded bg-gray-200" />
              <div className="h-8 w-full rounded-xl bg-gray-100 pt-2" />
            </div>
          ))}
        </div>
      ) : tab === 'customers' ? (
        filteredCustomers.length === 0 ? (
          <EmptyState
            title={language === 'ar' ? 'لا يوجد عملاء مطابقين للبحث' : 'No matching customers found'}
            action={openNewCustomer}
            actionLabel={language === 'ar' ? '+ إضافة عميل جديد' : '+ Add Customer'}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCustomers.map(c => {
              const co = c.companyId ? companyMap[c.companyId] : null;
              const allTags = [...(co?.tags || []), ...(c.tags || [])];
              const stats = orderStats(customerOrders(c.phone, c.id), taxRate);
              const balance = getCustomerAccountBalance(orders, c, taxRate);
              const gradient = getAvatarGradient(c.name);

              return (
                <motion.div
                  key={c.id}
                  whileHover={{ y: -3 }}
                  onClick={() => setProfileCustomer(c)}
                  className="bg-white rounded-2xl border border-gray-200/90 p-5 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden"
                >
                  <div className="space-y-3">
                    {/* Top Row: Avatar + Name + Balance Badge */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center font-black text-sm shadow-md shrink-0`}>
                          {getInitials(c.name)}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-extrabold text-gray-900 text-sm truncate group-hover:text-mocha-700 transition-colors">
                            {c.name}
                          </h3>
                          <p className="text-xs font-mono font-bold text-gray-500 flex items-center gap-1 mt-0.5" dir="ltr">
                            <Phone size={11} className="text-gray-400 shrink-0" />
                            <span>{c.phone}</span>
                          </p>
                        </div>
                      </div>

                      {/* Balance Badge */}
                      <div className="shrink-0">
                        {balance > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200/80 px-2.5 py-1 rounded-xl shadow-xs">
                            <Wallet size={10} />
                            <span>{language === 'ar' ? `عليه ${balance.toFixed(0)} ${currency}` : `Owes ${balance.toFixed(0)} ${currency}`}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-2 py-0.5 rounded-xl">
                            <Check size={10} />
                            <span>{language === 'ar' ? 'سليم' : 'Clear'}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Company Tag */}
                    {co && (
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-xl border border-purple-100">
                        <Building2 size={13} className="text-purple-600 shrink-0" />
                        <span className="truncate">{co.name}</span>
                      </div>
                    )}

                    {/* Tags & Loyalty */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {allTags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[10px] px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 font-semibold border border-gray-200/60">
                            {tag}
                          </span>
                        ))}
                        {allTags.length > 3 && (
                          <span className="text-[10px] text-gray-400 font-bold">+{allTags.length - 3}</span>
                        )}
                      </div>

                      {Boolean(c.points) && c.points > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200/60 px-2 py-0.5 rounded-lg shrink-0">
                          <Star size={10} className="fill-amber-500 text-amber-500" />
                          <span>{c.points} {language === 'ar' ? 'نقطة' : 'pts'}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Footer Metrics */}
                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <span className="font-semibold">{stats.paidOrders} {language === 'ar' ? 'طلب مكتمل' : 'paid orders'}</span>
                    <span className="font-extrabold text-gray-900">{stats.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )
      ) : filteredCompanies.length === 0 ? (
        <EmptyState
          title={language === 'ar' ? 'لا توجد شركات مطابقة للبحث' : 'No matching companies found'}
          action={openNewCompany}
          actionLabel={language === 'ar' ? '+ إضافة شركة' : '+ Add Company'}
          icon="building"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCompanies.map(co => {
            const members = companyMembers(co.id);
            const stats = orderStats(companyOrders(co.id), taxRate);
            const balance = getCompanyAccountBalance(
              orders, co.id, taxRate,
              members.map(m => m.phone),
              members.map(m => m.id),
              false
            );

            return (
              <motion.div
                key={co.id}
                whileHover={{ y: -3 }}
                onClick={() => setProfileCompany(co)}
                className="bg-white rounded-2xl border border-gray-200/90 p-5 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden"
              >
                <div className="space-y-3">
                  {/* Top Row: Icon + Name + Balance Badge */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-700 text-white flex items-center justify-center shadow-md shrink-0">
                        <Building2 size={24} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-extrabold text-gray-900 text-sm truncate group-hover:text-purple-700 transition-colors">
                          {co.name}
                        </h3>
                        {co.phone && (
                          <p className="text-xs font-mono font-bold text-gray-500 flex items-center gap-1 mt-0.5" dir="ltr">
                            <Phone size={11} className="text-gray-400 shrink-0" />
                            <span>{co.phone}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Balance Badge */}
                    <div className="shrink-0">
                      {balance > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200/80 px-2.5 py-1 rounded-xl shadow-xs">
                          <Wallet size={10} />
                          <span>{language === 'ar' ? `عليه ${balance.toFixed(0)} ${currency}` : `Owes ${balance.toFixed(0)} ${currency}`}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-2 py-0.5 rounded-xl">
                          <Check size={10} />
                          <span>{language === 'ar' ? 'سليم' : 'Clear'}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Company Tags */}
                  {(co.tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {co.tags.map(tag => (
                        <span key={tag} className="text-[10px] px-2 py-0.5 rounded-lg bg-purple-50 text-purple-700 font-bold border border-purple-100">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Card Footer Breakdown Grid */}
                <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-gray-50/80 p-2 rounded-xl border border-gray-100">
                    <p className="font-black text-gray-900">{members.length}</p>
                    <p className="text-[10px] text-gray-400 font-bold mt-0.5">{language === 'ar' ? 'عميل تابع' : 'Members'}</p>
                  </div>
                  <div className="bg-gray-50/80 p-2 rounded-xl border border-gray-100">
                    <p className="font-black text-gray-900">{stats.paidOrders}</p>
                    <p className="text-[10px] text-gray-400 font-bold mt-0.5">{language === 'ar' ? 'طلب مبيعات' : 'Orders'}</p>
                  </div>
                  <div className="bg-gray-50/80 p-2 rounded-xl border border-gray-100">
                    <p className="font-black text-mocha-800">{stats.revenue.toFixed(0)}</p>
                    <p className="text-[10px] text-gray-400 font-bold mt-0.5">{currency}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Customer Form Modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {customerFormOpen && (
          <ModalShell onClose={() => setCustomerFormOpen(false)} title={editingCustomer ? (language === 'ar' ? 'تعديل بيانات العميل' : 'Edit Customer') : (language === 'ar' ? 'تسجيل عميل جديد' : 'Register New Customer')} zLevel={9100}>
            <form onSubmit={saveCustomer} className="space-y-4 p-6">
              <Field label={t('Customer Name')}>
                <input required value={cForm.name} onChange={e => setCForm({ ...cForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-mocha-500/40 font-medium" placeholder={t('Customer Name')} />
              </Field>
              <Field label={t('Phone Number')}>
                <input required value={cForm.phone} onChange={e => setCForm({ ...cForm, phone: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-mocha-500/40 font-mono" placeholder={t('Enter customer phone')} />
              </Field>
              <Field label={t('Assign Company')}>
                <select value={cForm.companyId} onChange={e => setCForm({ ...cForm, companyId: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-mocha-500/40 font-medium">
                  <option value="">{language === 'ar' ? '— بدون شركة —' : '— No company —'}</option>
                  {companies.map(co => (
                    <option key={co.id} value={co.id}>{co.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('Tags')}>
                <input value={cForm.tags} onChange={e => setCForm({ ...cForm, tags: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-mocha-500/40 font-medium" placeholder={language === 'ar' ? 'مثال: VIP, توصيل' : 'e.g. VIP, delivery'} />
              </Field>
              <Field label={t('Notes')}>
                <textarea rows={2} value={cForm.notes} onChange={e => setCForm({ ...cForm, notes: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-mocha-500/40 resize-none font-medium" />
              </Field>
              <div className="flex gap-3 pt-3 border-t border-gray-100">
                <button type="button" onClick={() => setCustomerFormOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50">
                  {t('Cancel')}
                </button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-mocha-700 hover:bg-mocha-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-mocha-700/20">
                  <Save size={15} /> {t('Save')}
                </button>
              </div>
            </form>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ── Company Form Modal ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {companyFormOpen && (
          <ModalShell onClose={() => setCompanyFormOpen(false)} title={editingCompany ? (language === 'ar' ? 'تعديل بيانات الشركة' : 'Edit Company') : (language === 'ar' ? 'إضافة شركة جديدة' : 'Add Company')} zLevel={9100}>
            <form onSubmit={saveCompany} className="space-y-4 p-6">
              <Field label={t('Company Name')}>
                <input required value={coForm.name} onChange={e => setCoForm({ ...coForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-purple-500/40 font-medium" />
              </Field>
              <Field label={t('Phone Number')}>
                <input value={coForm.phone} onChange={e => setCoForm({ ...coForm, phone: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-purple-500/40 font-mono" />
              </Field>
              <Field label={t('Tags')}>
                <input value={coForm.tags} onChange={e => setCoForm({ ...coForm, tags: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-purple-500/40 font-medium" placeholder={language === 'ar' ? 'مثال: شركات, حساب آجل' : 'e.g. corporate, credit'} />
              </Field>
              <Field label={t('Notes')}>
                <textarea rows={2} value={coForm.notes} onChange={e => setCoForm({ ...coForm, notes: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-purple-500/40 resize-none font-medium" />
              </Field>
              <div className="flex gap-3 pt-3 border-t border-gray-100">
                <button type="button" onClick={() => setCompanyFormOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50">
                  {t('Cancel')}
                </button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-purple-700/20">
                  <Save size={15} /> {t('Save')}
                </button>
              </div>
            </form>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ── Customer Profile View Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {profileCustomer && (
          <ModalShell
            wide
            onClose={() => setProfileCustomer(null)}
            title={profileCustomer.name}
            actions={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditCustomer(profileCustomer)}
                  className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold flex items-center gap-1 transition-colors"
                >
                  <Edit3 size={13} /> {t('Edit')}
                </button>
                <button
                  type="button"
                  onClick={() => deleteCustomer(profileCustomer.id)}
                  className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold flex items-center gap-1 transition-colors border border-rose-200/60"
                >
                  <Trash2 size={13} /> {t('Delete')}
                </button>
              </div>
            }
          >
            <CustomerProfileDetail
              customer={profileCustomer}
              company={profileCustomer.companyId ? companyMap[profileCustomer.companyId] : undefined}
              orders={customerOrders(profileCustomer.phone, profileCustomer.id)}
              taxRate={taxRate}
              currency={currency}
              t={t}
              language={language}
              allOrders={orders}
              onDeleteOrder={deleteOrder}
            />

          </ModalShell>
        )}
      </AnimatePresence>

      {/* ── Company Profile View Modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {profileCompany && (
          <ModalShell
            wide
            onClose={() => setProfileCompany(null)}
            title={profileCompany.name}
            actions={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    printCompanyStatement({
                      companyName: profileCompany.name,
                      companyPhone: profileCompany.phone,
                      orders: companyOrders(profileCompany.id),
                      taxRate,
                      lang: language === 'ar' ? 'ar' : 'en',
                      resolveCustomerLabel: o =>
                        customers.find(c => c.id === o.customerId || c.phone === o.customerPhone)?.name ||
                        o.customerName ||
                        o.customerPhone ||
                        '—',
                    })
                  }
                  className="px-3 py-1.5 rounded-xl bg-purple-100 hover:bg-purple-200 text-purple-800 text-xs font-bold flex items-center gap-1.5 transition-colors"
                >
                  <Printer size={13} />
                  {language === 'ar' ? 'طباعة كشف حساب' : 'Print Statement'}
                </button>
                <button
                  type="button"
                  onClick={() => openEditCompany(profileCompany)}
                  className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold flex items-center gap-1 transition-colors"
                >
                  <Edit3 size={13} /> {t('Edit')}
                </button>
                <button
                  type="button"
                  onClick={() => deleteCompany(profileCompany.id)}
                  className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold flex items-center gap-1 transition-colors border border-rose-200/60"
                >
                  <Trash2 size={13} /> {t('Delete')}
                </button>
              </div>
            }
          >
            <CompanyProfileDetail
              company={profileCompany}
              members={companyMembers(profileCompany.id)}
              orders={companyOrders(profileCompany.id)}
              taxRate={taxRate}
              currency={currency}
              t={t}
              language={language}
              onOpenCustomer={c => {
                setProfileCompany(null);
                setProfileCustomer(c);
              }}
              allOrders={orders}
            />
          </ModalShell>
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title={deleteTarget?.type === 'customer' ? (language === 'ar' ? 'حذف العميل' : 'Delete Customer') : (language === 'ar' ? 'حذف الشركة' : 'Delete Company')}
        message={language === 'ar' ? 'هل أنت تأكد من رغبتك في الحذف نهائياً؟' : 'Are you sure you want to delete this record?'}
        confirmText={language === 'ar' ? 'نعم، حذف' : 'Yes, Delete'}
        cancelText={language === 'ar' ? 'إلغاء' : 'Cancel'}
        type="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ── Sub-components for Rich UI ───────────────────────────────────────────────

function StatCard({
  icon: Icon,
  title,
  value,
  subtitle,
  gradient,
  iconBg
}: {
  icon: any;
  title: string;
  value: string;
  subtitle: string;
  gradient: string;
  iconBg: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${gradient} p-4 sm:p-5 rounded-2xl border shadow-xs transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2.5 rounded-xl shadow-xs ${iconBg}`}>
          <Icon size={20} />
        </div>
      </div>
      <div>
        <h3 className="text-xl sm:text-2xl font-black tracking-tight">{value}</h3>
        <p className="text-xs font-extrabold opacity-90 mt-1">{title}</p>
        <p className="text-[10px] opacity-75 font-semibold mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyState({ title, action, actionLabel, icon }: { title: string; action: () => void; actionLabel: string; icon?: 'users' | 'building' }) {
  const Icon = icon === 'building' ? Building2 : Users;
  return (
    <div className="py-16 px-4 text-center bg-white rounded-2xl border border-dashed border-gray-200 shadow-xs space-y-3">
      <div className="w-14 h-14 rounded-2xl bg-mocha-50 text-mocha-600 flex items-center justify-center mx-auto">
        <Icon size={28} />
      </div>
      <p className="text-sm font-bold text-gray-700">{title}</p>
      <button onClick={action} className="px-5 py-2.5 rounded-xl bg-mocha-700 hover:bg-mocha-800 text-white text-xs font-bold shadow-md shadow-mocha-700/20 transition-all active:scale-95">
        {actionLabel}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-bold text-gray-700">{label}</label>
      {children}
    </div>
  );
}

function ModalShell({
  children, onClose, title, actions, wide, zLevel = 9000,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  actions?: React.ReactNode;
  wide?: boolean;
  zLevel?: number;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ zIndex: zLevel }}
    >
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
        className={clsx(
          'relative bg-white w-full shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col',
          wide ? 'max-w-3xl sm:rounded-3xl' : 'max-w-lg sm:rounded-3xl',
          'rounded-t-3xl sm:rounded-b-3xl'
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-150 bg-gray-50/50">
          <h3 className="font-extrabold text-gray-900 text-base">{title}</h3>
          <div className="flex items-center gap-2">
            {actions}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-200/60 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </motion.div>
    </div>,
    document.body
  );
}

function CustomerProfileDetail({
  customer, company, orders, taxRate, currency, t, language, allOrders, onDeleteOrder,
}: {
  customer: Customer;
  company?: Company;
  orders: Order[];
  taxRate: number;
  currency: string;
  t: (k: string) => string;
  language: string;
  allOrders: Order[];
  onDeleteOrder: (id: string) => Promise<void>;
}) {
  const stats = orderStats(orders, taxRate);
  const balance = getCustomerAccountBalance(allOrders, customer, taxRate);
  const openInvoices = getCustomerOpenInvoices(allOrders, customer);
  const gradient = getAvatarGradient(customer.name);

  return (
    <div className="p-6 space-y-6">
      {/* Top Header Card */}
      <div className="flex items-start gap-4 p-4 rounded-2xl bg-gradient-to-br from-gray-50 to-mocha-50/30 border border-mocha-100/60">
        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center font-black text-lg shadow-md shrink-0`}>
          {getInitials(customer.name)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-black text-gray-900">{customer.name}</h3>
          <p className="text-xs font-mono font-bold text-gray-600 flex items-center gap-1 mt-1" dir="ltr">
            <Phone size={13} className="text-gray-400" /> {customer.phone}
          </p>
          {company && (
            <p className="text-xs font-bold text-purple-700 flex items-center gap-1 mt-1">
              <Building2 size={13} /> {company.name}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          {balance > 0 ? (
            <div className="bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl text-right">
              <p className="text-xs font-extrabold text-rose-700">{language === 'ar' ? 'رصيد مستحق' : 'Due Balance'}</p>
              <p className="text-base font-black text-rose-800">{balance.toFixed(2)} {currency}</p>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl text-right">
              <p className="text-xs font-bold text-emerald-700">{language === 'ar' ? 'حالة الحساب' : 'Account Status'}</p>
              <p className="text-sm font-black text-emerald-800">{language === 'ar' ? 'سليم (لا يوجد دين)' : 'Clear'}</p>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniMetric label={t('Total Orders')} value={String(stats.totalOrders)} />
        <MiniMetric label={t('Paid Orders')} value={String(stats.paidOrders)} />
        <MiniMetric label={t('Total Spent')} value={`${stats.revenue.toFixed(0)} ${currency}`} />
        <MiniMetric label={language === 'ar' ? 'نقاط الولاء' : 'Loyalty Points'} value={`${customer.points || 0} pts`} />
      </div>

      {/* Action: Print Customer Statement */}
      {orders.length > 0 && (
        <button
          type="button"
          onClick={() =>
            printCustomerStatement({
              customerName: customer.name,
              customerPhone: customer.phone,
              orders,
              taxRate,
              lang: language === 'ar' ? 'ar' : 'en',
            })
          }
          className="w-full py-2.5 rounded-xl bg-mocha-50 hover:bg-mocha-100 text-mocha-900 border border-mocha-200 font-bold text-xs flex items-center justify-center gap-2 transition-colors"
        >
          <Printer size={15} />
          <span>{language === 'ar' ? `طباعة كشف حساب كلي للعميل «${customer.name}»` : `Print complete customer statement`}</span>
        </button>
      )}

      {/* Open Receivables Invoices */}
      {openInvoices.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-black text-rose-700 uppercase tracking-wider">
            {language === 'ar' ? 'فواتير آجلة غير مسددة على العميل' : 'Open Receivable Invoices'}
          </h4>
          <div className="divide-y divide-rose-100 border border-rose-200/80 rounded-2xl overflow-hidden bg-rose-50/20">
            {openInvoices.map(o => (
              <div key={o.id} className="flex items-center justify-between p-3 text-xs">
                <div>
                  <p className="font-extrabold text-gray-900">#{formatOrderNumber(o)}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{new Date(o.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-rose-700 text-sm">{getOrderGrandTotal(o, taxRate).toFixed(2)} {currency}</span>
                  <button
                    onClick={() => printCustomerReceipt(o, language === 'ar' ? 'ar' : 'en')}
                    className="p-1.5 rounded-lg text-rose-700 hover:bg-rose-100 transition-colors"
                    title={t('Print Receipt')}
                  >
                    <Printer size={15} />
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (window.confirm(language === 'ar' ? `هل أنت تأكد من حذف الفاتورة #${formatOrderNumber(o)} نهائياً؟` : `Are you sure you want to delete invoice #${formatOrderNumber(o)}?`)) {
                        await onDeleteOrder(o.id);
                      }
                    }}
                    className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-200/80 hover:text-rose-900 transition-colors"
                    title={language === 'ar' ? 'حذف الفاتورة' : 'Delete Invoice'}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Orders History Table */}
      <div className="space-y-2">
        <h4 className="text-xs font-black text-gray-700 uppercase tracking-wider">
          {language === 'ar' ? 'سجل كافة المعاملات' : 'Transaction History'}
        </h4>
        {orders.length === 0 ? (
          <p className="text-xs text-gray-400 py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            {language === 'ar' ? 'لا توجد معاملات سابقة لهذا العميل' : 'No order history for this customer'}
          </p>
        ) : (
          <div className="divide-y divide-gray-150 border border-gray-200 rounded-2xl overflow-hidden max-h-64 overflow-y-auto">
            {orders.slice(0, 50).map(o => (
              <div key={o.id} className="flex items-center justify-between p-3 bg-white hover:bg-gray-50/80 transition-colors text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900">#{formatOrderNumber(o)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{new Date(o.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="font-extrabold text-gray-900">{getOrderGrandTotal(o, taxRate).toFixed(2)} {currency}</p>
                    <p className={clsx(
                      'text-[10px] font-extrabold mt-0.5',
                      o.paymentStatus === 'Paid' ? 'text-emerald-600'
                      : o.paymentStatus === 'OnAccount' ? 'text-rose-600'
                      : 'text-amber-600'
                    )}>
                      {o.paymentStatus === 'OnAccount' ? (language === 'ar' ? 'على الحساب' : 'On Account') : o.paymentStatus}
                    </p>
                  </div>
                  <button
                    onClick={() => printCustomerReceipt(o, language === 'ar' ? 'ar' : 'en')}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-mocha-700 hover:bg-mocha-50 transition-colors"
                    title={t('Print Receipt')}
                  >
                    <Printer size={15} />
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (window.confirm(language === 'ar' ? `هل أنت تأكد من حذف الفاتورة #${formatOrderNumber(o)} نهائياً؟` : `Are you sure you want to delete invoice #${formatOrderNumber(o)}?`)) {
                        await onDeleteOrder(o.id);
                      }
                    }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    title={language === 'ar' ? 'حذف الفاتورة' : 'Delete Invoice'}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function CompanyProfileDetail({
  company, members, orders, taxRate, currency, t, language, onOpenCustomer, allOrders,
}: {
  company: Company;
  members: Customer[];
  orders: Order[];
  taxRate: number;
  currency: string;
  t: (k: string) => string;
  language: string;
  onOpenCustomer: (c: Customer) => void;
  allOrders: Order[];
}) {
  const stats = orderStats(orders, taxRate);
  const balance = getCompanyAccountBalance(
    allOrders, company.id, taxRate,
    members.map(m => m.phone),
    members.map(m => m.id),
    false
  );
  const openInvoices = getCompanyOpenInvoices(
    allOrders, company.id,
    members.map(m => m.phone),
    members.map(m => m.id),
    false
  );

  return (
    <div className="p-6 space-y-6">
      {/* Top Company Banner Card */}
      <div className="flex items-start gap-4 p-4 rounded-2xl bg-gradient-to-br from-purple-50 to-indigo-50/40 border border-purple-100">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-700 text-white flex items-center justify-center shadow-md shrink-0">
          <Building2 size={28} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-black text-gray-900">{company.name}</h3>
          {company.phone && (
            <p className="text-xs font-mono font-bold text-gray-600 flex items-center gap-1 mt-1" dir="ltr">
              <Phone size={13} className="text-gray-400" /> {company.phone}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          {balance > 0 ? (
            <div className="bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl text-right">
              <p className="text-xs font-extrabold text-rose-700">{language === 'ar' ? 'رصيد الشركة المستحق' : 'Due Company Balance'}</p>
              <p className="text-base font-black text-rose-800">{balance.toFixed(2)} {currency}</p>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl text-right">
              <p className="text-xs font-bold text-emerald-700">{language === 'ar' ? 'حالة حساب الشركة' : 'Account Status'}</p>
              <p className="text-sm font-black text-emerald-800">{language === 'ar' ? 'سليم (لا يوجد دين)' : 'Clear'}</p>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniMetric label={language === 'ar' ? 'العملاء التابعون' : 'Affiliated Members'} value={String(members.length)} />
        <MiniMetric label={t('Total Orders')} value={String(stats.totalOrders)} />
        <MiniMetric label={t('Total Revenue')} value={`${stats.revenue.toFixed(0)} ${currency}`} />
        <MiniMetric label={language === 'ar' ? 'الديون المفتوحة' : 'Company Due'} value={`${balance.toFixed(0)} ${currency}`} />
      </div>

      {/* Open Company Invoices */}
      {openInvoices.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-black text-rose-700 uppercase tracking-wider">
            {language === 'ar' ? 'فواتير آجلة مفتوحة على حساب الشركة' : 'Open Corporate Invoices'}
          </h4>
          <div className="divide-y divide-rose-100 border border-rose-200/80 rounded-2xl overflow-hidden bg-rose-50/20">
            {openInvoices.map(o => (
              <div key={o.id} className="flex items-center justify-between p-3 text-xs">
                <div>
                  <p className="font-extrabold text-gray-900">#{formatOrderNumber(o)}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {o.customerName || members.find(m => m.id === o.customerId || m.phone === o.customerPhone)?.name || o.customerPhone || '—'} · {new Date(o.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-black text-rose-700 text-sm">{getOrderGrandTotal(o, taxRate).toFixed(2)} {currency}</span>
                  <button
                    onClick={() => printCustomerReceipt(o, language === 'ar' ? 'ar' : 'en')}
                    className="p-1.5 rounded-lg text-rose-700 hover:bg-rose-100 transition-colors"
                    title={t('Print Receipt')}
                  >
                    <Printer size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Affiliated Members List */}
      <div className="space-y-2">
        <h4 className="text-xs font-black text-gray-700 uppercase tracking-wider">
          {language === 'ar' ? 'قائمة العملاء المنسوبين للشركة' : 'Affiliated Members'}
        </h4>
        {members.length === 0 ? (
          <p className="text-xs text-gray-400 py-6 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            {language === 'ar' ? 'لا يوجد عملاء منسوبون لهذه الشركة بعد' : 'No members linked to this company yet'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {members.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpenCustomer(m)}
                className="flex items-center justify-between p-3 rounded-xl border border-gray-200/80 hover:border-purple-300 hover:bg-purple-50/30 transition-all text-left group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs shrink-0">
                    {getInitials(m.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-900 truncate group-hover:text-purple-700 transition-colors">{m.name}</p>
                    <p className="text-[10px] font-mono text-gray-400">{m.phone}</p>
                  </div>
                </div>
                <span className="text-[11px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg shrink-0">
                  {m.points || 0} pts
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50/90 rounded-2xl p-3.5 text-center border border-gray-150 shadow-xs">
      <p className="text-base font-black text-gray-900 truncate">{value}</p>
      <p className="text-[10px] text-gray-400 font-extrabold mt-0.5 uppercase tracking-wide">{label}</p>
    </div>
  );
}
