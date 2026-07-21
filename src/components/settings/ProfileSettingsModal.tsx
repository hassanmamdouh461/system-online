import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, AlertCircle, Lock } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getAdminCredentials, setAdminCredentials } from '../../utils/settingsConfig';
import { useAuth } from '../../context/AuthContext';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileSettingsModal({ isOpen, onClose }: ProfileSettingsModalProps) {
  const { t } = useLanguage();
  const { logout } = useAuth();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setConfirmPassword('');
      setError('');
      setSuccess(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    setError('');
    setSuccess(false);

    if (password.length < 3) {
      setError(t('Password must be at least 3 characters'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('Passwords do not match'));
      return;
    }

    const currentCreds = getAdminCredentials();
    setAdminCredentials(currentCreds.username, password);
    setSuccess(true);
    
    setTimeout(() => {
      onClose();
      // Force logout so they login with new credentials
      logout();
    }, 1500);
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-white w-full max-w-md tablet:max-w-lg rounded-2xl shadow-2xl overflow-hidden z-10">
        {/* Header */}
        <div className="bg-blue-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl text-white">
              <Lock size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('Change Password')}</h2>
              <p className="text-blue-100 text-xs">{t('Update the password used to log into the system')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-gray-800">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-700 block">{t('New Password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder={t('Enter new password')}
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-700 block">{t('Confirm New Password')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder={t('Re-enter new password')}
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm font-bold bg-red-50 p-3 rounded-lg border border-red-100">
              <AlertCircle size={16} />
              <p>{error}</p>
            </div>
          )}

          {success && (
            <div className="flex flex-col gap-1 text-blue-700 text-sm font-bold bg-blue-50 p-3 rounded-lg border border-blue-100">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} />
                <p>{t('Password updated successfully!')}</p>
              </div>
              <p className="text-xs text-blue-600 ml-6">{t('Logging you out to apply changes...')}</p>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleSave}
              className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm flex justify-center items-center gap-2"
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
