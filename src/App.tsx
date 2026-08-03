import { useState, useEffect, useRef, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { InlinePageSpinner } from './components/ui/InlinePageSpinner';
import { LanguageProvider } from './context/LanguageContext';
import { ToastProvider, useToast } from './components/ui/Toast';
import { syncService } from './services/syncService';
import { requestPersistentStorage } from './repositories/indexeddb/db';
import { hydrateFromCloud, resetHydrateCache } from './services/cloudHydrate';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { mustChangePassword } from './utils/settingsConfig';
import { isBackupStale, newerTimestamp } from './utils/backupFreshness';
import {
  checkCloudHealth,
  fetchCloudLastWrite,
  isCloudConfigured,
  getSessionRole,
  refreshCloudSessionRole,
  SESSION_EXPIRED_EVENT,
} from './services/cloudConfig';

// Direct eager imports for 100% instant navigation without chunk pauses or splash screens
import Login from './pages/Login';
import Orders from './pages/Orders';
import Dashboard from './pages/Dashboard';
import Menu from './pages/Menu';
import Payment from './pages/Payment';
import Reports from './pages/Reports';
import ManagerDashboard from './pages/ManagerDashboard';
import Settings from './pages/Settings';
import PublicMenu from './pages/PublicMenu';
import Inventory from './pages/Inventory';
import Customers from './pages/Customers';

function NotFound() {
  const location = useLocation();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-black text-gray-200 mb-4">404</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">الصفحة غير موجودة</h1>
        <p className="text-gray-500 mb-6 text-sm">
          <code className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">{location.pathname}</code>
          {' '}ليس له مسار صالح.
        </p>
        <a
          href="/"
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-3 rounded-xl transition-colors"
        >
          ← الرجوع للوحة التحكم
        </a>
      </div>
    </div>
  );
}

/**
 * Persistent alarm shown when the cloud backup has silently stopped working.
 *
 * The settings-page badge is only seen by someone who opens settings. A backup
 * outage is exactly the failure an operator will not go looking for — the POS
 * keeps working normally because writes queue into IndexedDB — so the warning
 * has to follow them onto every screen.
 *
 * Deliberately conservative: it stays silent unless there is real evidence of a
 * problem, because a banner that cries wolf gets ignored. It shows only when a
 * worker URL is configured (cloud is meant to be on) AND either the health probe
 * failed or the last successful write is older than the threshold.
 */
