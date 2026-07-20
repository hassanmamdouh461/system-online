import React, { useState, useEffect } from 'react';
import { X, Send, Key, Hash, Clock, ShieldCheck, AlertCircle, ToggleLeft, ToggleRight } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getTelegramConfig, setTelegramConfig } from '../../utils/settingsConfig';

interface TelegramConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TelegramConfigModal({ isOpen, onClose }: TelegramConfigModalProps) {
  const { t } = useLanguage();
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [reportTime, setReportTime] = useState('23:00');
  const [enabled, setEnabled] = useState(false);
  
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const config = getTelegramConfig();
      setBotToken(config.botToken);
      setChatId(config.chatId);
      setReportTime(config.reportTime);
      setEnabled(config.enabled);
      setSuccess(false);
      setTestSuccess(false);
      setError('');
    }
  }, [isOpen]);

  const handleSave = () => {
    setError('');
    setSuccess(false);

    if (enabled) {
      if (!botToken.trim()) {
        setError('Telegram Bot Token is required when enabled');
        return;
      }
      if (!chatId.trim()) {
        setError('Telegram Chat ID is required when enabled');
        return;
      }
    }

    setTelegramConfig({
      botToken: botToken.trim(),
      chatId: chatId.trim(),
      reportTime: reportTime.trim(),
      enabled: enabled,
    });

    setSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  const handleTestSend = async () => {
    setError('');
    setTestSuccess(false);

    if (!botToken.trim()) {
      setError('Enter Bot Token first to send a test message');
      return;
    }
    if (!chatId.trim()) {
      setError('Enter Chat ID first to send a test message');
      return;
    }

    setTesting(true);
    try {
      const url = `https://api.telegram.org/bot${botToken.trim()}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId.trim(),
          text: `🧪 <b>رسالة تجريبية من نظام BrewMaster POS</b>\n\nتم إعداد البوت ومحادثة تليجرام بنجاح! ستصلك التقارير اليومية هنا في الموعد المحدد.`,
          parse_mode: 'HTML'
        })
      });

      const data = await response.json();
      if (data.ok) {
        setTestSuccess(true);
      } else {
        throw new Error(data.description || 'Failed to send message');
      }
    } catch (err: any) {
      console.error('[TelegramConfig] Test message failed:', err);
      setError(`خطأ أثناء الإرسال: ${err.message || 'يرجى التحقق من صحة التوكن والمعرف'}`);
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-sky-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl text-white">
              <Send size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('Telegram Configuration') || 'إعدادات التليجرام'}</h2>
              <p className="text-sky-100 text-xs">{t('Configure Telegram report notifications') || 'إعداد تقارير المبيعات على التليجرام'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-gray-800">
          
          {/* Toggle Enabled */}
          <div className="flex items-center justify-between bg-gray-50 p-3.5 rounded-xl border border-gray-100">
            <div>
              <label className="text-sm font-bold text-gray-800 block">
                {t('Enable Telegram Reports') || 'تفعيل تقارير التليجرام'}
              </label>
              <span className="text-xs text-gray-500">
                {t('Send automatic daily sales reports') || 'إرسال تقرير المبيعات تلقائياً كل يوم'}
              </span>
            </div>
            <button 
              type="button"
              onClick={() => setEnabled(!enabled)}
              className="text-sky-600 hover:text-sky-700 transition-colors outline-none"
            >
              {enabled ? <ToggleRight size={44} strokeWidth={1.5} /> : <ToggleLeft size={44} strokeWidth={1.5} className="text-gray-400" />}
            </button>
          </div>

          {/* Bot Token */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">
              {t('Telegram Bot Token') || 'رمز البوت (Bot Token)'}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Key size={18} />
              </div>
              <input
                type="text"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-sm font-sans focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-all"
                placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
              />
            </div>
          </div>

          {/* Chat ID */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">
              {t('Telegram Chat ID') || 'معرف المحادثة (Chat ID)'}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Hash size={18} />
              </div>
              <input
                type="text"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-sm font-sans focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-all"
                placeholder="-100123456789 أو 123456789"
              />
            </div>
            <p className="text-[11px] text-gray-500">
              يمكنك استخدام محادثة خاصة أو معرف مجموعة/قناة يبدأ بـ -100
            </p>
          </div>

          {/* Report Time */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">
              {t('Report Send Time') || 'وقت إرسال التقرير التلقائي'}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                <Clock size={18} />
              </div>
              <input
                type="time"
                value={reportTime}
                onChange={(e) => setReportTime(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-11 pr-4 py-3 text-sm font-semibold focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-all"
              />
            </div>
          </div>

          {/* Error & Success Feedback */}
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm font-bold bg-red-50 p-3 rounded-xl border border-red-100 animate-pulse">
              <AlertCircle size={16} className="shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {testSuccess && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-xl border border-emerald-100">
              <ShieldCheck size={16} className="shrink-0" />
              <p>تم إرسال الرسالة التجريبية بنجاح! تفقد هاتفك.</p>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-xl border border-emerald-100">
              <ShieldCheck size={16} className="shrink-0" />
              <p>تم حفظ إعدادات تليجرام بنجاح!</p>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={handleTestSend}
              disabled={testing}
              className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 font-bold py-3.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 border border-gray-200"
            >
              <Send size={16} />
              {testing ? 'جاري الإرسال...' : 'رسالة تجريبية'}
            </button>
            
            <button
              onClick={handleSave}
              className="bg-sky-600 hover:bg-sky-700 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm"
            >
              {t('Save Changes') || 'حفظ الإعدادات'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
