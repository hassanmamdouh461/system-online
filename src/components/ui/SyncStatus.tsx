import React, { useState, useEffect, useCallback } from 'react';
import { Cloud, CloudOff, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '../../context/LanguageContext';
import { syncService } from '../../services/syncService';
import { getWorkerUrl, isCloudConfigured } from '../../services/cloudConfig';

interface SyncStatusData {
  state: 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'unconfigured';
  lastSyncAt: string | null;
  pendingCount: number;
  failedCount: number;
  lastError: string | null;
  workerUrl: string;
}

export function SyncStatus() {
  const { t, language } = useLanguage();
  const [syncStatus, setSyncStatus] = useState<SyncStatusData>({
    state: isCloudConfigured() ? 'idle' : 'unconfigured',
    lastSyncAt: null,
    pendingCount: 0,
    failedCount: 0,
    lastError: null,
    workerUrl: getWorkerUrl(),
  });

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const fetchWebQueueStatus = useCallback(async () => {
    try {
      if (!navigator.onLine) {
        setSyncStatus((prev) => ({ ...prev, state: 'offline', workerUrl: getWorkerUrl() }));
        return;
      }

      const health = await syncService.getHealth();
      if (!health.configured) {
        setSyncStatus((prev) => ({
          ...prev,
          state: 'unconfigured',
          pendingCount: health.pending,
          failedCount: health.failed,
          lastError:
            language === 'ar'
              ? 'لم يُضبط رابط Cloudflare Worker — البيانات محلية فقط وقد تُمسح'
              : 'Worker URL not configured — data is local-only and can be wiped',
          workerUrl: '',
          lastSyncAt: health.lastSuccessAt,
        }));
        return;
      }

      setSyncStatus((prev) => ({
        ...prev,
        state: health.failed > 0 ? 'error' : health.pending > 0 ? 'idle' : 'synced',
        pendingCount: health.pending,
        failedCount: health.failed,
        lastError: health.lastError,
        workerUrl: health.workerUrl,
        lastSyncAt: health.lastSuccessAt || prev.lastSyncAt,
      }));
    } catch (err) {
      console.error('Failed to read web sync queue:', err);
    }
  }, [language]);

  const fetchStatus = useCallback(async () => {
    if (isElectron && window.electronAPI?.getSyncStatus) {
      try {
        const status = await window.electronAPI.getSyncStatus();
        setSyncStatus({
          state: status.state,
          lastSyncAt: status.lastSyncAt,
          pendingCount: status.pendingCount,
          failedCount: 0,
          lastError: status.lastError,
          workerUrl: getWorkerUrl(),
        });
      } catch (err) {
        console.error('Failed to get sync status:', err);
      }
      return;
    }
    await fetchWebQueueStatus();
  }, [isElectron, fetchWebQueueStatus]);

  const handleSyncNow = async () => {
    setSyncStatus((prev) => ({ ...prev, state: 'syncing' }));
    try {
      if (isElectron && window.electronAPI?.triggerSync) {
        const status = await window.electronAPI.triggerSync();
        setSyncStatus({
          state: status.state,
          lastSyncAt: status.lastSyncAt,
          pendingCount: status.pendingCount,
          failedCount: 0,
          lastError: status.lastError,
          workerUrl: getWorkerUrl(),
        });
        return;
      }
      if (!isCloudConfigured()) {
        setSyncStatus((prev) => ({
          ...prev,
          state: 'unconfigured',
          lastError:
            language === 'ar'
              ? 'اضبط VITE_CLOUDFLARE_WORKER_URL ثم أعد البناء'
              : 'Set VITE_CLOUDFLARE_WORKER_URL then rebuild',
        }));
        return;
      }
      await syncService.resetDeadRecords();
      await syncService.syncPendingData();
      await fetchWebQueueStatus();
      setSyncStatus((prev) => ({
        ...prev,
        lastSyncAt: new Date().toISOString(),
        state: prev.failedCount > 0 ? 'error' : prev.pendingCount > 0 ? 'idle' : 'synced',
      }));
    } catch (err) {
      console.error('Failed to trigger sync:', err);
      setSyncStatus((prev) => ({
        ...prev,
        state: 'error',
        lastError: err instanceof Error ? err.message : 'Sync failed',
      }));
    }
  };

  const handleBackupNow = async () => {
    setSyncStatus((prev) => ({ ...prev, state: 'syncing' }));
    try {
      const { createSnapshot } = await import('../../services/snapshotService');
      const res = await createSnapshot('manual');
      if (!res.ok) {
        setSyncStatus((prev) => ({
          ...prev,
          state: 'error',
          lastError:
            language === 'ar'
              ? `فشل النسخة الاحتياطية: ${res.error || 'unknown'}`
              : `Backup failed: ${res.error || 'unknown'}`,
        }));
        return;
      }
      setSyncStatus((prev) => ({
        ...prev,
        state: 'synced',
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      }));
    } catch (err) {
      setSyncStatus((prev) => ({
        ...prev,
        state: 'error',
        lastError: err instanceof Error ? err.message : 'Backup failed',
      }));
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15_000);

    if (isElectron && window.electronAPI?.onSyncStatusUpdate) {
      const unsubscribe = window.electronAPI.onSyncStatusUpdate((status) => {
        setSyncStatus({
          state: status.state,
          lastSyncAt: status.lastSyncAt,
          pendingCount: status.pendingCount,
          failedCount: 0,
          lastError: status.lastError,
          workerUrl: getWorkerUrl(),
        });
      });
      return () => {
        clearInterval(interval);
        unsubscribe();
      };
    }

    const onOnline = () => fetchStatus();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
    };
  }, [fetchStatus, isElectron]);

  const getStatusConfig = () => {
    switch (syncStatus.state) {
      case 'syncing':
        return {
          icon: RefreshCw,
          color: 'text-sky-600',
          bgColor: 'bg-sky-50',
          borderColor: 'border-sky-200',
          label: t('Syncing Data...'),
          description:
            language === 'ar'
              ? 'جاري رفع التحديثات إلى Cloudflare D1...'
              : 'Pushing local updates to Cloudflare D1...',
          spin: true,
        };
      case 'synced':
        return {
          icon: CheckCircle2,
          color: 'text-emerald-600',
          bgColor: 'bg-emerald-50',
          borderColor: 'border-emerald-200',
          label: language === 'ar' ? 'متزامن مع السحابة' : 'Fully Synced to Cloud',
          description:
            language === 'ar'
              ? 'البيانات محفوظة على Cloudflare D1 — لن تضيع بمسح المتصفح'
              : 'Data saved on Cloudflare D1 — survives browser clear',
          spin: false,
        };
      case 'offline':
        return {
          icon: CloudOff,
          color: 'text-amber-600',
          bgColor: 'bg-amber-50',
          borderColor: 'border-amber-200',
          label: language === 'ar' ? 'وضع عدم الاتصال' : 'Offline Mode',
          description:
            language === 'ar'
              ? 'التغييرات تُحفظ محلياً حتى يعود الاتصال'
              : 'Changes saved locally until online',
          spin: false,
        };
      case 'unconfigured':
        return {
          icon: AlertCircle,
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          label: language === 'ar' ? 'السحابة غير مفعّلة' : 'Cloud Not Configured',
          description:
            language === 'ar'
              ? 'البيانات محلية فقط — مسح بيانات الموقع سيحذفها. اضبط VITE_CLOUDFLARE_WORKER_URL'
              : 'Local-only mode — clearing site data will wipe sales. Set VITE_CLOUDFLARE_WORKER_URL',
          spin: false,
        };
      case 'error':
        return {
          icon: AlertCircle,
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          label: language === 'ar' ? 'خطأ مزامنة' : 'Sync Error',
          description:
            syncStatus.lastError ||
            (language === 'ar' ? 'فشل رفع بعض السجلات إلى D1' : 'Some records failed to upload to D1'),
          spin: false,
        };
      case 'idle':
      default:
        return {
          icon: Cloud,
          color: 'text-gray-600',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
          label:
            syncStatus.pendingCount > 0
              ? language === 'ar'
                ? 'بانتظار الرفع'
                : 'Pending upload'
              : language === 'ar'
                ? 'جاهز'
                : 'Ready',
          description:
            language === 'ar' ? 'محرك المزامنة جاهز للرفع إلى D1' : 'Sync engine ready to push to D1',
          spin: false,
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
          <div
            className={`w-10 h-10 md:w-12 md:h-12 rounded-full ${config.bgColor} border ${config.borderColor} flex items-center justify-center ${config.color} flex-shrink-0`}
          >
            <Icon size={20} className={config.spin ? 'animate-spin' : ''} />
          </div>

          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2 mb-1">
              <Cloud size={16} className="text-gray-400 flex-shrink-0" />
              <h3 className={`font-semibold ${config.color} text-sm md:text-base`}>
                {language === 'ar' ? 'المزامنة:' : 'Sync:'} {config.label}
              </h3>
            </div>

            <p className="text-xs md:text-sm text-gray-600 mb-2">{config.description}</p>

            <div className="space-y-1 text-xs text-gray-500">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-700">
                  {language === 'ar' ? 'معلّق:' : 'Pending:'}
                </span>
                <span
                  className={`font-bold px-2 py-0.5 rounded-full text-xs ${
                    syncStatus.pendingCount > 0
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {syncStatus.pendingCount}
                </span>
                {syncStatus.failedCount > 0 && (
                  <span className="font-bold px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">
                    {syncStatus.failedCount} {language === 'ar' ? 'فشل' : 'failed'}
                  </span>
                )}
              </div>
              {syncStatus.workerUrl ? (
                <div className="flex items-center gap-2 truncate">
                  <span className="font-semibold text-gray-700 shrink-0">Worker:</span>
                  <span className="truncate font-mono text-[10px]">{syncStatus.workerUrl}</span>
                </div>
              ) : null}
              {syncStatus.lastSyncAt ? (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-700">
                    {language === 'ar' ? 'آخر مزامنة:' : 'Last synced:'}
                  </span>
                  <span>{new Date(syncStatus.lastSyncAt).toLocaleString()}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 flex-shrink-0">
          <button
            onClick={handleSyncNow}
            disabled={syncStatus.state === 'syncing'}
            className={`mobile-touch-target p-2.5 rounded-xl ${config.bgColor} ${config.color} border ${config.borderColor} hover:bg-white active:scale-95 transition-all disabled:opacity-50 tap-highlight-none shadow-sm flex items-center justify-center`}
            title={language === 'ar' ? 'مزامنة الآن' : 'Sync now'}
          >
            <RefreshCw size={18} className={syncStatus.state === 'syncing' ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleBackupNow}
            disabled={syncStatus.state === 'syncing' || !isCloudConfigured()}
            className="mobile-touch-target px-2.5 py-2 rounded-xl bg-white text-mocha-700 border border-mocha-200 hover:bg-mocha-50 active:scale-95 transition-all disabled:opacity-50 tap-highlight-none shadow-sm text-[10px] font-semibold"
            title={language === 'ar' ? 'نسخة احتياطية كاملة الآن' : 'Full backup now'}
          >
            {language === 'ar' ? 'نسخة' : 'Backup'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
