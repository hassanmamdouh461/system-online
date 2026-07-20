import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  UtensilsCrossed, 
  ClipboardList, 
  CreditCard, 
  BarChart3, 
  Settings, 
  Coffee,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  X,
  Users,
  Building2,
  Package
} from 'lucide-react';
import { SidebarItem } from './SidebarItem';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { t, isRtl, language } = useLanguage();

  const handleItemClick = () => {
    // Close sidebar on mobile when item is clicked
    if (isMobile && onMobileClose) {
      onMobileClose();
    }
  };

  const sidebarContent = (
    <div 
      className={clsx(
        "h-full bg-gray-900 flex flex-col transition-all duration-300 relative",
        isRtl ? "border-l border-gray-800" : "border-r border-gray-800",
        !isMobile && (collapsed ? "w-20" : "w-64")
      )}
    >
      {/* Toggle Button - Desktop Only */}
      {!isMobile && (
        <button 
          onClick={() => setCollapsed(!collapsed)}
          className={clsx(
            "absolute top-8 bg-mocha-600 text-white p-1 rounded-full shadow-lg hover:bg-mocha-700 transition-colors z-50",
            isRtl ? "-left-3" : "-right-3"
          )}
        >
          {collapsed 
            ? (isRtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />) 
            : (isRtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />)
          }
        </button>
      )}

      {/* Close Button - Mobile Only */}
      {isMobile && (
        <button
          onClick={onMobileClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-white p-2 hover:bg-gray-800 rounded-lg transition-colors z-50"
        >
          <X size={24} />
        </button>
      )}

      {/* Brand */}
      <div className="p-6 flex items-center gap-3 border-b border-gray-800">
        <div className="bg-gradient-to-br from-mocha-600 to-coffee-dark p-2 rounded-lg shadow-lg shadow-mocha-500/20">
          <Coffee className="w-6 h-6 text-white" />
        </div>
        {(!collapsed || isMobile) && (
          <div>
            <h1 className="text-white font-bold text-lg leading-none">Brew<span className="text-caramel">Master</span></h1>
            <p className="text-gray-500 text-xs">Coffee POS</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto custom-scrollbar">
        {user?.role === 'manager' ? (
          <>
            <SidebarItem icon={Building2} label={language === 'ar' ? 'لوحة المدير' : 'Manager Dashboard'} to="/manager-dashboard" collapsed={!isMobile && collapsed} onClick={handleItemClick} />
          </>
        ) : (
          <>
            <SidebarItem icon={ClipboardList} label={t('Cashier Board')} to="/orders" collapsed={!isMobile && collapsed} onClick={handleItemClick} />
            <SidebarItem icon={CreditCard} label={t('Payment & Invoice')} to="/payment" collapsed={!isMobile && collapsed} onClick={handleItemClick} />
            <SidebarItem icon={UtensilsCrossed} label={t('Menu')} to="/menu" collapsed={!isMobile && collapsed} onClick={handleItemClick} />
            <SidebarItem icon={Package} label={t('Inventory')} to="/inventory" collapsed={!isMobile && collapsed} onClick={handleItemClick} />
            <SidebarItem icon={BarChart3} label={t('Reports')} to="/reports" collapsed={!isMobile && collapsed} onClick={handleItemClick} />
          </>
        )}
        
        <div className="my-4 border-t border-gray-800" />
        
        <SidebarItem icon={Settings} label={t('Settings')} to="/settings" collapsed={!isMobile && collapsed} onClick={handleItemClick} />
      </nav>

      {/* User Mini Profile */}
      <div className="p-4 border-t border-gray-800">
        <div className={clsx("flex items-center gap-3 p-2 rounded-lg bg-gray-800/50", (!isMobile && collapsed) && "justify-center")}>
          <img 
            src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" 
            alt="User" 
            className="w-8 h-8 rounded-full bg-gray-700"
          />
          {(!collapsed || isMobile) && (
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-white truncate">{user?.name ?? 'Admin User'}</p>
              <p className="text-xs text-gray-400 truncate">{user?.role ?? 'Manager'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Desktop: Render nothing (handled by TopNav)
  if (!isMobile) {
    return null;
  }

  // Mobile: Render as drawer with overlay
  return (
    <AnimatePresence>
      {mobileOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onMobileClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            style={{ willChange: 'opacity' }}
          />
          
          {/* Drawer */}
          <motion.div
            initial={{ x: isRtl ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: isRtl ? '100%' : '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className={clsx(
              "fixed top-0 bottom-0 w-72 z-50 touch-pan-y",
              isRtl ? "right-0" : "left-0"
            )}
            style={{ willChange: 'transform' }}
          >
            {sidebarContent}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
