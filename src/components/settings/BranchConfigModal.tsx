import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Building2, Mail, Lock, Tag, ShieldCheck, Hash } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getBranchConfig, setBranchConfig } from '../../utils/settingsConfig';

interface BranchConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BranchConfigModal({ isOpen, onClose }: BranchConfigModalProps) {
  const { t } = useLanguage();
  const [branchName, setBranchName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [branchId, setBranchId] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      const config = getBranchConfig();
      setBranchName(config.branchName);
      setEmail(config.email);
      setPassword(config.password || '');
      setBranchId(config.branchId);
      setSuccess(false);
      setError('');
    }
  }, [isOpen]);

  const handleSave = () => {
    setError('');

    if (!branchName.trim()) {
      setError('Branch name is required');
      return;
    }
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    if (!password.trim()) {
      setError('Password is required');
      return;
    }

    setBranchConfig({
      branchName: branchName.trim(),
      email: email.trim().toLowerCase(),
      password: password,
      branchId: branchId,
    });

    setSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-white w-full max-w-md tablet:max-w-lg rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-orange-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl text-white">
              <Building2 size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('Branch Configuration')}</h2>
              <p className="text-orange-100 text-xs">{t('Configure branch identity and credentials')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-gray-800">
          {/* Branch ID (read-only) */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">{t('Branch ID')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Hash size={18} />
              </div>
              <input
                type="text"
                value={branchId}
                readOnly
                className="w-full bg-gray-100 border border-gray-200 rounded-xl pl-11 pr-4 py-3 text-sm font-mono text-gray-500 cursor-not-allowed"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">{t('Auto-generated identifier for this branch')}</p>
          </div>

          {/* Branch Name */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">{t('Branch Name')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Tag size={18} />
              </div>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-sm font-semibold focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
                placeholder="Main Branch"
              />
            </div>
          </div>

          {/* Branch Email */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">{t('Branch Email')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Mail size={18} />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-sm font-semibold focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
                placeholder="admin@branch.local"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">{t('This email is used to login to this branch')}</p>
          </div>

          {/* Branch Password */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">{t('Branch Password')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Lock size={18} />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-sm font-semibold focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
                placeholder="••••••••"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="text-red-600 text-sm font-bold bg-red-50 p-3 rounded-lg border border-red-100">
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-lg border border-emerald-100">
              <ShieldCheck size={16} />
              <p>{t('Branch configuration saved! Please re-login for changes to take effect.')}</p>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleSave}
              className="w-full bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm"
            >
              {t('Save Changes')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
