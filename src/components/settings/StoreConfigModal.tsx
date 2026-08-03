import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Store, Percent, ShieldCheck, MapPin, Phone, Type, Clock, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import {
  getTaxRate,
  setTaxRate,
  getStoreConfig,
  setStoreConfig,
} from '../../utils/settingsConfig';
import { formatPercent, percentToFraction } from '../../utils/percent';

interface StoreConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function StoreConfigModal({ isOpen, onClose }: StoreConfigModalProps) {
  const { t, language } = useLanguage();
  const [taxInput, setTaxInput] = useState('');
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [tagline, setTagline] = useState('');
  const [dayStartHour, setDayStartHour] = useState('0');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTaxInput(formatPercent(getTaxRate()));
      const store = getStoreConfig();
      setStoreName(store.storeName);
      setAddress(store.address);
      setPhone(store.phone);
      setTagline(store.tagline || '');
      setDayStartHour(String(store.dayStartHour ?? 0));
      setSuccess(false);
      setWarning(null);
      setSaving(false);
    }
  }, [isOpen]);

  /**
   * Save and REPORT WHAT ACTUALLY HAPPENED.
   *
   * This used to fire both writes without awaiting them and then always show
   * "تم الحفظ بنجاح". A cloud write that was rejected (role not allowed to push a
   * manager-only key) or that failed on the server therefore looked identical to
   * a real save — and since the value only lived in localStorage, the next cloud
   * hydrate reverted the field in front of the operator. Now the outcome decides
   * the message, and the modal only auto-closes on a confirmed save.
   */
  const handleSave = async () => {
    setSaving(true);
    setWarning(null);
    const ar = language === 'ar';
    try {
      const outcomes: string[] = [];

      const rate = parseFloat(taxInput);
      if (!isNaN(rate) && rate >= 0) {
        outcomes.push(await setTaxRate(percentToFraction(rate)));
      }

      // Business-day start hour: clamp to 0–23, fall back to 0 (calendar midnight).
      let startHour = parseInt(dayStartHour, 10);
      if (isNaN(startHour) || startHour < 0 || startHour > 23) startHour = 0;

      const current = getStoreConfig();
      outcomes.push(
        await setStoreConfig({
          ...current,
          storeName: storeName.trim() || 'BrewMaster',
          address: address.trim(),
          phone: phone.trim(),
          tagline: tagline.trim(),
          dayStartHour: startHour,
        })
      );

      if (outcomes.includes('forbidden')) {
        setWarning(
          ar
            ? 'الإعدادات دي محتاجة صلاحية مدير. سجّل الدخول كمدير وجرّب تاني — القيمة محفوظة على الجهاز ده بس ومش هتتزامن.'
            : 'These settings need manager access. Sign in as manager and retry — the value is saved on this device only and will not sync.'
        );
        return;
      }
      if (outcomes.includes('queued')) {
        setWarning(
          ar
            ? 'تم الحفظ على الجهاز، لكن المزامنة مع السحابة لم تكتمل بعد — هيتم إعادة المحاولة تلقائياً.'
            : 'Saved on this device, but the cloud sync has not completed yet — it will be retried automatically.'
        );
        return;
      }

      setSuccess(true);
      setTimeout(() => onClose(), 1000);
    } catch (err) {
      console.error('[StoreConfigModal] save failed:', err);
      setWarning(ar ? 'فشل الحفظ. جرّب تاني.' : 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white w-full max-w-md tablet:max-w-lg rounded-2xl shadow-xl overflow-hidden max-h-[90dvh] flex flex-col">
        <div className="bg-emerald-600 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl text-white">
              <Store size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {language === 'ar' ? 'إعدادات المتجر' : 'Store Configuration'}
              </h2>
              <p className="text-emerald-100 text-xs">
                {language === 'ar' ? 'الضريبة · الهوية' : 'Tax · branding'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5 text-gray-800 overflow-y-auto">
          <Field
            icon={Type}
            label={language === 'ar' ? 'اسم المتجر' : 'Store name'}
            value={storeName}
            onChange={setStoreName}
          />
          <Field
            icon={MapPin}
            label={language === 'ar' ? 'العنوان' : 'Address'}
            value={address}
            onChange={setAddress}
          />
          <Field
            icon={Phone}
            label={language === 'ar' ? 'الهاتف' : 'Phone'}
            value={phone}
            onChange={setPhone}
          />
          <Field
            icon={Type}
            label={language === 'ar' ? 'الشعار / الوصف' : 'Tagline'}
            value={tagline}
            onChange={setTagline}
          />

          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">
              {language === 'ar' ? 'نسبة الضريبة %' : 'Tax rate %'}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Percent size={18} />
              </div>
              <input
                type="number"
                min="0"
                step="1"
                value={taxInput}
                onChange={e => setTaxInput(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-lg font-semibold focus:ring-2 focus:ring-emerald-500 outline-none"
                placeholder="14"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">
              {language === 'ar' ? 'ساعة بداية يوم العمل' : 'Business day starts at'}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Clock size={18} />
              </div>
              <input
                type="number"
                min="0"
                max="23"
                step="1"
                value={dayStartHour}
                onChange={e => setDayStartHour(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-lg font-semibold focus:ring-2 focus:ring-emerald-500 outline-none"
                placeholder="0"
              />
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              {language === 'ar'
                ? 'الساعة (٠–٢٣) اللي يبدأ عندها يوم العمل. سيبها ٠ لو يومك بيبدأ نص الليل. لو المحل بيقفل بعد نص الليل حطها مثلاً ٦ علشان أوردرات بعد الـ١٢ تتحسب على نفس ليلة الشغل في الإيراد والعدد.'
                : 'Hour (0–23) when your trading day rolls over. Leave 0 if your day starts at midnight. If you close after midnight, set e.g. 6 so post-midnight orders count on the same business day for both revenue and order count.'}
            </p>
          </div>

          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-lg border border-emerald-100">
              <ShieldCheck size={16} />
              <p>{language === 'ar' ? 'تم الحفظ بنجاح' : 'Saved successfully'}</p>
            </div>
          )}

          {warning && (
            <div className="flex items-start gap-2 text-amber-700 text-sm font-bold bg-amber-50 p-3 rounded-lg border border-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p className="leading-relaxed">{warning}</p>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-all shadow-sm"
          >
            {saving
              ? language === 'ar'
                ? 'جاري الحفظ…'
                : 'Saving…'
              : t('Save Changes')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Field({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  icon: React.ComponentType<{ size?: number | string }>;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-bold text-gray-700 block">{label}</label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
          <Icon size={18} />
        </div>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-sm font-semibold focus:ring-2 focus:ring-emerald-500 outline-none"
        />
      </div>
    </div>
  );
}
