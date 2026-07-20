import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { 
  LayoutDashboard, 
  ClipboardList, 
  CreditCard, 
  UtensilsCrossed, 
  Users, 
  BarChart3, 
  Settings,
  Languages,
  Coffee,
  Building2,
  Package
} from 'lucide-react';

const descMap: Record<string, { en: string, ar: string }> = {
  dashboard: { en: 'Main overview and stats summary.', ar: 'نظرة عامة وملخص الإحصائيات الرئيسي.' },
  cashier: { en: 'Manage active tables and orders.', ar: 'إدارة الطلبات النشطة وخدمة الطاولات والكاشير.' },
  payment: { en: 'Process checkouts and billings.', ar: 'تسوية الحسابات وتحصيل الفواتير.' },
  menu: { en: 'Customize items, prices and categories.', ar: 'تعديل وتخصيص أصناف القائمة والأسعار.' },
  inventory: { en: 'Manage raw materials, stock levels and recipes.', ar: 'إدارة المواد الخام ومستويات المخزون والمكونات.' },
  reports: { en: 'Analyze sales statistics and revenue reports.', ar: 'تحليل أرقام المبيعات وتقارير الإيرادات.' },
  settings: { en: 'Configure system settings and database.', ar: 'ضبط إعدادات النظام وقاعدة البيانات.' }
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { t, language, toggleLanguage } = useLanguage();
  const { branch } = useAuth();

  const navItems = [
    { 
      key: 'cashier',
      label: t('Cashier Board'), 
      to: '/orders', 
      icon: ClipboardList, 
      color: 'from-amber-500 to-orange-600', 
      glow: 'hover:shadow-amber-500/20'
    },
    { 
      key: 'payment',
      label: t('Payment & Invoice'), 
      to: '/payment', 
      icon: CreditCard, 
      color: 'from-emerald-500 to-teal-600', 
      glow: 'hover:shadow-emerald-500/20'
    },
    { 
      key: 'menu',
      label: t('Menu'), 
      to: '/menu', 
      icon: UtensilsCrossed, 
      color: 'from-purple-500 to-pink-600', 
      glow: 'hover:shadow-purple-500/20'
    },
    { 
      key: 'inventory',
      label: t('Inventory'), 
      to: '/inventory', 
      icon: Package, 
      color: 'from-indigo-500 to-violet-600', 
      glow: 'hover:shadow-indigo-500/20'
    },
    { 
      key: 'reports',
      label: t('Reports'), 
      to: '/reports', 
      icon: BarChart3, 
      color: 'from-red-500 to-rose-600', 
      glow: 'hover:shadow-red-500/20'
    },
    { 
      key: 'settings',
      label: t('Settings'), 
      to: '/settings', 
      icon: Settings, 
      color: 'from-gray-600 to-slate-800', 
      glow: 'hover:shadow-gray-600/20'
    }
  ];

  return (
    <div className="min-h-full flex flex-col justify-between py-4 md:py-8 text-gray-800">
      
      {/* Header section */}
      <div className="flex justify-between items-center mb-8 md:mb-12 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-mocha-600 to-coffee-dark p-2.5 rounded-xl shadow-lg">
            <Coffee className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">{t('Dashboard')}</h1>
            <p className="text-xs md:text-sm text-gray-500 font-bold">{t("Welcome back, here's what's happening today.")}</p>
            {branch && (
              <div className="flex items-center gap-1.5 mt-1">
                <Building2 size={13} className="text-orange-500" />
                <span className="text-xs font-bold text-orange-600">{branch.branchName}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid of Pages */}
      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 w-full max-w-5xl">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const desc = descMap[item.key][language as 'en' | 'ar'];
            
            return (
              <motion.button
                key={item.key}
                onClick={() => navigate(item.to)}
                whileHover={{ scale: 1.04, y: -4 }}
                whileTap={{ scale: 0.97 }}
                className={`bg-white rounded-3xl p-5 md:p-6 border border-gray-250/60 shadow-md transition-all flex flex-col items-center text-center justify-between gap-4 cursor-pointer min-h-[170px] md:min-h-[200px] group ${item.glow}`}
              >
                {/* Glowing Colored Icon Container */}
                <div className={`p-4 rounded-2xl bg-gradient-to-br ${item.color} text-white shadow-lg transition-transform group-hover:scale-110`}>
                  <Icon className="w-7 h-7 md:w-8 md:h-8" />
                </div>
                
                {/* Label and description */}
                <div className="space-y-1">
                  <h3 className="font-extrabold text-base md:text-lg text-gray-900 group-hover:text-mocha-700 transition-colors">
                    {item.label}
                  </h3>
                  <p className="text-[10px] md:text-xs text-gray-400 font-bold leading-normal px-2">
                    {desc}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
      
    </div>
  );
}
