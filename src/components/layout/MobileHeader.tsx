import React from 'react';
import { Menu, LogOut } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

interface MobileHeaderProps {
  onMenuClick: () => void;
}

export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { language } = useLanguage();

  
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

              {/* Logout Button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
                className="mobile-touch-target p-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-all shadow-sm border border-red-100"
                title={language === 'ar' ? 'تسجيل الخروج' : 'Logout'}
              >
                <LogOut size={18} strokeWidth={2} />
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}


