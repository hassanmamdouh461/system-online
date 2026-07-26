import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, KeyRound, ShieldCheck, Store, Cloud, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import {
  getApiKey,
  setApiKey,
  getManagerKey,
  setManagerKey,
  hasManagerKey,
  getWorkerUrl,
  setWorkerUrl,
} from '../../services/cloudConfig';

/**
 * Cloud key entry.
 *
 * The worker derives the caller's ROLE from which key is presented, so what a
 * device can do server-side is decided by which key is stored here — not by the
 * React session, which lives in localStorage and can be edited in DevTools.
 *
 * Intended setup:
 *   - Till / cashier device  → cashier key only (constrained by the server matrix)
 *   - Manager device         → manager key (full rights)
 *
 * The manager key must never be entered on a shared till: any browser holding it
 * can perform every manager operation regardless of who is signed in.
 */
export function CloudKeysModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const isAr = language === 'ar';
  const isManager = user?.role === 'manager';

  const [workerUrl, setUrlValue] = useState('');
  const [cashierKey, setCashierKeyValue] = useState('');
  const [managerKey, setManagerKeyValue] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setUrlValue(getWorkerUrl());
    // Show the cashier key only when it is the device's actual cashier key
    // (getApiKey prefers the manager key when one exists).
    setCashierKeyValue(hasManagerKey() ? '' : getApiKey());
    setManagerKeyValue(getManagerKey());
    setSaved(false);
  }, [isOpen]);

  const handleSave = () => {
    setWorkerUrl(workerUrl.trim());
    setApiKey(cashierKey.trim());
    // Only a manager may attach a manager key, so a cashier cannot self-promote
    // this device by pasting a key they happened to see.
    if (isManager) setManagerKey(managerKey.trim());
    setSaved(true);
    setTimeout(() => onClose(), 700);
  };

  const handleRemoveManagerKey = () => {
    setManagerKey('');
    setManagerKeyValue('');
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          dir={isAr ? 'rtl' : 'ltr'}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              <Cloud size={20} className="text-mocha-600" />
              {isAr ? 'مفاتيح المزامنة السحابية' : 'Cloud Sync Keys'}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label={isAr ? 'إغلاق' : 'Close'}
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-5 overflow-y-auto">
            <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 rounded-xl p-3">
              {isAr
                ? 'صلاحية هذا الجهاز على السيرفر تتحدد بالمفتاح المخزَّن هنا. جهاز الكاشير يأخذ مفتاح الكاشير فقط، وجهاز المدير يأخذ مفتاح المدير. لا تضع مفتاح المدير على جهاز كاشير مشترك.'
                : "This device's server-side permissions are decided by the key stored here. A till gets the cashier key only; a manager device gets the manager key. Never store the manager key on a shared till."}
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                <Cloud size={14} />
                {isAr ? 'رابط الـ Worker' : 'Worker URL'}
              </label>
              <input
                type="url"
                dir="ltr"
                value={workerUrl}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="https://system-online-backend.xxx.workers.dev"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-mocha-500 focus:ring-1 focus:ring-mocha-500 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                <Store size={14} />
                {isAr ? 'مفتاح الكاشير' : 'Cashier Key'}
              </label>
              <div className="relative">
                <input
                  type={showKeys ? 'text' : 'password'}
                  dir="ltr"
                  value={cashierKey}
                  onChange={(e) => setCashierKeyValue(e.target.value)}
                  placeholder="csh_..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pe-10 text-sm focus:outline-none focus:border-mocha-500 focus:ring-1 focus:ring-mocha-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowKeys((v) => !v)}
                  className="absolute inset-y-0 end-2 flex items-center text-gray-400 hover:text-gray-600"
                  aria-label={isAr ? 'إظهار' : 'Show'}
                >
                  {showKeys ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-[11px] text-gray-500">
                {isAr
                  ? 'يسمح بالأوردرات والقبض وخصم المخزون. لا يسمح بالحذف أو تعديل المنيو أو الإعدادات الحساسة.'
                  : 'Allows orders, payment and stock deduction. No deletes, no menu edits, no sensitive settings.'}
              </p>
            </div>

            {isManager ? (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-amber-600" />
                  {isAr ? 'مفتاح المدير' : 'Manager Key'}
                </label>
                <div className="relative">
                  <input
                    type={showKeys ? 'text' : 'password'}
                    dir="ltr"
                    value={managerKey}
                    onChange={(e) => setManagerKeyValue(e.target.value)}
                    placeholder="mgr_..."
                    className="w-full border border-amber-200 bg-amber-50/40 rounded-xl px-3 py-2.5 pe-10 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKeys((v) => !v)}
                    className="absolute inset-y-0 end-2 flex items-center text-gray-400 hover:text-gray-600"
                    aria-label={isAr ? 'إظهار' : 'Show'}
                  >
                    {showKeys ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-amber-700">
                    {isAr
                      ? 'صلاحية كاملة: حذف، منيو، مخزون، تقارير، إعدادات.'
                      : 'Full rights: delete, menu, inventory, reports, settings.'}
                  </p>
                  {managerKey ? (
                    <button
                      type="button"
                      onClick={handleRemoveManagerKey}
                      className="text-[11px] text-red-600 hover:text-red-700 font-semibold flex items-center gap-1 shrink-0"
                    >
                      <Trash2 size={12} />
                      {isAr ? 'إزالة من الجهاز' : 'Remove'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3 flex items-start gap-2">
                <KeyRound size={14} className="mt-0.5 shrink-0 text-gray-400" />
                <span>
                  {isAr
                    ? 'إدخال مفتاح المدير متاح لحساب المدير فقط.'
                    : 'Only a manager account can enter the manager key.'}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition-colors"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 px-4 py-2.5 rounded-xl bg-mocha-600 text-white font-bold hover:bg-mocha-700 shadow-lg shadow-mocha-500/20 transition-colors"
            >
              {saved
                ? isAr
                  ? 'تم الحفظ ✓'
                  : 'Saved ✓'
                : isAr
                ? 'حفظ'
                : 'Save'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