const BACKUP_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function BackupHealthBanner() {
  const [problem, setProblem] = useState<null | { kind: 'down' | 'stale'; detail: string }>(null);

  useEffect(() => {
    let cancelled = false;

    const formatAge = (iso: string): string => {
      const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
      if (hours < 24) return `${hours} ساعة`;
      return `${Math.floor(hours / 24)} يوم`;
    };

    const check = async () => {
      // Not configured at all is a deployment choice, not a regression — the
      // settings badge reports it and this banner stays out of the way.
      if (!isCloudConfigured()) {
        if (!cancelled) setProblem(null);
        return;
      }

      const [health, sync, cloudLastWrite] = await Promise.all([
        checkCloudHealth(),
        syncService.getHealth().catch(() => null),
        // The cloud's own last-write marker, from the session-protected route.
        // Without it this banner could only ever report a total outage.
        fetchCloudLastWrite().catch(() => null),
      ]);
      if (cancelled) return;

      if (!health.ok) {
        setProblem({
          kind: 'down',
          detail: health.db === 'unreachable' ? 'الوركر مش بيرد' : 'قاعدة البيانات السحابية مش بتستجيب',
        });
        return;
      }

      const lastGood = newerTimestamp(sync?.lastSuccessAt || null, cloudLastWrite);
      if (lastGood && isBackupStale(lastGood)) {
        setProblem({ kind: 'stale', detail: formatAge(lastGood) });
        return;
      }

      setProblem(null);
    };

    void check();
    const interval = setInterval(() => void check(), BACKUP_CHECK_INTERVAL_MS);
    // Re-check the moment the operator comes back to the tab or regains
    // connectivity, so recovery clears the banner without waiting for the timer.
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, []);

  if (!problem) return null;

  return (
    <div className="bg-red-600 text-white text-sm font-bold px-4 py-2 text-center">
      {problem.kind === 'down' ? (
        <>
          🔴 النسخ الاحتياطي السحابي متوقف ({problem.detail}). الأوردرات بتتحفظ على الجهاز دا بس —
          لو الجهاز ضاع البيانات تضيع معاه.{' '}
          <a href="/settings" className="underline hover:text-red-100">
            راجع الإعدادات
          </a>
        </>
      ) : (
        <>
          🔴 آخر نسخة احتياطية ناجحة بقالها {problem.detail}. يعني البيانات الجديدة مش واصلة السحاب.{' '}
          <a href="/settings" className="underline hover:text-red-100">
            راجع الإعدادات
          </a>
        </>
      )}
    </div>
  );
}

/**
 * Persistent warning shown while the account is still on the first-run
 * bootstrap password. The mustChangePassword() flag was previously written on
 * bootstrap login but never read anywhere, so nothing ever prompted the
 * operator to change it.
 */
function DefaultPasswordBanner() {
  const [visible, setVisible] = useState(() => mustChangePassword());

  useEffect(() => {
    const check = () => setVisible(mustChangePassword());
    window.addEventListener('storage', check);
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('storage', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="bg-red-600 text-white text-sm font-bold px-4 py-2 text-center">
      ⚠️ أنت تستخدم كلمة المرور الافتراضية. غيّرها الآن من{' '}
      <a href="/settings" className="underline hover:text-red-100">الإعدادات</a>
      {' '}لتأمين النظام.
    </div>
  );
}

/**
 * Turns a lapsed cloud session into a clear, actionable prompt.
 *
 * When the 12h session cookie expires (or is cleared) but the app still believes
 * it is signed in — e.g. a tab left open overnight, or a reload where the stored
 * login survives in localStorage but the cookie does not — authenticated cloud
 * reads 401 and, with no in-memory password to re-mint, cannot recover. Left
 * alone that reads as blank screens. cloudFetch emits SESSION_EXPIRED_EVENT in
 * exactly that case; here we surface it and drop the user back to login instead
 * of leaving them staring at empty data.
 */
function SessionExpiryWatcher() {
  const { isAuthenticated, logout } = useAuth();
  const toast = useToast();
  // Read auth state inside the handler without re-subscribing the listener.
  const authedRef = useRef(isAuthenticated);
  useEffect(() => {
    authedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    const onExpired = () => {
      // Nothing to expire on the login screen (or right after a logout).
      if (!authedRef.current) return;
      toast.error(
        'انتهت الجلسة — من فضلك سجّل الدخول من جديد. (Session expired — please log in again.)',
        'انتهت الجلسة'
      );
      // Clears the stored session → ProtectedRoute redirects to /login.
      logout();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [toast, logout]);

  return null;
}

function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return (
    <DataProvider>
      <DefaultPasswordBanner />
      <BackupHealthBanner />
      <Outlet />
    </DataProvider>
  );
}

function ManagerRoute() {
  const { user } = useAuth();
  const location = useLocation();
  if (user?.role !== 'manager') return <Navigate to="/manager-login" state={{ from: location }} replace />;
  return <Outlet />;
}

function CashierDefaultRoute() {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role === 'manager') return <Navigate to="/manager-dashboard" replace />;
  return <Navigate to="/orders" replace />;
}

function AppRoutes() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<InlinePageSpinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Same login UI; path contains "manager" so AuthContext assigns manager role */}
        <Route path="/manager-login" element={<Login />} />
        <Route path="/public-menu" element={<PublicMenu />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/pos" element={<Orders type="all" />} />
            <Route path="/orders" element={<Orders type="all" />} />
            {/*
              Dedicated kitchen screen. The board is also reachable from the
              Kitchen tab on /orders, but a standalone route lets a kitchen
              display be parked on it (and bookmarked) without the cashier
              screen loading first.
            */}
            <Route path="/kitchen" element={<Orders type="all" initialView="tracker" />} />
            <Route path="/drinks" element={<Navigate to="/orders" replace />} />
            <Route path="/payment" element={<Payment />} />

            <Route path="/customers" element={<Customers />} />
            <Route path="/settings" element={<Settings />} />

            {/* Manager Only Routes */}
            <Route element={<ManagerRoute />}>
              <Route path="/menu" element={<Menu />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/manager" element={<ManagerDashboard />} />
              <Route path="/manager-dashboard" element={<ManagerDashboard />} />
            </Route>
          </Route>
        </Route>
        <Route path="/" element={<CashierDefaultRoute />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}


function App() {
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    // Auto-redirect legacy pages.dev domain to primary pos.engaz.tech domain
    if (typeof window !== 'undefined' && window.location.hostname.includes('pages.dev')) {
      window.location.href = `https://pos.engaz.tech${window.location.pathname}${window.location.search}`;
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // One-time localStorage cleanup (locale/settings key dedup).
        // Runs before anything reads these keys, and is gated internally so
        // it only ever executes once per browser.
        try {
          const { migrateLocaleKeys } = await import('./utils/localeMigration');
          migrateLocaleKeys();
        } catch {
          // non-fatal
        }

        // Open DB first (upgrade if needed) — POS must work even if cloud is down
        await requestPersistentStorage();
        const { getDB } = await import('./repositories/indexeddb/db');
        await getDB();

        // Cloud restore in background — never blocks POS UI for long.
        resetHydrateCache();
        if (navigator.onLine) {
          // Only touch the AUTHENTICATED cloud endpoints when a session actually
          // exists. Before login there is no cookie, so an unconditional boot
          // hydrate fired a 401 at every collection (orders, menu, customers,
          // inventory, companies, recipes, transactions, settings) — a needless
          // 401 storm that also masked the real outage. Probe the session once
          // via GET /v1/session (its sanctioned status check: 401 → null when
          // unauthenticated, no storm). After login, DataProvider (mounted inside
          // ProtectedRoute) performs the hydrate; on an authenticated reload the
          // still-valid cookie makes this probe succeed and we hydrate here too.
          const hasSession = isCloudConfigured()
            ? !!(getSessionRole() || (await refreshCloudSessionRole()))
            : false;

          if (hasSession) {
            void hydrateFromCloud(true)
              .then(async (result) => {
                if (import.meta.env.DEV) {
                  console.debug('[App boot] cloud hydrate:', result);
                }
                // If wipe left everything empty, try last full snapshot
                try {
                  const { restoreFromSnapshotIfNeeded, startSnapshotScheduler } = await import(
                    './services/snapshotService'
                  );
                  await restoreFromSnapshotIfNeeded(result);
                  startSnapshotScheduler();
                } catch (snapErr) {
                  console.warn('[App boot] snapshot restore/schedule failed:', snapErr);
                }
                await syncService.resetDeadRecords();
                await syncService.syncPendingData();
              })
              .catch((err) => console.warn('[App boot] hydrate/sync failed:', err));
          } else {
            // Not signed in yet — skip cloud reads to avoid pre-login 401s. Data
            // hydrates right after login. Still start the snapshot scheduler so
            // backups resume automatically once a session is established.
            void import('./services/snapshotService')
              .then((m) => m.startSnapshotScheduler())
              .catch(() => {});
          }
        } else {
          // Offline: still start snapshot scheduler for when we come back online
          void import('./services/snapshotService')
            .then((m) => m.startSnapshotScheduler())
            .catch(() => {});
        }
      } catch (err) {
        console.warn('[App boot] DB open failed:', err);
      } finally {
        if (!cancelled) setBootReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!bootReady) {
    return <InlinePageSpinner message="جاري إعداد النظام..." />;
  }


  return (
    <AuthProvider>
      <LanguageProvider>
        <ToastProvider>
          <SessionExpiryWatcher />
          <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AppRoutes />
          </Router>
        </ToastProvider>
      </LanguageProvider>
    </AuthProvider>
  );
}

export default App;
