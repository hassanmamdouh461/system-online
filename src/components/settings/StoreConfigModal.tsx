import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Store, Percent, ShieldCheck, MapPin, Phone, Type } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import {
  getTaxRate,
  setTaxRate,
  getStoreConfig,
  setStoreConfig,
} from '../../utils/settingsConfig';

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
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTaxInput(String(getTaxRate() * 100));
      const store = getStoreConfig();
      setStoreName(store.storeName);
      setAddress(store.address);
      setPhone(store.phone);
      setTagline(store.tagline || '');
      setSuccess(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    const rate = parseFloat(taxInput);
    if (!isNaN(rate) && rate >= 0) {
      setTaxRate(rate / 100);
    }
    const current = getStoreConfig();
    setStoreConfig({
      ...current,
      storeName: storeName.trim() || 'BrewMaster',
      address: address.trim(),
      phone: phone.trim(),
      tagline: tagline.trim(),
    });
    setSuccess(true);
    setTimeout(() => onClose(), 1000);
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

          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-lg border border-emerald-100">
              <ShieldCheck size={16} />
              <p>{language === 'ar' ? 'تم الحفظ بنجاح' : 'Saved successfully'}</p>
            </div>
          )}

          <button
            onClick={handleSave}
            className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm"
          >
            {t('Save Changes')}
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
