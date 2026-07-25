import React, { useState, useEffect, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { InlinePageSpinner } from './components/ui/InlinePageSpinner';
import { LanguageProvider } from './context/LanguageContext';
import { ToastProvider } from './components/ui/Toast';
import { syncService } from './services/syncService';
import { requestPersistentStorage } from './repositories/indexeddb/db';
import { hydrateFromCloud, resetHydrateCache } from './services/cloudHydrate';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

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

function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return (
    <DataProvider>
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

        // Cloud restore in background — never blocks POS UI for long
        resetHydrateCache();
        if (navigator.onLine) {
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
          <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AppRoutes />
          </Router>
        </ToastProvider>
      </LanguageProvider>
    </AuthProvider>
  );
}

export default App;
