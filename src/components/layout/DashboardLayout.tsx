import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';
import { TopNav } from './TopNav';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function DashboardLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  const isManagerRoute = location.pathname.startsWith('/manager');
  const isManager = user?.role === 'manager' || isManagerRoute;

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* Desktop Top Navigation Bar */}
      {!isManager && <TopNav />}

      {/* Mobile Header */}
      {!isManager && <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />}
      
      {/* Lower layout wrapper */}
      <div className="flex-grow flex overflow-hidden relative">
        {/* Sidebar - Mobile Drawer only */}
        {!isManager && (
          <Sidebar 
            mobileOpen={mobileMenuOpen} 
            onMobileClose={() => setMobileMenuOpen(false)} 
          />
        )}
        
        {/* Main Content */}
        <main className={`flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 p-2 sm:p-3 pb-20 sm:pb-2 md:pb-3 ${
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
