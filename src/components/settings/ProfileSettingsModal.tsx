import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, AlertCircle, Lock, ShieldAlert } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getAdminCredentials, setAdminCredentials, getManagerCredentials, setManagerCredentials } from '../../utils/settingsConfig';
import { useAuth } from '../../context/AuthContext';
import { getSessionRole } from '../../services/cloudConfig';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Credential targets the manager can change. A cashier CANNOT change any login
 * password — the D1 write is manager-only (MANAGER_ONLY_SETTING_KEYS), and
 * updating localStorage without D1 diverges the credential and bricks the
 * cloud login on re-login.
 */
type CredentialTarget = 'manager' | 'cashier';

export function ProfileSettingsModal({ isOpen, onClose }: ProfileSettingsModalProps) {
  const { t } = useLanguage();
  const { user, logout } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [target, setTarget] = useState<CredentialTarget>('manager');

  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  // Only a manager session may change login passwords. The cloud role takes
  // precedence (it is what the Worker will actually authorize); fall back to
  // the local user record when the cloud role is not yet resolved (offline /
  // first-run before a mint).
  const cloudRole = getSessionRole();
  const isManager = cloudRole === 'manager' || (!cloudRole && user?.role === 'manager');

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setConfirmPassword('');
      setError('');
      setSuccess(false);
      setSaving(false);
      // Default target: manager changes their own password first.
      setTarget('manager');
    }
  }, [isOpen]);

  const handleSave = async () => {
    setError('');
    setSuccess(false);

    if (!isManager) {
      // Should not happen — the form is hidden for cashiers — but fail-closed.
      setError('تغيير كلمة المرور يحتاج صلاحية مدير. / Changing login passwords requires manager access.');
      return;
    }

    if (password.length < 3) {
      setError(t('Password must be at least 3 characters'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('Passwords do not match'));
      return;
    }

    setSaving(true);
    try {
      if (target === 'manager') {
        const currentCreds = getManagerCredentials();
        const username = currentCreds?.username || 'manager';
        await setManagerCredentials(username, password);
      } else {
        const currentCreds = getAdminCredentials();
        const username = currentCreds?.username || 'admin';
        await setAdminCredentials(username, password);
      }
      setSuccess(true);

      // Only logout when the manager changed their OWN password — they need to
      // re-authenticate with the new credential. Changing the cashier password
      // from the manager session does not invalidate the manager's session.
      if (target === 'manager') {
        setTimeout(() => {
          onClose();
          logout();
        }, 1500);
      } else {
        // Cashier password changed by manager — just close after a brief success.
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (err) {
      console.error('Failed to change password:', err);
      const msg = err instanceof Error ? err.message : String(err);
      // Surface the typed error from setAdminCredentials / setManagerCredentials
      // when the D1 write was denied (canPushSettingKey returned false).
      if (msg.includes('credential_sync_denied') || msg.includes('manager')) {
        setError('تغيير كلمة المرور يحتاج صلاحية مدير. / Changing login passwords requires manager access.');
      } else {
        setError(t('Failed to change password. Please try again.') + (msg ? ` (${msg})` : ''));
      }
    } finally {
      setSaving(false);
    }
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
          {!isManager ? (
            /* ── Cashier notice: cannot change passwords ─────────────────── */
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="bg-amber-100 p-4 rounded-full">
                <ShieldAlert size={32} className="text-amber-600" />
              </div>
              <div className="space-y-2">
                <p className="font-bold text-gray-800 text-base">تغيير كلمة المرور غير متاح</p>
                <p className="text-sm text-gray-600 leading-relaxed">
                  تغيير كلمات مرور تسجيل الدخول يحتاج صلاحية <strong>مدير</strong>. تواصل مع المدير لتغيير كلمة المرور.
                </p>
                <p className="text-sm text-gray-500 leading-relaxed mt-1">
                  Only a <strong>manager</strong> can change login passwords. Contact the manager to update your password.
                </p>
              </div>
              <button
                onClick={onClose}
                className="mt-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-2.5 px-6 rounded-xl transition-colors"
              >
                {t('Close')}
              </button>
            </div>
          ) : (
            /* ── Manager: change manager or cashier password ──────────────── */
            <>
              {/* Role target selector */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-700 block">تغيير كلمة مرور / Change password for</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTarget('manager')}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all border ${
                      target === 'manager'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                        : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    المدير / Manager
                  </button>
                  <button
                    type="button"
                    onClick={() => setTarget('cashier')}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all border ${
                      target === 'cashier'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                        : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    الكاشير / Cashier
                  </button>
                </div>
              </div>

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
                  <AlertCircle size={16} className="flex-shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              {success && (
                <div className="flex flex-col gap-1 text-blue-700 text-sm font-bold bg-blue-50 p-3 rounded-lg border border-blue-100">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} />
                    <p>{t('Password updated successfully!')}</p>
                  </div>
                  {target === 'manager' && (
                    <p className="text-xs text-blue-600 ml-6">{t('Logging you out to apply changes...')}</p>
                  )}
                </div>
              )}

              <div className="pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm flex justify-center items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    t('Save Changes')
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
