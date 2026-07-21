import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { LanguageProvider } from './context/LanguageContext';
import { syncService } from './services/syncService';
import { requestPersistentStorage } from './repositories/indexeddb/db';

import { DashboardLayout } from './components/layout/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Menu from './pages/Menu';
import Orders from './pages/Orders';
import Payment from './pages/Payment';
import Reports from './pages/Reports';
import ManagerDashboard from './pages/ManagerDashboard';
import Settings from './pages/Settings';
import Login from './pages/Login';
import PublicMenu from './pages/PublicMenu';
import Inventory from './pages/Inventory';

function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return (
    <DataProvider>
      <Outlet />
    </DataProvider>
  );
}

function ManagerRoute() {
  const { user } = useAuth();
  if (user?.role !== 'manager') return <Navigate to="/orders" replace />;
  return <Outlet />;
}

function CashierDefaultRoute() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to="/orders" replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/public-menu" element={<PublicMenu />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/pos" element={<Orders type="all" />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/orders" element={<Orders type="all" />} />
          <Route path="/drinks" element={<Orders type="drinks" />} />
          <Route path="/payment" element={<Payment />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/settings" element={<Settings />} />

          {/* Manager Only Routes */}
          <Route element={<ManagerRoute />}>
            <Route path="/reports" element={<Reports />} />
            <Route path="/manager" element={<ManagerDashboard />} />
            <Route path="/manager-dashboard" element={<ManagerDashboard />} />
          </Route>
        </Route>
      </Route>
      <Route path="/" element={<CashierDefaultRoute />} />
      <Route path="*" element={<CashierDefaultRoute />} />
    </Routes>
  );
}

function App() {
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    // Request persistent storage on load
    requestPersistentStorage();

    // Trigger initial sync check if online
    if (navigator.onLine) {
      syncService.syncPendingData();
    }

    const timer = setTimeout(() => setShowIntro(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (showIntro) {
    return <LoadingScreen />;
  }

  return (
    <AuthProvider>
      <LanguageProvider>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </Router>
      </LanguageProvider>
    </AuthProvider>
  );
}

export default App;
