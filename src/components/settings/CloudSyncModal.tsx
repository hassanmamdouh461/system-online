import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Cloud, Server, Key, ShieldCheck, AlertCircle, ExternalLink } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import {
  getWorkerUrl,
  getApiKey,
  setWorkerUrl,
  setApiKey,
  isCloudConfigured,
} from '../../services/cloudConfig';

interface CloudSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Settings modal for the Cloudflare Worker connection (URL + API key).
 *
 * SECURITY: Credentials are stored ONLY in localStorage — they are never read
 * from import.meta.env and therefore never baked into the production bundle.
 * This keeps the API key out of the client JS that ships to end users.
 */
export function CloudSyncModal({ isOpen, onClose }: CloudSyncModalProps) {
  const { t } = useLanguage();
  const [workerUrl, setWorkerUrlState] = useState('');
  const [apiKey, setApiKeyState] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setWorkerUrlState(getWorkerUrl());
      setApiKeyState(getApiKey());
      setSuccess(false);
      setTestSuccess(false);
      setError('');
    }
  }, [isOpen]);

  const handleSave = () => {
    setError('');
    setSuccess(false);

    const trimmedUrl = workerUrl.trim();
    const trimmedKey = apiKey.trim();

    // If a URL is provided, a key is required for an authenticated worker.
    if (trimmedUrl && !trimmedKey) {
      setError(
        t('API key is required when a Worker URL is set') ||
          'مفتاح الـ API مطلوب عند ضبط رابط الـ Worker'
      );
      return;
    }

    setWorkerUrl(trimmedUrl);
    setApiKey(trimmedKey);

    setSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  const handleTestConnection = async () => {
    setError('');
    setTestSuccess(false);

    const trimmedUrl = workerUrl.trim();
    const trimmedKey = apiKey.trim();

    if (!trimmedUrl) {
      setError(
        t('Enter the Worker URL first') || 'أدخل رابط الـ Worker أولاً'
      );
      return;
    }
    if (!trimmedKey) {
      setError(
        t('Enter the API key first') || 'أدخل مفتاح الـ API أولاً'
      );
      return;
    }

    setTesting(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${trimmedUrl.replace(/\/$/, '')}/v1/databases/default/collections/menu_items/documents`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': trimmedKey,
          'X-Branch-ID': 'main_branch',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        setTestSuccess(true);
      } else if (res.status === 401 || res.status === 403) {
        setError(
          t('Authentication failed — check the API key') ||
            'فشل المصادقة — تأكد من صحة مفتاح الـ API'
        );
      } else {
        setError(`${t('Connection error') || 'خطأ في الاتصال'}: HTTP ${res.status}`);
      }
    } catch (err: any) {
      console.error('[CloudSync] Test connection failed:', err);
      setError(
        `${t('Could not reach the Worker') || 'تعذر الوصول إلى الـ Worker'}: ${
          err?.name === 'AbortError'
            ? t('request timed out') || 'انتهت مهلة الطلب'
            : err?.message || String(err)
        }`
      );
    } finally {
      setTesting(false);
    }
  };

  const handleClear = () => {
    setError('');
    setSuccess(false);
    setTestSuccess(false);
    setWorkerUrlState('');
    setApiKeyState('');
    setWorkerUrl('');
    setApiKey('');
    setSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  if (!isOpen) return null;

  const configured = isCloudConfigured();

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-orange-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl text-white">
              <Cloud size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {t('Cloud Sync') || 'المزامنة السحابية'}
              </h2>
              <p className="text-orange-100 text-xs">
                {t('Cloudflare Worker connection') || 'اتصال Cloudflare Worker'}
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

        {/* Content */}
        <div className="p-6 space-y-4 text-gray-800">
          {/* Status banner */}
          <div
            className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium ${
              configured
                ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                : 'bg-amber-50 border-amber-100 text-amber-700'
            }`}
          >
            <ShieldCheck size={16} className="shrink-0" />
            <p>
              {configured
                ? t('Cloud backup is active') || 'النسخ الاحتياطي السحابي مفعّل'
                : t('Cloud backup is OFF — data stays local only') ||
                  'النسخ الاحتياطي السحابي معطل — البيانات محلية فقط'}
            </p>
          </div>

          {/* Worker URL */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">
              {t('Worker URL') || 'رابط الـ Worker'}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Server size={18} />
              </div>
              <input
                type="url"
                dir="ltr"
                value={workerUrl}
                onChange={(e) => setWorkerUrlState(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-sm font-sans focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
                placeholder="https://your-worker.workers.dev"
              />
            </div>
            <p className="text-[11px] text-gray-500">
              {t('Leave empty to disable cloud sync and keep data local') ||
                'اتركه فارغاً لتعطيل المزامنة وإبقاء البيانات محلية'}
            </p>
          </div>

          {/* API Key */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">
              {t('API Key') || 'مفتاح الـ API'}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Key size={18} />
              </div>
              <input
                type="password"
                dir="ltr"
                value={apiKey}
                onChange={(e) => setApiKeyState(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-sm font-sans focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
                placeholder="••••••••••••••••"
                autoComplete="off"
              />
            </div>
            <p className="text-[11px] text-gray-500 flex items-center gap-1">
              <ShieldCheck size={12} className="shrink-0" />
              {t('Stored securely in this device only — never in the app bundle') ||
                'يُحفظ على هذا الجهاز فقط ولا يُضمَّن في ملفات التطبيق'}
            </p>
          </div>

          {/* Error & Success Feedback */}
          {error && (
            <div className="flex items-start gap-2 text-red-600 text-sm font-bold bg-red-50 p-3 rounded-xl border border-red-100">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {testSuccess && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-xl border border-emerald-100">
              <ShieldCheck size={16} className="shrink-0" />
              <p>{t('Connection successful!') || 'تم الاتصال بنجاح!'}</p>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-xl border border-emerald-100">
              <ShieldCheck size={16} className="shrink-0" />
              <p>{t('Cloud sync settings saved!') || 'تم حفظ إعدادات المزامنة السحابية!'}</p>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 font-bold py-3.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 border border-gray-200"
            >
              <ExternalLink size={16} />
              {testing
                ? t('Testing...') || 'جاري الفحص...'
                : t('Test Connection') || 'اختبار الاتصال'}
            </button>

            <button
              onClick={handleSave}
              className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm"
            >
              {t('Save Changes') || 'حفظ الإعدادات'}
            </button>
          </div>

          {configured && (
            <button
              onClick={handleClear}
              className="w-full text-red-600 hover:text-red-700 text-xs font-medium py-2 transition-colors"
            >
              {t('Disable cloud sync and clear credentials') ||
                'تعطيل المزامنة السحابية ومسح البيانات'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
