import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  ClipboardList, 
  CreditCard, 
  UtensilsCrossed, 
  Users, 
  BarChart3, 
  Settings, 
  Coffee,
  Building2,
  Package,
  Languages,
  LogOut
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { clsx } from 'clsx';

export function TopNav() {
  const { user, logout } = useAuth();
  const { t, isRtl, toggleLanguage, language } = useLanguage();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Build items based on role (excluding Dashboard for branch accounts)
  const navItems = user?.role === 'manager' 
    ? [
        { icon: Building2, label: language === 'ar' ? 'لوحة المدير' : 'Manager Dashboard', to: '/manager-dashboard' },
        { icon: Settings, label: t('Settings'), to: '/settings' },
      ]
    : [
        { icon: ClipboardList, label: t('Cashier Board'), to: '/orders' },
        { icon: CreditCard, label: t('Payment & Invoice'), to: '/payment' },
        { icon: UtensilsCrossed, label: t('Menu'), to: '/menu' },
        { icon: Package, label: t('Inventory'), to: '/inventory' },
        { icon: BarChart3, label: t('Reports'), to: '/reports' },
        { icon: Settings, label: t('Settings'), to: '/settings' },
      ];

  return (
    <header className="hidden sm:block w-full bg-white border-b border-gray-200 shadow-sm relative z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Brand/Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="bg-gradient-to-br from-mocha-600 to-coffee-dark p-2 rounded-lg shadow-md shadow-mocha-500/10">
              <Coffee className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-gray-900 font-black text-base leading-none">
                Brew<span className="text-caramel">Master</span>
              </h1>
              <p className="text-gray-400 text-[10px] font-bold">Coffee POS</p>
            </div>
          </div>

          {/* Navigation Items in center */}
          <div className="flex items-center gap-1.5 bg-gray-50/80 backdrop-blur-sm p-1 rounded-xl border border-gray-200/50 shadow-sm">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-xs md:text-sm font-extrabold transition-all duration-200",
                      isActive
                        ? "bg-gray-900 text-white shadow-sm"
                        : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"
                    )
                  }
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>

          {/* Right Action Section (User Profile & Logout) */}
          <div className="flex items-center gap-3 shrink-0">

            {/* User Profile Mini Card */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200/40">
              <img 
                src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" 
                alt="User" 
                className="w-7 h-7 rounded-full bg-gray-200"
              />
              <div className={clsx("text-left", isRtl && "text-right")}>
                <p className="text-xs font-bold text-gray-800 leading-tight">
                  {language === 'ar' && user?.id === 'branch_1' ? 'فرع المعادي' :
                   language === 'ar' && user?.id === 'branch_2' ? 'فرع مصر الجديدة' :
                   language === 'ar' && user?.id === 'branch_3' ? 'فرع الزمالك' :
                   language === 'ar' && user?.role === 'manager' ? 'الإدارة العامة' :
                   user?.name ?? 'Admin User'}
                </p>
                <p className="text-[10px] text-gray-400 font-semibold">
                  {user?.role === 'manager' ? (language === 'ar' ? 'المدير' : 'Manager') : (language === 'ar' ? 'الفرع' : 'Branch')}
                </p>
              </div>
            </div>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all active:scale-95"
              title={language === 'ar' ? 'تسجيل الخروج' : 'Logout'}
            >
              <LogOut size={16} />
            </button>
          </div>

        </div>
      </div>
    </header>
  );
}
