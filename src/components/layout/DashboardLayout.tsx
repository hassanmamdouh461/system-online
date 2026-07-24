import React from 'react';
import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';
import { TopNav } from './TopNav';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function DashboardLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const isManagerRoute = location.pathname.startsWith('/manager');
  const isManager = user?.role === 'manager' || isManagerRoute;

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* Desktop Top Navigation Bar */}
      {!isManager && <TopNav />}

      {/* Mobile Header */}
      {!isManager && <MobileHeader />}
      
      {/* Lower layout wrapper */}
      <div className="flex-grow flex overflow-hidden relative">
        {/* Main Content */}
        <main className={`flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 p-2 sm:p-3 lg:p-4 pb-20 sm:pb-3 md:pb-4 ${
          isManager ? "pt-2 sm:pt-3" : "pt-[68px] sm:pt-3"
        }`}>
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      {!isManager && <MobileNav />}
    </div>
  );
}

