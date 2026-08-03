import { useState, useEffect, useCallback } from 'react';
import { Database, Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '../../context/LanguageContext';
import { checkCloudHealth, fetchCloudLastWrite, getWorkerUrl, type CloudHealth } from '../../services/cloudConfig';
import { syncService } from '../../services/syncService';
import { newerTimestamp, isBackupStale } from '../../utils/backupFreshness';

/**
 * Honest cloud-database status.
 *
 * This component used to call `menuService.getAll()` and report "Cloudflare D1
 * Connected — fully operational" whenever that resolved. menuService reads
 * IndexedDB first, so it succeeds even with the worker completely offline: the
 * badge stayed green while nothing was reaching the cloud, which is the worst
 * possible failure mode for a backup indicator. It now probes GET /api/health,
 * which runs a real query against D1 inside the worker.
 */
type ConnectionStatus = 'checking' | 'connected' | 'stale' | 'error' | 'unconfigured';

export function DatabaseStatus() {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [health, setHealth] = useState<CloudHealth | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkConnection = useCallback(async () => {
    setStatus('checking');

    const [result, syncHealth, cloudLastWrite] = await Promise.all([
      checkCloudHealth(),
      syncService.getHealth().catch(() => null),
      // Authenticated probe — /api/health is public and carries no timestamp.
      fetchCloudLastWrite().catch(() => null),
    ]);

    setHealth(result);
    setLastChecked(new Date());

    // Two independent signals: the local queue's high-water mark (when THIS
    // device last pushed) and the newest write the CLOUD can see (which covers a
    // device that has only ever read — an empty queue used to read "never").
    // Take whichever is newer; a null on either side must not win.
    const lastSync = newerTimestamp(syncHealth?.lastSuccessAt || null, cloudLastWrite);
    setLastSuccessAt(lastSync);

    if (result.db === 'unconfigured') {
      setStatus('unconfigured');
      return;
    }
    if (!result.ok) {
      setStatus('error');
      return;
    }
    // The worker and D1 are healthy, but if nothing has landed in a long time
    // the operator still needs to know — a reachable database that is not
    // receiving writes is not a working backup.
    setStatus(isBackupStale(lastSync) ? 'stale' : 'connected');
  }, []);

  useEffect(() => {
    void checkConnection();
    const interval = setInterval(() => void checkConnection(), 60000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  const formatAge = (iso: string | null): string => {
    if (!iso) return isAr ? 'لا يوجد' : 'never';
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return isAr ? 'الآن' : 'just now';
    if (mins < 60) return isAr ? `منذ ${mins} دقيقة` : `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return isAr ? `منذ ${hours} ساعة` : `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return isAr ? `منذ ${days} يوم` : `${days}d ago`;
  };

  const getStatusConfig = () => {
    switch (status) {
      case 'checking':
        return {
          icon: RefreshCw,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          label: isAr ? 'جاري التحقق...' : 'Checking...',
          description: isAr
            ? 'يتم الآن فحص الاتصال الفعلي بقاعدة بيانات Cloudflare D1'
            : 'Running a live query against the Cloudflare D1 database',
        };
      case 'connected':
        return {
          icon: Wifi,
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          label: isAr ? 'النسخ الاحتياطي السحابي يعمل' : 'Cloud backup verified',
          description: isAr
            ? 'الوركر رد على فحص الصحة وقاعدة D1 استجابت لاستعلام حقيقي'
            : 'The worker answered and D1 responded to a real query',
        };
      case 'stale':
        return {
          icon: AlertTriangle,
          color: 'text-amber-600',
          bgColor: 'bg-amber-50',
          borderColor: 'border-amber-200',
          label: isAr
            ? 'متصلة — لكن مفيش نسخ جديد'
            : 'Connected — but no recent backup',
          description: isAr
            ? 'D1 متصلة، لكن آخر كتابة ناجحة بقالها أكتر من ٦ ساعات. راجع طابور المزامنة.'
            : 'D1 is reachable, but the last successful write is over 6 hours old. Check the sync queue.',
        };
      case 'unconfigured':
        return {
          icon: WifiOff,
          color: 'text-gray-600',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
          label: isAr ? 'السحاب غير مهيّأ' : 'Cloud not configured',
          description: isAr
            ? 'مفيش رابط للـ Worker، فمفيش أي نسخ احتياطي سحابي. البيانات محلية بس.'
            : 'No worker URL is set, so nothing is being backed up. Data is local only.',
        };
      case 'error':
        return {
          icon: WifiOff,
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          label: isAr ? 'النسخ الاحتياطي متوقف' : 'Cloud backup is DOWN',
          description: isAr
            ? 'فحص الصحة فشل — البيانات الجديدة محفوظة محلياً بس ومش بتوصل السحاب.'
            : 'The health probe failed — new data is saved locally only and is NOT reaching the cloud.',
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;
  const workerUrl = getWorkerUrl();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border ${config.borderColor} ${config.bgColor} rounded-xl p-4 md:p-5`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div
            className={`w-10 h-10 md:w-12 md:h-12 rounded-full ${config.bgColor} border ${config.borderColor} flex items-center justify-center ${config.color} flex-shrink-0`}
          >
            <Icon size={20} className={status === 'checking' ? 'animate-spin' : ''} />
          </div>

          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2 mb-1">
              <Database size={16} className="text-gray-400 flex-shrink-0" />
              <h3 className={`font-semibold ${config.color} text-sm md:text-base`}>
                {isAr ? 'حالة قاعدة البيانات:' : 'Database Status:'} {config.label}
              </h3>
            </div>
            <p className="text-xs md:text-sm text-gray-600 mb-2">{config.description}</p>

            <div className="space-y-1 text-xs text-gray-500">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-700">{isAr ? 'النوع:' : 'Type:'}</span>
                <span>{isAr ? 'سحابي (Cloudflare D1)' : 'Cloudflare D1 Database'}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-700">
                  {isAr ? 'رابط الاتصال:' : 'Endpoint:'}
                </span>
                <span className="font-mono break-all">
                  {workerUrl || (isAr ? 'غير مضبوط' : 'not set')}
                </span>
              </div>
              {/* The number that actually matters for a backup indicator. */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-700">
                  {isAr ? 'آخر نسخة ناجحة:' : 'Last successful backup:'}
                </span>
                <span
                  className={
                    status === 'stale' || status === 'error' ? 'font-bold text-red-600' : ''
                  }
                >
                  {formatAge(lastSuccessAt)}
                </span>
              </div>
              {typeof health?.orderCount === 'number' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-700">
                    {isAr ? 'أوردرات في السحاب:' : 'Orders in cloud:'}
                  </span>
                  <span>{health.orderCount}</span>
                </div>
              )}
              {health?.message && status === 'error' && (
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="font-semibold text-gray-700">{isAr ? 'السبب:' : 'Reason:'}</span>
                  <span className="font-mono text-red-600 break-all">{health.message}</span>
                </div>
              )}
              {lastChecked && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-700">
                    {isAr ? 'آخر فحص:' : 'Last checked:'}
                  </span>
                  <span>{lastChecked.toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => void checkConnection()}
          disabled={status === 'checking'}
          className={`mobile-touch-target p-2 rounded-lg ${config.bgColor} ${config.color} hover:opacity-80 transition-opacity disabled:opacity-50 flex-shrink-0 tap-highlight-none`}
          title={isAr ? 'إعادة فحص الاتصال' : 'Refresh connection status'}
        >
          <RefreshCw size={18} className={status === 'checking' ? 'animate-spin' : ''} />
        </button>
      </div>
    </motion.div>
  );
}
