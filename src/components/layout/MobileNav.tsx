import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, ShoppingBag, UtensilsCrossed, CreditCard, BarChart3, Building2, Settings } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';

export function MobileNav() {
  const { user } = useAuth();

  const navItems = user?.role === 'manager'
    ? [
        { icon: Building2, label: 'Manager', path: '/manager-dashboard' },
        { icon: Package, label: 'Inventory', path: '/inventory' },
        { icon: BarChart3, label: 'Reports', path: '/reports' },
        { icon: Settings, label: 'Settings', path: '/settings' },
      ]
    : [
        { icon: Home, label: 'Home', path: '/dashboard' },
        { icon: ShoppingBag, label: 'Orders', path: '/orders' },
        { icon: UtensilsCrossed, label: 'Menu', path: '/menu' },
        { icon: CreditCard, label: 'Payment', path: '/payment' },
      ];

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 pb-safe-bottom">
      {/* Subtle container */}
      <div className="relative mx-0 mb-0 rounded-none overflow-hidden">
        {/* Main navigation with soft background */}
        <div className="relative bg-white/98 backdrop-blur-xl border-t border-gray-200 shadow-[0_-2px_12px_rgba(0,0,0,0.08)]">
          <div className="flex items-center px-1 py-2">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `relative flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 py-2 rounded-xl transition-all duration-300 mobile-touch-target tap-highlight-none ${
                    isActive 
                      ? 'text-mocha-700' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Active background - softer */}
                    {isActive && (
                      <motion.div
                        layoutId="mobile-nav-indicator"
                        className="absolute inset-0 bg-mocha-50 rounded-xl border border-mocha-100/50"
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                      />
                    )}
                    
                    {/* Icon with subtle scale */}
                    <motion.div
                      className="relative z-10"
                      animate={{ scale: isActive ? 1.05 : 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <item.icon 
                        size={20} 
                        strokeWidth={isActive ? 2.5 : 2}
                        className="transition-all"
                      />
                    </motion.div>
                    
                    {/* Label */}
                    <span 
                      className={`relative z-10 text-[10px] font-medium transition-all truncate w-full text-center ${
                        isActive ? 'font-semibold' : ''
                      }`}
                    >
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
