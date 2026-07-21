import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Lock, ShieldCheck, KeyRound, AlertCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface PinSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PinSetupModal({ isOpen, onClose }: PinSetupModalProps) {
  const { t } = useLanguage();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [hasExistingPin, setHasExistingPin] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setConfirmPin('');
      setError('');
      setSuccess('');
      const savedPin = localStorage.getItem('brewmaster_admin_pin');
      setHasExistingPin(!!savedPin);
    }
  }, [isOpen]);

  const handleSave = () => {
    setError('');
    setSuccess('');

    if (pin.length > 0 && pin.length < 4) {
      setError(t('PIN must be 4 digits'));
      return;
    }

    if (pin !== confirmPin) {
      setError(t('PINs do not match'));
      return;
    }

    if (pin === '') {
      localStorage.removeItem('brewmaster_admin_pin');
      setSuccess(t('PIN has been removed'));
      setHasExistingPin(false);
    } else {
      localStorage.setItem('brewmaster_admin_pin', pin);
      setSuccess(t('PIN has been successfully updated'));
      setHasExistingPin(true);
    }

    setTimeout(() => {
      onClose();
    }, 1500);
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl text-white">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('Security & Access')}</h2>
              <p className="text-indigo-100 text-xs">{t('Configure access pin code')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-gray-800">
          {hasExistingPin && (
            <div className="bg-indigo-50 text-indigo-700 p-3 rounded-xl flex items-center gap-3 text-sm font-semibold border border-indigo-100">
              <KeyRound size={18} />
              <p>{t('A security PIN is currently active.')}</p>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-700 block">{t('Enter 4-Digit PIN')}</label>
              <div className="relative">
                <input
                  type="password"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 text-lg font-mono tracking-[0.5em] text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  placeholder="••••"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">{t('Leave blank to remove PIN protection')}</p>
            </div>

            {pin.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-bold text-gray-700 block">{t('Confirm PIN')}</label>
                <div className="relative">
                  <input
                    type="password"
                    maxLength={4}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 text-lg font-mono tracking-[0.5em] text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    placeholder="••••"
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm font-bold bg-red-50 p-3 rounded-lg border border-red-100">
              <AlertCircle size={16} />
              <p>{error}</p>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-lg border border-emerald-100">
              <ShieldCheck size={16} />
              <p>{success}</p>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleSave}
              className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
            >
              <Lock size={18} />
              {pin === '' ? t('Remove PIN') : t('Save PIN')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
