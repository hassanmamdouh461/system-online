import React from 'react';
import { Menu, Bell, User } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';

interface MobileHeaderProps {
  onMenuClick: () => void;
}

export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  const location = useLocation();
  
  const getPageTitle = () => {
    const path = location.pathname;
    const titles: Record<string, string> = {
      '/dashboard': 'Dashboard',
      '/menu': 'Menu',
      '/orders': 'Orders',
      '/payment': 'Payment',
      '/reports': 'Reports',
      '/manager-dashboard': 'Manager Dashboard',
      '/settings': 'Settings',
    };
    return titles[path] || 'BrewMaster';
  };

  return (
    <header className="sm:hidden fixed top-0 left-0 right-0 z-30 pt-safe-top">
      {/* Subtle gradient background */}
      <div className="relative bg-gradient-to-r from-mocha-100 via-cream to-caramel-light border-b border-mocha-200/50">
        <div className="bg-white/95 backdrop-blur-xl">
          <div className="flex items-center justify-between px-3 py-3.5">
            {/* Menu Button */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={onMenuClick}
              className="mobile-touch-target p-2.5 rounded-xl bg-mocha-100/80 text-mocha-800 hover:bg-mocha-200/80 transition-all shadow-sm border border-mocha-200/50"
            >
              <Menu size={22} strokeWidth={2} />
            </motion.button>

            {/* Page Title - softer gradient */}
            <motion.h1 
              key={getPageTitle()}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-base font-bold text-gray-800"
            >
              {getPageTitle()}
            </motion.h1>

            {/* Right Actions */}
            <div className="flex items-center gap-2">
              {/* Notifications */}
              <motion.button 
                whileTap={{ scale: 0.95 }}
                className="mobile-touch-target relative p-2.5 rounded-xl bg-blue-50/80 text-blue-600 hover:bg-blue-100/80 transition-all shadow-sm border border-blue-100/50"
              >
                <Bell size={20} strokeWidth={2} />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-caramel rounded-full border-2 border-white shadow-sm" />
              </motion.button>

              {/* User Avatar - softer gradient */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="mobile-touch-target w-9 h-9 rounded-xl bg-gradient-to-br from-mocha-500 to-coffee-dark flex items-center justify-center text-white shadow-sm hover:shadow-md transition-all"
              >
                <User size={18} strokeWidth={2} />
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
