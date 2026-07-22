import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Building2, Plus, Search, Phone, Tag, X, Save,
  ShoppingBag, Trash2, Edit3, UserCircle, BarChart3, Printer
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

function accountBalanceLabel(amount: number, currency: string, language: string) {
  if (amount <= 0) return language === 'ar' ? 'لا يوجد دين' : 'No balance due';
  return language === 'ar'
    ? `عليه ${amount.toFixed(2)} ${currency}`
    : `Owes ${amount.toFixed(2)} ${currency}`;
}

export default function CustomersPage({ managerMode = false }: CustomersPageProps) {
  const { t, language } = useLanguage();
  const { user, branch } = useAuth();
  const { orders } = useOrders();
  const taxRate = getTaxRate();
  const branchId = branch?.branchId === 'manager' ? undefined : branch?.branchId;

  const [tab, setTab] = useState<Tab>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Forms / profiles
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [companyFormOpen, setCompanyFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [profileCustomer, setProfileCustomer] = useState<Customer | null>(null);
  const [profileCompany, setProfileCompany] = useState<Company | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, cos] = await Promise.all([
        customersService.getAll(branchId),
        companiesService.getAll(branchId),
      ]);
      setCustomers(c);
      setCompanies(cos);
    } catch (e) {
      console.error(e);
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
      // Explicit company-billed + member history (normalized phone match)
      const members = customers.filter(c => c.companyId === companyId);
      const phones = new Set(
        members.map(c => (c.phone || '').replace(/[\s\-()]/g, '').trim()).filter(Boolean)
      );
      const ids = new Set(members.map(c => c.id).filter(Boolean));
      return orders
        .filter(o => {
          if (o.companyId === companyId && (o.billedToType === 'company' || o.companyName)) {
            return true;
          }
          if (o.customerId && ids.has(o.customerId)) return true;
          if (o.customerPhone) {
            const p = o.customerPhone.replace(/[\s\-()]/g, '').trim();
            if (phones.has(p)) return true;
          }
          return false;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    [customers, orders]
  );

  const companyRevenue = useCallback(
    (companyId: string) => orderStats(companyOrders(companyId), taxRate).revenue,
    [companyOrders, taxRate]
  );

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

  const toast = useToast();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'customer' | 'company' } | null>(null);

  const saveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cForm.phone.trim()) {
      toast.error(t('Enter customer phone'));
      return;
    }
    try {
      await customersService.save(
        {
          id: editingCustomer?.id,
          name: cForm.name.trim() || 'عميل',
          phone: cForm.phone.trim(),
          points: 0,
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

  const confirmDeleteAction = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'customer') {
        await customersService.delete(deleteTarget.id);
        setProfileCustomer(null);
        toast.success(language === 'ar' ? 'تم حذف العميل' : 'Customer deleted');
      } else {
        const members = companyMembers(deleteTarget.id);
        for (const m of members) {
          await customersService.save({ ...m, phone: m.phone, companyId: undefined }, branchId);
        }
        await companiesService.delete(deleteTarget.id);
        setProfileCompany(null);
        toast.success(language === 'ar' ? 'تم حذف الشركة' : 'Company deleted');
      }
      await load();
    } catch (err) {
      toast.error(language === 'ar' ? 'فشل الحذف' : 'Delete failed');
    } finally {
      setDeleteTarget(null);
    }
  };

  const openNewCompany = () => {
    setEditingCompany(null);
    setCoForm({ name: '', phone: '', tags: '', notes: '' });
    setCompanyFormOpen(true);
  };

  const openEditCompany = (c: Company) => {
    setEditingCompany(c);
    setCoForm({
      name: c.name,
      phone: c.phone || '',
      tags: tagsToString(c.tags),
      notes: c.notes || '',
    });
    setCompanyFormOpen(true);
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

  const currency = language === 'ar' ? 'ج.م' : 'EGP';

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      {!managerMode && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 flex items-center gap-2">
              <Users className="text-mocha-600" size={24} />
              {t('Customers')}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('Manage loyalty points and profiles')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={openNewCompany}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              <Building2 size={14} />
              {t('Add Company')}
            </button>
            <button
              onClick={openNewCustomer}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-mocha-700 text-white text-xs font-bold hover:bg-mocha-800 shadow-sm"
            >
              <Plus size={14} />
              {t('Add Customer')}
            </button>
          </div>
        </div>
      )}

      {managerMode && (
        <div className="flex flex-wrap gap-2 justify-end">
          <button onClick={openNewCompany} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50">
            <Building2 size={14} /> {t('Add Company')}
          </button>
          <button onClick={openNewCustomer} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-mocha-700 text-white text-xs font-bold hover:bg-mocha-800">
            <Plus size={14} /> {t('Add Customer')}
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatMini icon={Users} label={t('Total Registered')} value={String(customers.length)} color="blue" />
        <StatMini icon={Building2} label={t('Total Companies')} value={String(companies.length)} color="purple" />
        <StatMini icon={ShoppingBag} label={t('Linked Orders')} value={String(orders.filter(o => o.customerPhone).length)} color="green" />
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col tablet:flex-row gap-3 items-stretch tablet:items-center">
        <div className="flex bg-white rounded-xl border border-gray-200 p-1 shadow-sm w-fit">
          <button
            onClick={() => setTab('customers')}
            className={clsx(
              'px-4 py-2 rounded-lg text-xs font-bold transition-all',
              tab === 'customers' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'
            )}
          >
            {t('Customers')}
          </button>
          <button
            onClick={() => setTab('companies')}
            className={clsx(
              'px-4 py-2 rounded-lg text-xs font-bold transition-all',
              tab === 'companies' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'
            )}
          >
            {t('Companies')}
          </button>
        </div>
        <div className="relative flex-1 max-w-full tablet:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('Search by phone or name...')}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:ring-2 focus:ring-caramel/40 outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</div>
      ) : tab === 'customers' ? (
        filteredCustomers.length === 0 ? (
          <EmptyState
            title={language === 'ar' ? 'لا يوجد عملاء' : 'No customers yet'}
            action={openNewCustomer}
            actionLabel={t('Add Customer')}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {filteredCustomers.map(c => {
              const co = c.companyId ? companyMap[c.companyId] : null;
              const allTags = [...(co?.tags || []), ...(c.tags || [])];
              const stats = orderStats(customerOrders(c.phone, c.id), taxRate);
              const balance = getCustomerAccountBalance(orders, c, taxRate);
              return (
                <motion.button
                  key={c.id}
                  type="button"
                  whileHover={{ y: -2 }}
                  onClick={() => setProfileCustomer(c)}
                  className="text-left bg-white rounded-2xl border border-gray-200/80 p-4 shadow-sm hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2.5 rounded-xl bg-mocha-50 text-mocha-700 shrink-0">
                        <UserCircle size={22} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-extrabold text-gray-900 truncate">{c.name}</p>
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <Phone size={11} /> {c.phone}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {balance > 0 && (
                        <span className="text-[10px] font-black bg-red-50 text-red-700 border border-red-100 px-2 py-0.5 rounded-lg">
                          {language === 'ar' ? `عليه ${balance.toFixed(0)}` : `Owes ${balance.toFixed(0)}`}
                        </span>
                      )}
                    </div>
                  </div>
                  {co && (
                    <p className="mt-2 text-[11px] font-bold text-mocha-700 flex items-center gap-1">
                      <Building2 size={12} /> {co.name}
                    </p>
                  )}
                  {allTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {allTags.slice(0, 4).map(tag => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 font-semibold">
                          {tag}
                        </span>
                      ))}
                      {allTags.length > 4 && (
                        <span className="text-[10px] text-gray-400">+{allTags.length - 4}</span>
                      )}
                    </div>
                  )}
                  <div className="mt-3 pt-2 border-t border-gray-100 flex justify-between text-[11px] text-gray-400">
                    <span>{stats.paidOrders} {t('Paid orders')}</span>
                    <span className="font-bold text-gray-700">{stats.revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}</span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )
      ) : filteredCompanies.length === 0 ? (
        <EmptyState
          title={language === 'ar' ? 'لا توجد شركات' : 'No companies yet'}
          action={openNewCompany}
          actionLabel={t('Add Company')}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {filteredCompanies.map(co => {
            const members = companyMembers(co.id);
            const stats = orderStats(companyOrders(co.id), taxRate);
            const balance = getCompanyAccountBalance(
              orders,
              co.id,
              taxRate,
              members.map(m => m.phone),
              members.map(m => m.id),
              true
            );
            return (
              <motion.button
                key={co.id}
                type="button"
                whileHover={{ y: -2 }}
                onClick={() => setProfileCompany(co)}
                className="text-left bg-white rounded-2xl border border-gray-200/80 p-4 shadow-sm hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 rounded-xl bg-purple-50 text-purple-700">
                      <Building2 size={22} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-extrabold text-gray-900 truncate">{co.name}</p>
                      {co.phone && (
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <Phone size={11} /> {co.phone}
                        </p>
                      )}
                    </div>
                  </div>
                  {balance > 0 && (
                    <span className="text-[10px] font-black bg-red-50 text-red-700 border border-red-100 px-2 py-0.5 rounded-lg shrink-0">
                      {language === 'ar' ? `عليه ${balance.toFixed(0)}` : `Owes ${balance.toFixed(0)}`}
                    </span>
                  )}
                </div>
                {(co.tags || []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {co.tags.map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 font-semibold border border-purple-100">
                        <Tag size={9} className="inline mr-0.5" />{tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-gray-100 grid grid-cols-3 gap-1 text-center">
                  <div>
                    <p className="text-sm font-black text-gray-900">{members.length}</p>
                    <p className="text-[10px] text-gray-400">{t('Affiliated')}</p>
                  </div>
                  <div>
                    <p className="text-sm font-black text-gray-900">{stats.paidOrders}</p>
                    <p className="text-[10px] text-gray-400">{t('Orders')}</p>
                  </div>
                  <div>
                    <p className={clsx('text-sm font-black', balance > 0 ? 'text-red-600' : 'text-gray-900')}>
                      {balance > 0 ? balance.toFixed(0) : stats.revenue.toFixed(0)}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {balance > 0
                        ? (language === 'ar' ? 'رصيد' : 'Due')
                        : currency}
                    </p>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* Customer Form Modal */}
      <AnimatePresence>
        {customerFormOpen && (
          <ModalShell onClose={() => setCustomerFormOpen(false)} title={editingCustomer ? t('Edit Customer') : t('Register New Customer')}>
            <form onSubmit={saveCustomer} className="space-y-3 p-5">
              <Field label={t('Customer Name')}>
                <input required value={cForm.name} onChange={e => setCForm({ ...cForm, name: e.target.value })}
                  className="field-input" placeholder={t('Customer Name')} />
              </Field>
              <Field label={t('Phone Number')}>
                <input required value={cForm.phone} onChange={e => setCForm({ ...cForm, phone: e.target.value })}
                  className="field-input" placeholder={t('Enter customer phone')} />
              </Field>
              <Field label={t('Assign Company')}>
                <select value={cForm.companyId} onChange={e => setCForm({ ...cForm, companyId: e.target.value })}
                  className="field-input">
                  <option value="">{language === 'ar' ? '— بدون شركة —' : '— No company —'}</option>
                  {companies.map(co => (
                    <option key={co.id} value={co.id}>{co.name}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('Tags')}>
                <input value={cForm.tags} onChange={e => setCForm({ ...cForm, tags: e.target.value })}
                  className="field-input" placeholder={language === 'ar' ? 'مثال: VIP, توصيل' : 'e.g. VIP, delivery'} />
              </Field>
              <Field label={t('Notes')}>
                <textarea rows={2} value={cForm.notes} onChange={e => setCForm({ ...cForm, notes: e.target.value })}
                  className="field-input resize-none" />
              </Field>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setCustomerFormOpen(false)} className="flex-1 py-2.5 rounded-xl border text-sm font-bold text-gray-600">
                  {t('Cancel')}
                </button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-mocha-700 text-white text-sm font-bold flex items-center justify-center gap-1">
                  <Save size={14} /> {t('Save')}
                </button>
              </div>
            </form>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Company Form Modal */}
      <AnimatePresence>
        {companyFormOpen && (
          <ModalShell onClose={() => setCompanyFormOpen(false)} title={editingCompany ? t('Edit Company') : t('Add Company')}>
            <form onSubmit={saveCompany} className="space-y-3 p-5">
              <Field label={t('Company Name')}>
                <input required value={coForm.name} onChange={e => setCoForm({ ...coForm, name: e.target.value })}
                  className="field-input" />
              </Field>
              <Field label={t('Phone Number')}>
                <input value={coForm.phone} onChange={e => setCoForm({ ...coForm, phone: e.target.value })}
                  className="field-input" />
              </Field>
              <Field label={t('Tags')}>
                <input value={coForm.tags} onChange={e => setCoForm({ ...coForm, tags: e.target.value })}
                  className="field-input" placeholder={language === 'ar' ? 'مثال: شركات, حساب آجل' : 'e.g. corporate, credit'} />
              </Field>
              <Field label={t('Notes')}>
                <textarea rows={2} value={coForm.notes} onChange={e => setCoForm({ ...coForm, notes: e.target.value })}
                  className="field-input resize-none" />
              </Field>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setCompanyFormOpen(false)} className="flex-1 py-2.5 rounded-xl border text-sm font-bold text-gray-600">
                  {t('Cancel')}
                </button>
                <button type="submit" className="flex-1 py-2.5 rounded-xl bg-mocha-700 text-white text-sm font-bold flex items-center justify-center gap-1">
                  <Save size={14} /> {t('Save')}
                </button>
              </div>
            </form>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Customer Profile */}
      <AnimatePresence>
        {profileCustomer && (
          <ModalShell
            wide
            onClose={() => setProfileCustomer(null)}
            title={t('Customer Details')}
            actions={
              <>
                <button
                  type="button"
                  title={language === 'ar' ? 'طباعة كشف حساب العميل' : 'Print customer statement'}
                  onClick={() => {
                    printCustomerStatement({
                      customerName: profileCustomer.name,
                      customerPhone: profileCustomer.phone,
                      orders: customerOrders(profileCustomer.phone, profileCustomer.id),
                      taxRate,
                      lang: language === 'ar' ? 'ar' : 'en',
                    });
                  }}
                  className="p-2 rounded-lg hover:bg-mocha-50 text-mocha-700"
                >
                  <Printer size={16} />
                </button>
                <button onClick={() => openEditCustomer(profileCustomer)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">
                  <Edit3 size={16} />
                </button>
                <button onClick={() => deleteCustomer(profileCustomer.id)} className="p-2 rounded-lg hover:bg-red-50 text-red-500">
                  <Trash2 size={16} />
                </button>
              </>
            }
          >
            <CustomerProfile
              customer={profileCustomer}
              company={profileCustomer.companyId ? companyMap[profileCustomer.companyId] : null}
              orders={customerOrders(profileCustomer.phone, profileCustomer.id)}
              taxRate={taxRate}
              currency={currency}
              t={t}
              language={language}
              onOpenCompany={id => {
                const co = companyMap[id];
                if (co) {
                  setProfileCustomer(null);
                  setProfileCompany(co);
                }
              }}
            />
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Company Profile */}
      <AnimatePresence>
        {profileCompany && (
          <ModalShell
            wide
            onClose={() => setProfileCompany(null)}
            title={t('Company Profile')}
            actions={
              <>
                <button
                  type="button"
                  title={language === 'ar' ? 'طباعة كشف حساب الشركة' : 'Print company statement'}
                  onClick={() => {
                    const members = companyMembers(profileCompany.id);
                    const open = getCompanyOpenInvoices(
                      orders,
                      profileCompany.id,
                      members.map(m => m.phone),
                      members.map(m => m.id),
                      true
                    );
                    printCompanyStatement({
                      companyName: profileCompany.name,
                      companyPhone: profileCompany.phone,
                      orders: open,
                      taxRate,
                      lang: language === 'ar' ? 'ar' : 'en',
                      resolveCustomerLabel: o =>
                        o.customerName ||
                        members.find(m => m.id === o.customerId || m.phone === o.customerPhone)?.name ||
                        o.customerPhone ||
                        '—',
                    });
                  }}
                  className="p-2 rounded-lg hover:bg-purple-50 text-purple-700"
                >
                  <Printer size={16} />
                </button>
                <button onClick={() => openEditCompany(profileCompany)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">
                  <Edit3 size={16} />
                </button>
                <button onClick={() => deleteCompany(profileCompany.id)} className="p-2 rounded-lg hover:bg-red-50 text-red-500">
                  <Trash2 size={16} />
                </button>
              </>
            }
          >
            <CompanyProfile
              company={profileCompany}
              members={companyMembers(profileCompany.id)}
              orders={companyOrders(profileCompany.id)}
              allOrders={orders}
              taxRate={taxRate}
              currency={currency}
              t={t}
              language={language}
              onOpenCustomer={c => {
                setProfileCompany(null);
                setProfileCustomer(c);
              }}
            />
          </ModalShell>
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title={deleteTarget?.type === 'customer' ? (language === 'ar' ? 'حذف العميل' : 'Delete Customer') : (language === 'ar' ? 'حذف الشركة' : 'Delete Company')}
        message={deleteTarget?.type === 'customer' ? (language === 'ar' ? 'هل أنت تأكد من حذف هذا العميل؟' : 'Are you sure you want to delete this customer?') : (language === 'ar' ? 'هل أنت تأكد من حذف هذه الشركة؟' : 'Are you sure you want to delete this company?')}
        confirmText={t('Delete')}
        cancelText={t('Cancel')}
        onConfirm={confirmDeleteAction}
        onCancel={() => setDeleteTarget(null)}
      />

      <style>{`
        .field-input {
          width: 100%;
          padding: 0.55rem 0.75rem;
          border-radius: 0.75rem;
          border: 1px solid #e5e7eb;
          font-size: 0.875rem;
          outline: none;
          background: white;
        }
        .field-input:focus {
          box-shadow: 0 0 0 2px rgba(200, 159, 122, 0.35);
        }
      `}</style>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function StatMini({
  icon: Icon, label, value, color,
}: { icon: any; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    amber: 'bg-amber-50 text-amber-600',
    green: 'bg-green-50 text-green-600',
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 p-3 md:p-4 shadow-sm">
      <div className={`inline-flex p-2 rounded-xl mb-2 ${colors[color] || colors.blue}`}>
        <Icon size={16} />
      </div>
      <p className="text-lg md:text-xl font-black text-gray-900">{value}</p>
      <p className="text-[10px] md:text-xs text-gray-400 font-semibold mt-0.5">{label}</p>
    </div>
  );
}

function EmptyState({ title, action, actionLabel }: { title: string; action: () => void; actionLabel: string }) {
  return (
    <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-gray-200">
      <Users className="mx-auto text-gray-300 mb-3" size={36} />
      <p className="text-sm text-gray-400 mb-3">{title}</p>
      <button onClick={action} className="px-4 py-2 rounded-xl bg-mocha-700 text-white text-xs font-bold">
        {actionLabel}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalShell({
  children, onClose, title, actions, wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  actions?: React.ReactNode;
  wide?: boolean;
}) {
  // Portal to <body> with an explicit inline z-index BELOW ConfirmDialog
  // (ConfirmDialog uses zIndex: 100000). Inline style avoids Tailwind purge /
  // stacking-context surprises when multiple overlays are open.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ zIndex: 9000 }}
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
          'rounded-t-2xl sm:rounded-2xl',
          wide ? 'max-w-2xl tablet:max-w-3xl' : 'max-w-md tablet:max-w-lg'
        )}
        style={{ zIndex: 1 }}
      >
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60 shrink-0">
          <h2 className="text-base font-extrabold text-gray-900">{title}</h2>
          <div className="flex items-center gap-1">
            {actions}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
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

function CustomerProfile({
  customer, company, orders, taxRate, currency, t, language, onOpenCompany,
}: {
  customer: Customer;
  company: Company | null;
  orders: Order[];
  taxRate: number;
  currency: string;
  t: (k: string) => string;
  language: string;
  onOpenCompany: (id: string) => void;
}) {
  const stats = orderStats(orders, taxRate);
  const allTags = [...(company?.tags || []), ...(customer.tags || [])];
  const balance = getCustomerAccountBalance(orders, customer, taxRate);
  const openInvoices = getCustomerOpenInvoices(orders, customer);

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start gap-3">
        <div className="p-3 rounded-2xl bg-mocha-50 text-mocha-700">
          <UserCircle size={28} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-black text-gray-900">{customer.name}</h3>
          <p className="text-sm text-gray-500 flex items-center gap-1"><Phone size={13} /> {customer.phone}</p>
          <p className={clsx(
            'text-sm font-black mt-1',
            balance > 0 ? 'text-red-600' : 'text-green-600'
          )}>
            {accountBalanceLabel(balance, currency, language)}
          </p>
        </div>
      </div>

      {company && (
        <button
          type="button"
          onClick={() => onOpenCompany(company.id)}
          className="w-full flex items-center gap-2 p-3 rounded-xl bg-purple-50 border border-purple-100 text-left hover:bg-purple-100/60"
        >
          <Building2 size={16} className="text-purple-700" />
          <div>
            <p className="text-xs text-purple-500 font-semibold">{t('Company')}</p>
            <p className="text-sm font-bold text-purple-900">{company.name}</p>
          </div>
        </button>
      )}

      {allTags.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-500 mb-1.5">{t('Tags')}</p>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map(tag => (
              <span key={tag} className="text-[11px] px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 font-semibold">{tag}</span>
            ))}
          </div>
        </div>
      )}

      {customer.notes && (
        <p className="text-xs text-gray-500 bg-gray-50 p-3 rounded-xl">{customer.notes}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MiniMetric label={t('Orders')} value={String(stats.totalOrders)} />
        <MiniMetric label={t('Paid orders')} value={String(stats.paidOrders)} />
        <MiniMetric label={t('Revenue')} value={`${stats.revenue.toFixed(2)} ${currency}`} />
        <MiniMetric
          label={language === 'ar' ? 'رصيد عليه' : 'Balance due'}
          value={`${balance.toFixed(2)} ${currency}`}
        />
      </div>

      {openInvoices.length > 0 && (
        <div>
          <h4 className="text-sm font-extrabold text-red-700 mb-2">
            {language === 'ar' ? 'فواتير مفتوحة على الحساب' : 'Open account invoices'}
          </h4>
          <div className="divide-y divide-red-50 border border-red-100 rounded-xl overflow-hidden bg-red-50/30">
            {openInvoices.map(o => (
              <div key={o.id} className="flex items-center justify-between px-3 py-2.5 text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-gray-800 truncate">#{formatOrderNumber(o)}</p>
                  <p className="text-gray-400">{o.tableId} · {new Date(o.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="font-extrabold text-red-700">
                    {getOrderGrandTotal(o, taxRate).toFixed(2)} {currency}
                  </p>
                  <button
                    type="button"
                    title={language === 'ar' ? 'طباعة الفاتورة' : 'Print Invoice'}
                    onClick={(e) => {
                      e.stopPropagation();
                      printCustomerReceipt(o, language === 'ar' ? 'ar' : 'en');
                    }}
                    className="p-1.5 rounded-lg hover:bg-red-100/60 text-red-700 transition-colors"
                  >
                    <Printer size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-extrabold text-gray-900 mb-2 flex items-center gap-1.5">
          <BarChart3 size={14} /> {t('Customer Transactions')}
        </h4>
        {orders.length === 0 ? (
          <p className="text-xs text-gray-400 py-6 text-center bg-gray-50 rounded-xl">
            {language === 'ar' ? 'لا توجد معاملات مرتبطة بهذا الهاتف بعد' : 'No transactions linked to this phone yet'}
          </p>
        ) : (
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
            {orders.slice(0, 30).map(o => (
              <div key={o.id} className="flex items-center justify-between px-3 py-2.5 bg-white text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-gray-800 truncate">#{formatOrderNumber(o)}</p>
                  <p className="text-gray-400">{o.tableId} · {new Date(o.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="font-extrabold text-gray-900">{getOrderGrandTotal(o, taxRate).toFixed(2)} {currency}</p>
                    <p className={clsx(
                      'text-[10px] font-bold',
                      o.paymentStatus === 'Paid' ? 'text-green-600' :
                      o.paymentStatus === 'OnAccount' ? 'text-red-600' :
                      o.paymentStatus === 'Refunded' ? 'text-gray-400' : 'text-amber-600'
                    )}>
                      {o.paymentStatus === 'OnAccount'
                        ? (language === 'ar' ? 'على الحساب' : 'On Account')
                        : o.paymentStatus}
                    </p>
                  </div>
                  <button
                    type="button"
                    title={language === 'ar' ? 'طباعة الفاتورة' : 'Print Invoice'}
                    onClick={(e) => {
                      e.stopPropagation();
                      printCustomerReceipt(o, language === 'ar' ? 'ar' : 'en');
                    }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
                  >
                    <Printer size={15} />
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

function CompanyProfile({
  company, members, orders, allOrders, taxRate, currency, t, language, onOpenCustomer,
}: {
  company: Company;
  members: Customer[];
  orders: Order[];
  allOrders: Order[];
  taxRate: number;
  currency: string;
  t: (k: string) => string;
  language: string;
  onOpenCustomer: (c: Customer) => void;
}) {
  const stats = orderStats(orders, taxRate);
  const balance = getCompanyAccountBalance(
    allOrders,
    company.id,
    taxRate,
    members.map(m => m.phone),
    members.map(m => m.id),
    true
  );
  const openInvoices = getCompanyOpenInvoices(
    allOrders,
    company.id,
    members.map(m => m.phone),
    members.map(m => m.id),
    true
  );

  const topCustomers = useMemo(() => {
    const map: Record<string, { phone: string; name: string; revenue: number; count: number }> = {};
    for (const o of orders.filter(x => x.paymentStatus === 'Paid')) {
      const phone = o.customerPhone || '';
      if (!phone) continue;
      const member = members.find(m => m.phone === phone);
      if (!map[phone]) {
        map[phone] = { phone, name: member?.name || phone, revenue: 0, count: 0 };
      }
      map[phone].revenue += getOrderGrandTotal(o, taxRate);
      map[phone].count += 1;
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [orders, members, taxRate]);


  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start gap-3">
        <div className="p-3 rounded-2xl bg-purple-50 text-purple-700">
          <Building2 size={28} />
        </div>
        <div>
          <h3 className="text-lg font-black text-gray-900">{company.name}</h3>
          {company.phone && <p className="text-sm text-gray-500"><Phone size={13} className="inline" /> {company.phone}</p>}
          <p className={clsx('text-sm font-black mt-1', balance > 0 ? 'text-red-600' : 'text-green-600')}>
            {accountBalanceLabel(balance, currency, language)}
          </p>
        </div>
      </div>

      {(company.tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {company.tags.map(tag => (
            <span key={tag} className="text-[11px] px-2 py-0.5 rounded-lg bg-purple-50 text-purple-700 font-semibold border border-purple-100">{tag}</span>
          ))}
        </div>
      )}

      {company.notes && (
        <p className="text-xs text-gray-500 bg-gray-50 p-3 rounded-xl">{company.notes}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MiniMetric label={t('Affiliated Customers')} value={String(members.length)} />
        <MiniMetric label={t('Orders')} value={String(stats.totalOrders)} />
        <MiniMetric label={t('Revenue')} value={`${stats.revenue.toFixed(0)} ${currency}`} />
        <MiniMetric
          label={language === 'ar' ? 'رصيد الشركة' : 'Company due'}
          value={`${balance.toFixed(2)} ${currency}`}
        />
      </div>

      {openInvoices.length > 0 && (
        <div>
          <h4 className="text-sm font-extrabold text-red-700 mb-2">
            {language === 'ar' ? 'فواتير مفتوحة على حساب الشركة' : 'Open company invoices'}
          </h4>
          <div className="divide-y divide-red-50 border border-red-100 rounded-xl overflow-hidden bg-red-50/30">
            {openInvoices.map(o => (
              <div key={o.id} className="flex items-center justify-between px-3 py-2.5 text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-gray-800 truncate">#{formatOrderNumber(o)}</p>
                  <p className="text-gray-400">
                    {o.customerName ||
                      members.find(m => m.id === o.customerId || m.phone === o.customerPhone)?.name ||
                      o.customerPhone ||
                      '—'}{' '}
                    · {new Date(o.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="font-extrabold text-red-700">
                    {getOrderGrandTotal(o, taxRate).toFixed(2)} {currency}
                  </p>
                  <button
                    type="button"
                    title={language === 'ar' ? 'طباعة الفاتورة' : 'Print Invoice'}
                    onClick={(e) => {
                      e.stopPropagation();
                      printCustomerReceipt(o, language === 'ar' ? 'ar' : 'en');
                    }}
                    className="p-1.5 rounded-lg hover:bg-red-100/60 text-red-700 transition-colors"
                  >
                    <Printer size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-extrabold text-gray-900 mb-2">{t('Affiliated Customers')}</h4>
        {members.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center bg-gray-50 rounded-xl">
            {language === 'ar' ? 'لا يوجد عملاء تابعون' : 'No affiliated customers'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {members.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpenCustomer(m)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl border border-gray-100 hover:bg-gray-50 text-left"
              >
                <div>
                  <p className="text-sm font-bold text-gray-900">{m.name}</p>
                  <p className="text-[11px] text-gray-400">{m.phone}</p>
                </div>
                <span className="text-[11px] font-bold text-amber-700">{m.points || 0} pts</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {topCustomers.length > 0 && (
        <div>
          <h4 className="text-sm font-extrabold text-gray-900 mb-2">{language === 'ar' ? 'أعلى العملاء' : 'Top customers'}</h4>
          <div className="space-y-1">
            {topCustomers.map(tc => (
              <div key={tc.phone} className="flex justify-between text-xs px-2 py-1.5 bg-gray-50 rounded-lg">
                <span className="font-bold text-gray-800">{tc.name}</span>
                <span className="text-gray-500">{tc.count} · {tc.revenue.toFixed(0)} {currency}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-extrabold text-gray-900 mb-2">{t('Company Transactions')}</h4>
        {orders.length === 0 ? (
          <p className="text-xs text-gray-400 py-6 text-center bg-gray-50 rounded-xl">
            {language === 'ar' ? 'لا توجد معاملات للشركة بعد' : 'No company transactions yet'}
          </p>
        ) : (
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
            {orders.slice(0, 50).map(o => (
              <div key={o.id} className="flex items-center justify-between px-3 py-2 bg-white text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-gray-800 truncate">{formatOrderNumber(o)}</p>
                  <p className="text-gray-400">{o.customerPhone} · {new Date(o.createdAt).toLocaleString()}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-extrabold">{(o.totalAmount * (1 + taxRate)).toFixed(2)} {currency}</p>
                  <p className={clsx('text-[10px] font-bold', o.paymentStatus === 'Paid' ? 'text-green-600' : 'text-amber-600')}>
                    {o.paymentStatus}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-2.5 text-center border border-gray-100">
      <p className="text-sm font-black text-gray-900 truncate">{value}</p>
      <p className="text-[10px] text-gray-400 font-semibold mt-0.5">{label}</p>
    </div>
  );
}
