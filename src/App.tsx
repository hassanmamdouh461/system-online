import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { LanguageProvider } from './context/LanguageContext';
import { ToastProvider } from './components/ui/Toast';
import { syncService } from './services/syncService';
import { requestPersistentStorage } from './repositories/indexeddb/db';
import { hydrateFromCloud, resetHydrateCache } from './services/cloudHydrate';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// Eager loaded core routes for instant interactive experience
import Login from './pages/Login';
import Orders from './pages/Orders';

function safeLazy<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory().catch((err) => {
      console.warn('[Lazy import failed, reloading page for new build]:', err);
      const lastReload = sessionStorage.getItem('chunk_error_reload');
      if (!lastReload || Date.now() - parseInt(lastReload, 10) > 10000) {
        sessionStorage.setItem('chunk_error_reload', Date.now().toString());
        window.location.reload();
      }
      return new Promise<{ default: T }>(() => {});
    })
  );
}

// Lazy loaded heavy routes for optimal bundle code-splitting
const Dashboard = safeLazy(() => import('./pages/Dashboard'));
const Menu = safeLazy(() => import('./pages/Menu'));
const Payment = safeLazy(() => import('./pages/Payment'));
const Reports = safeLazy(() => import('./pages/Reports'));
const ManagerDashboard = safeLazy(() => import('./pages/ManagerDashboard'));
const Settings = safeLazy(() => import('./pages/Settings'));
const PublicMenu = safeLazy(() => import('./pages/PublicMenu'));
const Inventory = safeLazy(() => import('./pages/Inventory'));
const Customers = safeLazy(() => import('./pages/Customers'));


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
      <Suspense fallback={<LoadingScreen />}>
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
        <Route path="*" element={<CashierDefaultRoute />} />
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
        // Open DB first (upgrade if needed) — POS must work even if cloud is down
        await requestPersistentStorage();
        const { getDB } = await import('./repositories/indexeddb/db');
        await getDB();

        // Cloud restore in background — never blocks POS UI for long
        resetHydrateCache();
        if (navigator.onLine) {
          void hydrateFromCloud(true)
            .then(async (result) => {
              console.info('[App boot] cloud hydrate:', result);
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
    return <LoadingScreen />;
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
