import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, ShoppingBag, CreditCard, BarChart3, Building2, Settings, Package, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

export function MobileNav() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const navItems = user?.role === 'manager'
    ? [
        { icon: Building2, label: t('Manager') || 'Manager', path: '/manager-dashboard' },
        { icon: Package, label: t('Inventory'), path: '/inventory' },
        { icon: Users, label: t('Customers'), path: '/customers' },
        { icon: BarChart3, label: t('Reports'), path: '/reports' },
        { icon: Settings, label: t('Settings'), path: '/settings' },
      ]
    : [
        { icon: ShoppingBag, label: t('Orders') || 'Orders', path: '/orders' },
        { icon: CreditCard, label: t('Payment') || 'Pay', path: '/payment' },
        { icon: Users, label: t('Customers'), path: '/customers' },
        { icon: Home, label: t('Home') || 'Home', path: '/dashboard' },
        { icon: Settings, label: t('Settings'), path: '/settings' },
      ];

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 pb-safe-bottom">
      <div className="relative mx-0 mb-0 rounded-none overflow-hidden">
        <div className="relative bg-white/98 backdrop-blur-xl border-t border-gray-200 shadow-[0_-2px_12px_rgba(0,0,0,0.08)]">
          <div className="flex items-center px-0.5 py-1.5">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `relative flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 py-1.5 rounded-xl transition-all duration-300 mobile-touch-target tap-highlight-none ${
                    isActive
                      ? 'text-mocha-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.div
                        layoutId="mobile-nav-pill"
                        className="absolute inset-1 bg-mocha-50 rounded-xl -z-0"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    <item.icon size={18} className="relative z-10" strokeWidth={isActive ? 2.5 : 2} />
                    <span className="relative z-10 text-[9px] font-bold truncate max-w-full px-0.5">
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
