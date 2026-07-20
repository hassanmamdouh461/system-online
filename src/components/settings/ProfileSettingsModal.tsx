import React, { useState, useEffect } from 'react';
import { X, User, ShieldCheck, AlertCircle } from 'lucide-react';
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
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const creds = getAdminCredentials();
      setUsername(creds.username);
      setPassword('');
      setConfirmPassword('');
      setError('');
      setSuccess(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    setError('');
    setSuccess(false);

    if (username.trim().length < 3) {
      setError(t('Username must be at least 3 characters'));
      return;
    }

    if (password.length > 0) {
      if (password.length < 3) {
        setError(t('Password must be at least 3 characters'));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('Passwords do not match'));
        return;
      }
    }

    const currentCreds = getAdminCredentials();
    const finalPassword = password.length > 0 ? password : currentCreds.password;

    setAdminCredentials(username.trim(), finalPassword);
    setSuccess(true);
    
    setTimeout(() => {
      onClose();
      // Force logout so they login with new credentials
      logout();
    }, 1500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-blue-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl text-white">
              <User size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('Profile Settings')}</h2>
              <p className="text-blue-100 text-xs">{t('Update password and user settings')}</p>
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
              <label className="text-sm font-bold text-gray-700 block">{t('Admin Username')}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder="admin"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-700 block">{t('New Password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder={t('Leave blank to keep current password')}
              />
            </div>

            {password.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-bold text-gray-700 block">{t('Confirm New Password')}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="••••"
                />
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
            <div className="flex flex-col gap-1 text-blue-700 text-sm font-bold bg-blue-50 p-3 rounded-lg border border-blue-100">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} />
                <p>{t('Profile updated successfully!')}</p>
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
    </div>
  );
}
