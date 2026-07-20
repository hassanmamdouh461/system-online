import React, { useState, useEffect } from 'react';
import { Database, Cloud, CloudOff, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '../../context/LanguageContext';

interface SyncStatusData {
  state: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
  lastSyncAt: string | null;
  pendingCount: number;
  lastError: string | null;
}

export function SyncStatus() {
  const { t, language } = useLanguage();
  const [syncStatus, setSyncStatus] = useState<SyncStatusData>({
    state: 'idle',
    lastSyncAt: null,
    pendingCount: 0,
    lastError: null
  });

  const fetchStatus = async () => {
    if (window.electronAPI && typeof window.electronAPI.getSyncStatus === 'function') {
      try {
        const status = await window.electronAPI.getSyncStatus();
        setSyncStatus(status);
      } catch (err) {
        console.error('Failed to get sync status:', err);
      }
    }
  };

  const handleSyncNow = async () => {
    if (window.electronAPI && typeof window.electronAPI.triggerSync === 'function') {
      try {
        setSyncStatus(prev => ({ ...prev, state: 'syncing' }));
        const status = await window.electronAPI.triggerSync();
        setSyncStatus(status);
      } catch (err) {
        console.error('Failed to trigger sync:', err);
      }
    }
  };

  useEffect(() => {
    fetchStatus();

    // Register listener for live sync updates
    if (window.electronAPI && typeof window.electronAPI.onSyncStatusUpdate === 'function') {
      const unsubscribe = window.electronAPI.onSyncStatusUpdate((status) => {
        setSyncStatus(status);
      });
      return () => unsubscribe();
    }
  }, []);

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const getStatusConfig = () => {
    if (!isElectron) {
      // Web Manager Portal Live Status Card
      return {
        icon: CheckCircle2,
        color: 'text-emerald-650',
        bgColor: 'bg-emerald-50',
        borderColor: 'border-emerald-200',
        label: language === 'ar' ? 'قناة المزامنة نشطة' : 'Live Channel Active',
        description: language === 'ar' 
          ? 'الموقع متصل بقناة الاستقبال المباشرة للمبيعات من كافة الفروع' 
          : 'Portal is connected to central cloud channel for real-time sales updates',
        spin: false
      };
    }

    switch (syncStatus.state) {
      case 'syncing':
        return {
          icon: RefreshCw,
          color: 'text-sky-600',
          bgColor: 'bg-sky-50',
          borderColor: 'border-sky-200',
          label: t('Syncing Data...'),
          description: t('Pushing local updates to central server'),
          spin: true
        };
      case 'synced':
        return {
          icon: CheckCircle2,
          color: 'text-emerald-600',
          bgColor: 'bg-emerald-50',
          borderColor: 'border-emerald-200',
          label: t('Fully Synced'),
          description: t('All local records are synced to central server'),
          spin: false
        };
      case 'offline':
        return {
          icon: CloudOff,
          color: 'text-amber-600',
          bgColor: 'bg-amber-50',
          borderColor: 'border-amber-200',
          label: t('Offline Mode'),
          description: t('Internet disconnected. Changes saved locally'),
          spin: false
        };
      case 'error':
        return {
          icon: AlertCircle,
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          label: t('Sync Error'),
          description: syncStatus.lastError || t('Failed to synchronize local updates'),
          spin: false
        };
      case 'idle':
      default:
        return {
          icon: Cloud,
          color: 'text-gray-600',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
          label: t('Sync Engine Idle'),
          description: t('Background sync engine is ready'),
          spin: false
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border ${config.borderColor} ${config.bgColor} rounded-xl p-4 md:p-5 transition-all duration-300`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          {/* Icon */}
          <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full ${config.bgColor} border ${config.borderColor} flex items-center justify-center ${config.color} flex-shrink-0`}>
            <Icon 
              size={20} 
              className={config.spin ? 'animate-spin' : ''} 
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2 mb-1">
              <Cloud size={16} className="text-gray-400 flex-shrink-0" />
              <h3 className={`font-semibold ${config.color} text-sm md:text-base`}>
                {language === 'ar' ? 'قناة المزامنة:' : 'Sync Channel:'} {config.label}
              </h3>
            </div>
            
            <p className="text-xs md:text-sm text-gray-600 mb-2">
              {config.description}
            </p>
            
            <div className="space-y-1 text-xs text-gray-500">
              {isElectron ? (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-700">{t('Pending Updates:')}</span>
                    <span className={`font-bold px-2 py-0.5 rounded-full text-xs ${syncStatus.pendingCount > 0 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                      {syncStatus.pendingCount} {t('records')}
                    </span>
                  </div>
                  {syncStatus.lastSyncAt && (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-700">{t('Last synced:')}</span>
                      <span>{new Date(syncStatus.lastSyncAt).toLocaleString()}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-700">{language === 'ar' ? 'الحالة:' : 'Status:'}</span>
                    <span className="font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full text-[11px]">
                      {language === 'ar' ? 'متصل ومستعد' : 'Connected & Active'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-700">{language === 'ar' ? 'الفروع المربوطة:' : 'Connected Branches:'}</span>
                    <span>{language === 'ar' ? 'الفرع الرئيسي (نشط)' : 'Main Branch (Active)'}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Sync Now Button - Electron Only */}
        {isElectron && (
          <button
            onClick={handleSyncNow}
            disabled={syncStatus.state === 'syncing'}
            className={`mobile-touch-target p-2.5 rounded-xl ${config.bgColor} ${config.color} border ${config.borderColor} hover:bg-white active:scale-95 transition-all disabled:opacity-50 flex-shrink-0 tap-highlight-none shadow-sm flex items-center justify-center`}
            title={t('Sync database changes now')}
          >
            <RefreshCw 
              size={18} 
              className={syncStatus.state === 'syncing' ? 'animate-spin' : ''} 
            />
          </button>
        )}
      </div>
    </motion.div>
  );
}
