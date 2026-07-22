import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Phone, Search, UserPlus, UserCheck, SkipForward, Loader2,
  Building2, Coins, CheckCircle2
} from 'lucide-react';
import { customersService } from '../../services/customersService';
import { companiesService } from '../../services/companiesService';
import { Customer } from '../../types/customer';
import { Company } from '../../types/company';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { clsx } from 'clsx';

export interface CustomerLookupResult {
  /** null when cashier skipped or billed company-only */
  customer: Customer | null;
  /** When charging a company account */
  company: Company | null;
  skipped: boolean;
}

interface CustomerLookupStepProps {
  initialPhone?: string;
  onResolved: (result: CustomerLookupResult) => void;
  onCancel?: () => void;
  compact?: boolean;
  /**
   * any      = normal (phone/name, skip allowed)
   * customer = must pick a person account
   * company  = must pick a company (by name or via affiliated customer)
   */
  accountMode?: 'any' | 'customer' | 'company';
}

type Phase = 'input' | 'searching' | 'found' | 'found-company' | 'new';

export function CustomerLookupStep({
  initialPhone = '',
  onResolved,
  onCancel,
  compact = false,
  accountMode = 'any',
}: CustomerLookupStepProps) {
  const { t, language } = useLanguage();
  const { branch } = useAuth();
  const branchId = branch?.branchId === 'manager' ? undefined : branch?.branchId;

  const [query, setQuery] = useState(initialPhone);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(initialPhone);
  const [phase, setPhase] = useState<Phase>('input');
  const [found, setFound] = useState<Customer | null>(null);
  const [foundCompany, setFoundCompany] = useState<Company | null>(null);
  const [source, setSource] = useState<'local' | 'server' | 'none'>('none');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    Promise.all([
      customersService.getAll(branchId),
      companiesService.getAll(branchId),
    ]).then(([c, cos]) => {
      setAllCustomers(c);
      setAllCompanies(cos);
    }).catch(() => {});
  }, [branchId]);

  const companyMap = useMemo(() => {
    const m: Record<string, Company> = {};
    allCompanies.forEach(co => { m[co.id] = co; });
    return m;
  }, [allCompanies]);

  const resolveCompanyForCustomer = (customer: Customer): Company | null => {
    if (!customer.companyId) return null;
    if (companyMap[customer.companyId]) return companyMap[customer.companyId];
    // companyId might be stale; try match by name
    const byName = allCompanies.find(
      co => co.name.trim() === String(customer.companyId).trim()
    );
    return byName || null;
  };

  // Live filter: customers by phone/name + companies by name/phone
  const matchingCustomers = useMemo(() => {
    const clean = query.replace(/[\s\-()]/g, '').trim().toLowerCase();
    if (!clean || phase === 'found' || phase === 'found-company' || phase === 'new') return [];
    return allCustomers
      .filter(c => {
        const p = (c.phone || '').replace(/[\s\-()]/g, '').trim().toLowerCase();
        const n = (c.name || '').toLowerCase();
        const co = c.companyId ? companyMap[c.companyId] : null;
        const coName = (co?.name || '').toLowerCase();
        return (
          p.startsWith(clean) ||
          p.includes(clean) ||
          n.includes(clean) ||
          coName.includes(clean)
        );
      })
      .slice(0, 8);
  }, [allCustomers, query, phase, companyMap]);

  const matchingCompanies = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean || phase === 'found' || phase === 'found-company' || phase === 'new') return [];
    if (accountMode === 'customer') return [];
    return allCompanies
      .filter(co => {
        const n = (co.name || '').toLowerCase();
        const p = (co.phone || '').replace(/[\s\-()]/g, '').trim().toLowerCase();
        const q = clean.replace(/[\s\-()]/g, '');
        return n.includes(clean) || (q && p.includes(q));
      })
      .slice(0, 6);
  }, [allCompanies, query, phase, accountMode]);

  useEffect(() => {
    if (initialPhone && initialPhone.trim()) {
      void handleSearch(initialPhone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = async (override?: string) => {
    const raw = (override ?? query).trim();
    if (!raw) {
      setError(
        language === 'ar'
          ? 'أدخل اسم/هاتف العميل أو اسم الشركة'
          : 'Enter customer name/phone or company name'
      );
      return;
    }
    setError('');
    setPhase('searching');
    try {
      // 1) Prefer company name match when in company mode
      if (accountMode === 'company' || accountMode === 'any') {
        const exactCo = allCompanies.find(
          co => co.name.trim().toLowerCase() === raw.toLowerCase()
        );
        const partialCos = allCompanies.filter(co =>
          co.name.toLowerCase().includes(raw.toLowerCase())
        );
        if (exactCo || partialCos.length === 1) {
          const co = exactCo || partialCos[0];
          setFoundCompany(co);
          setFound(null);
          setPhase('found-company');
          return;
        }
      }

      // 2) Phone-like → customer lookup
      const digits = raw.replace(/[\s\-()]/g, '');
      if (/^\d{6,}$/.test(digits)) {
        const { customer, source: src } = await customersService.lookupByPhone(digits, branchId);
        setSource(src);
        if (customer) {
          setFound(customer);
          setPhone(customer.phone);
          setQuery(customer.phone);
          setFoundCompany(resolveCompanyForCustomer(customer));
          setPhase('found');
          return;
        }
      }

      // 3) Name match on customers
      const nameMatches = allCustomers.filter(c =>
        (c.name || '').toLowerCase().includes(raw.toLowerCase())
      );
      if (nameMatches.length === 1) {
        setFound(nameMatches[0]);
        setPhone(nameMatches[0].phone);
        setFoundCompany(resolveCompanyForCustomer(nameMatches[0]));
        setSource('local');
        setPhase('found');
        return;
      }

      if (nameMatches.length > 1 || matchingCompanies.length > 0) {
        setPhase('input');
        setError(
          language === 'ar'
            ? 'اختر نتيجة من القائمة بالأسفل'
            : 'Select a result from the list below'
        );
        return;
      }

      setFound(null);
      setFoundCompany(null);
      setName(raw.replace(/\d/g, '').trim() || '');
      setPhone(/^\d/.test(digits) ? digits : '');
      setPhase(accountMode === 'company' ? 'input' : 'new');
      if (accountMode === 'company') {
        setError(
          language === 'ar'
            ? 'لم يتم العثور على شركة — ابحث باسم الشركة أو اختر عميلاً تابعاً لها'
            : 'No company found — search by company name or pick an affiliated customer'
        );
      }
    } catch (err) {
      console.error(err);
      setError(language === 'ar' ? 'فشل البحث، حاول مرة أخرى' : 'Lookup failed, try again');
      setPhase('input');
    }
  };

  const handleRegisterAndContinue = async () => {
    const rawPhone = phone.trim();
    const rawName = name.trim();
    if (!rawName) {
      setError(language === 'ar' ? 'يرجى إدخال اسم العميل' : 'Please enter customer name');
      return;
    }
    if (!rawPhone) {
      setError(language === 'ar' ? 'يرجى إدخال رقم الهاتف' : 'Please enter phone number');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const customer = await customersService.save(
        { name: rawName, phone: rawPhone, points: 0 },
        branchId
      );
      onResolved({ customer, company: null, skipped: false });
    } catch (err) {
      console.error(err);
      setError(language === 'ar' ? 'فشل تسجيل العميل' : 'Failed to register customer');
    } finally {
      setSaving(false);
    }
  };

  const handleContinueWithFound = () => {
    if (!found) return;
    if (accountMode === 'company') {
      const co = foundCompany || resolveCompanyForCustomer(found);
      if (!co) {
        setError(
          language === 'ar'
            ? 'هذا العميل غير مربوط بشركة'
            : 'This customer is not linked to a company'
        );
        return;
      }
      onResolved({ customer: found, company: co, skipped: false });
      return;
    }
    onResolved({
      customer: found,
      company: foundCompany || resolveCompanyForCustomer(found),
      skipped: false,
    });
  };

  const handleContinueWithCompany = () => {
    if (!foundCompany) return;
    onResolved({ customer: null, company: foundCompany, skipped: false });
  };

  const handleSkip = () => {
    if (accountMode === 'customer' || accountMode === 'company') {
      setError(
        language === 'ar'
          ? 'لا يمكن التخطي عند التسجيل على الحساب'
          : 'Cannot skip when charging to an account'
      );
      return;
    }
    onResolved({ customer: null, company: null, skipped: true });
  };

  const title =
    accountMode === 'company'
      ? language === 'ar'
        ? 'حساب الشركة'
        : 'Company account'
      : accountMode === 'customer'
        ? language === 'ar'
          ? 'حساب العميل'
          : 'Customer account'
        : language === 'ar'
          ? 'رقم / اسم العميل'
          : 'Customer phone / name';

  const subtitle =
    accountMode === 'company'
      ? language === 'ar'
        ? 'ابحث باسم الشركة أو بعميل تابع لها'
        : 'Search company name or an affiliated customer'
      : language === 'ar'
        ? 'ابحث بالاسم أو الهاتف أو اسم الشركة'
        : 'Search by name, phone, or company';

  return (
    <div className={clsx('space-y-4', compact ? '' : 'p-1')}>
      <div className="text-center mb-1">
        <div className="w-12 h-12 mx-auto mb-2 rounded-2xl bg-mocha-50 text-mocha-700 flex items-center justify-center">
          {accountMode === 'company' ? <Building2 size={22} /> : <Phone size={22} />}
        </div>
        <h3 className="text-base font-extrabold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
      </div>

      {(phase === 'input' || phase === 'searching' || phase === 'new') && (
        <div className="space-y-2">
          <label className="block text-xs font-bold text-gray-600">
            {language === 'ar' ? 'بحث' : 'Search'}
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setPhone(e.target.value);
                if (phase === 'new') setPhase('input');
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSearch();
                }
              }}
              placeholder={
                language === 'ar'
                  ? 'اسم / هاتف / شركة...'
                  : 'Name / phone / company...'
              }
              className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-caramel/40 bg-white"
            />
            <button
              type="button"
              onClick={() => void handleSearch()}
              disabled={phase === 'searching'}
              className="px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-60 shrink-0"
            >
              {phase === 'searching' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Search size={16} />
              )}
              {language === 'ar' ? 'بحث' : 'Search'}
            </button>
          </div>

          {/* Company results */}
          {phase === 'input' && matchingCompanies.length > 0 && (
            <div className="space-y-1.5 mt-2 pt-2 border-t border-gray-100">
              <span className="text-[11px] font-bold text-purple-700">
                {language === 'ar' ? 'شركات' : 'Companies'}
              </span>
              {matchingCompanies.map(co => (
                <button
                  key={co.id}
                  type="button"
                  onClick={() => {
                    setFoundCompany(co);
                    setFound(null);
                    setPhase('found-company');
                  }}
                  className="w-full text-right bg-purple-50 hover:bg-purple-100 p-2.5 rounded-xl border border-purple-200 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 size={16} className="text-purple-700 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-black text-purple-900 truncate">{co.name}</p>
                      {co.phone && (
                        <p className="text-[11px] font-mono text-purple-600">{co.phone}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] font-black text-purple-800 bg-white px-2 py-1 rounded-lg border border-purple-200">
                    {language === 'ar' ? 'اختيار الشركة' : 'Select company'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Customer results */}
          {phase === 'input' && matchingCustomers.length > 0 && (
            <div className="space-y-1.5 mt-2 pt-2 border-t border-gray-100">
              <span className="text-[11px] font-bold text-gray-600">
                {language === 'ar' ? 'عملاء' : 'Customers'}
              </span>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {matchingCustomers.map(c => {
                  const co = c.companyId ? companyMap[c.companyId] : null;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setFound(c);
                        setPhone(c.phone);
                        setQuery(c.phone);
                        setFoundCompany(co);
                        setSource('local');
                        setPhase('found');
                      }}
                      className="w-full text-right bg-white hover:bg-mocha-50/70 p-2.5 rounded-xl border border-gray-200 hover:border-mocha-300 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-mocha-100 text-mocha-800 font-extrabold text-xs flex items-center justify-center shrink-0">
                          {c.name ? c.name.substring(0, 1) : '?'}
                        </div>
                        <div className="min-w-0 text-right">
                          <p className="text-xs font-black text-gray-900 truncate">{c.name}</p>
                          <p className="text-[11px] font-mono text-gray-500 font-bold">{c.phone}</p>
                          {co && (
                            <p className="text-[10px] font-bold text-purple-700 flex items-center gap-1 justify-end">
                              <Building2 size={10} /> {co.name}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-black text-mocha-700 bg-mocha-50 px-2 py-1 rounded-lg border border-mocha-200">
                        {language === 'ar' ? 'اختيار' : 'Select'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {accountMode !== 'company' && (
            <div className="flex justify-start items-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setName('');
                  setPhase('new');
                }}
                className="text-xs font-bold text-mocha-700 hover:text-mocha-900 flex items-center gap-1 bg-mocha-50 hover:bg-mocha-100 px-3 py-1.5 rounded-lg border border-mocha-200/80"
              >
                <UserPlus size={14} />
                <span>{language === 'ar' ? '+ إضافة عميل جديد' : '+ Add New Customer'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {phase === 'searching' && (
        <div className="py-6 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
          <Loader2 className="animate-spin" size={22} />
          {language === 'ar' ? 'جاري البحث...' : 'Searching...'}
        </div>
      )}

      {phase === 'found-company' && foundCompany && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-purple-100 bg-purple-50/60 p-4 space-y-3"
        >
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-purple-100 text-purple-700">
              <Building2 size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-gray-900 truncate">{foundCompany.name}</p>
              {foundCompany.phone && (
                <p className="text-xs text-gray-500 mt-0.5">{foundCompany.phone}</p>
              )}
              <p className="text-[11px] font-bold text-purple-700 mt-1">
                {language === 'ar'
                  ? 'الفاتورة ستُسجَّل على حساب الشركة'
                  : 'Invoice will be charged to this company'}
              </p>
            </div>
            <CheckCircle2 className="text-purple-600 shrink-0" size={20} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setPhase('input');
                setFoundCompany(null);
              }}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600"
            >
              {language === 'ar' ? 'تغيير' : 'Change'}
            </button>
            <button
              type="button"
              onClick={handleContinueWithCompany}
              className="flex-1 py-2.5 rounded-xl bg-purple-700 text-white text-sm font-bold hover:bg-purple-800"
            >
              {language === 'ar' ? 'تأكيد على الشركة' : 'Confirm company'}
            </button>
          </div>
        </motion.div>
      )}

      {phase === 'found' && found && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-green-100 bg-green-50/60 p-4 space-y-3"
        >
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-green-100 text-green-700">
              <UserCheck size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-gray-900 truncate">{found.name}</p>
              <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                <Phone size={11} /> {found.phone}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {(foundCompany || resolveCompanyForCustomer(found)) && (
                  <span className="text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-100 px-2 py-0.5 rounded-lg flex items-center gap-1">
                    <Building2 size={10} />
                    {(foundCompany || resolveCompanyForCustomer(found))?.name}
                  </span>
                )}
              </div>
              {accountMode === 'company' && (
                <p className="text-[11px] font-bold text-purple-700 mt-2">
                  {language === 'ar'
                    ? 'سيتم تحميل الفاتورة على حساب الشركة وليس الحساب الشخصي'
                    : 'Invoice will be charged to the company, not personal balance'}
                </p>
              )}
            </div>
            <CheckCircle2 className="text-green-600 shrink-0" size={20} />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setPhase('input');
                setFound(null);
                setFoundCompany(null);
              }}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-white"
            >
              {language === 'ar' ? 'تغيير' : 'Change'}
            </button>
            <button
              type="button"
              onClick={handleContinueWithFound}
              className="flex-1 py-2.5 rounded-xl bg-mocha-700 text-white text-sm font-bold hover:bg-mocha-800"
            >
              {accountMode === 'company'
                ? language === 'ar'
                  ? 'متابعة على الشركة'
                  : 'Continue on company'
                : language === 'ar'
                  ? 'متابعة'
                  : 'Continue'}
            </button>
          </div>
        </motion.div>
      )}

      {phase === 'new' && accountMode !== 'company' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4 space-y-3"
        >
          <div className="flex items-center gap-2 text-amber-900 border-b border-amber-200/60 pb-2">
            <UserPlus size={18} />
            <p className="text-sm font-extrabold">
              {language === 'ar' ? 'إضافة عميل جديد' : 'Add New Customer'}
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('Customer Name')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-mocha-500 bg-white"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                {t('Phone Number')} <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-mocha-500 bg-white"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleRegisterAndContinue()}
            disabled={saving}
            className="w-full py-2.5 rounded-xl bg-mocha-700 text-white text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            {language === 'ar' ? 'حفظ ومتابعة' : 'Save & Continue'}
          </button>
        </motion.div>
      )}

      <div className="flex flex-col gap-2 pt-1">
        {accountMode === 'any' && (
          <button
            type="button"
            onClick={handleSkip}
            className="w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-sm font-bold text-gray-500 hover:bg-gray-50 flex items-center justify-center gap-1.5"
          >
            <SkipForward size={16} />
            {language === 'ar' ? 'تخطي — متابعة بدون عميل' : 'Skip — continue without customer'}
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2 text-xs font-bold text-gray-400 hover:text-gray-600"
          >
            {t('Cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
