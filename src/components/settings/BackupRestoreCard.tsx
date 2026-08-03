import { useRef, useState } from 'react';
import { Download, Upload, CloudDownload, Loader2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import {
  exportLocalBackup,
  importBackupFromFile,
  restoreLatestSnapshotNow,
  RestoreCounts,
} from '../../services/snapshotService';

/**
 * Settings → Backup & Restore (manager-only section).
 *
 * Three deliberately separate actions:
 *   • Export  — downloads the CURRENT local data as JSON. Fully offline.
 *   • Import  — merges a previously exported JSON file back in. Fully offline.
 *   • Restore — pulls the latest cloud snapshot and merges it. Needs network.
 *
 * All three MERGE by id (never wipe live rows) — see
 * snapshotService.applySnapshotPayload.
 */
export function BackupRestoreCard() {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | 'restore' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const summary = (c: RestoreCounts) =>
    ar
      ? `تم الدمج: ${c.orders} طلب، ${c.menu} صنف منيو، ${c.customers} عميل، ${c.inventory} مخزون`
      : `Merged: ${c.orders} orders, ${c.menu} menu items, ${c.customers} customers, ${c.inventory} inventory`;

  const onExport = async () => {
    setBusy('export');
    setMessage(null);
    try {
      await exportLocalBackup();
      setMessage({ kind: 'ok', text: ar ? 'تم تنزيل ملف النسخة الاحتياطية.' : 'Backup file downloaded.' });
    } catch (e: any) {
      setMessage({ kind: 'err', text: ar ? 'فشل التصدير.' : 'Export failed.' });
    } finally {
      setBusy(null);
    }
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    setBusy('import');
    setMessage(null);
    try {
      const counts = await importBackupFromFile(file);
      if (counts) {
        setMessage({ kind: 'ok', text: summary(counts) });
      } else {
        setMessage({
          kind: 'err',
          text: ar ? 'الملف ليس نسخة احتياطية صالحة.' : 'Not a valid backup file.',
        });
      }
    } catch {
      setMessage({ kind: 'err', text: ar ? 'فشل الاستيراد.' : 'Import failed.' });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onCloudRestore = async () => {
    setBusy('restore');
    setMessage(null);
    try {
      const counts = await restoreLatestSnapshotNow();
      if (counts) {
        setMessage({ kind: 'ok', text: summary(counts) });
      } else {
        setMessage({
          kind: 'err',
          text: ar ? 'لا توجد نسخة سحابية متاحة.' : 'No cloud snapshot available.',
        });
      }
    } catch {
      setMessage({ kind: 'err', text: ar ? 'فشل الاسترجاع من السحابة.' : 'Cloud restore failed.' });
    } finally {
      setBusy(null);
    }
  };

  const row = (
    icon: typeof Download,
    label: string,
    desc: string,
    action: () => void,
    which: 'export' | 'import' | 'restore'
  ) => {
    const Icon = icon;
    return (
      <button
        onClick={action}
        disabled={busy !== null}
        className="mobile-touch-target w-full flex items-center gap-4 p-4 hover:bg-gray-50 rounded-xl transition-colors text-left group tap-highlight-none disabled:opacity-50"
      >
        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-mocha-50 group-hover:text-mocha-700 transition-colors">
          {busy === which ? <Loader2 size={20} className="animate-spin" /> : <Icon size={20} />}
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-gray-900 text-sm md:text-base">{label}</h3>
          <p className="text-xs md:text-sm text-gray-500">{desc}</p>
        </div>
      </button>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 md:px-6 py-4 bg-gray-50 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">
          {ar ? 'النسخ الاحتياطي والاسترجاع' : 'Backup & Restore'}
        </h2>
      </div>
      <div className="p-2">
        {row(
          Download,
          ar ? 'تصدير نسخة احتياطية' : 'Export backup',
          ar ? 'تنزيل بيانات الجهاز كملف JSON (يعمل بدون إنترنت)' : 'Download this device\'s data as JSON (works offline)',
          onExport,
          'export'
        )}
        {row(
          Upload,
          ar ? 'استيراد من ملف' : 'Import from file',
          ar ? 'دمج نسخة JSON محفوظة في البيانات الحالية (يعمل بدون إنترنت)' : 'Merge a saved JSON backup into current data (works offline)',
          () => fileRef.current?.click(),
          'import'
        )}
        {row(
          CloudDownload,
          ar ? 'استرجاع من السحابة' : 'Restore from cloud',
          ar ? 'دمج أحدث نسخة احتياطية سحابية في هذا الجهاز' : 'Merge the latest cloud snapshot into this device',
          onCloudRestore,
          'restore'
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void onImportFile(e.target.files?.[0] || null)}
        />
        {message && (
          <p
            className={`px-4 pb-3 text-xs md:text-sm ${
              message.kind === 'ok' ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
