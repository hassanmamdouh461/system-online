import React, { useState } from 'react';
import {
  User,
  LogOut,
  Store,
  QrCode,
  Send,
  Settings as SettingsIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { DatabaseStatus } from '../components/ui/DatabaseStatus';
import { SyncStatus } from '../components/ui/SyncStatus';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { ProfileSettingsModal } from '../components/settings/ProfileSettingsModal';
import { StoreConfigModal } from '../components/settings/StoreConfigModal';

import { QrMenuModal } from '../components/settings/QrMenuModal';
import { TelegramConfigModal } from '../components/settings/TelegramConfigModal';

type ModalKey = 'profile' | 'store' | 'qr' | 'telegram' | null;

export default function Settings() {
  const [openModal, setOpenModal] = useState<ModalKey>(null);
  const { logout } = useAuth();
  const { t, language } = useLanguage();

  const sections = [
    {
      title: language === 'ar' ? 'الحساب' : 'Account',
      items: [
        {
          icon: User,
          label: language === 'ar' ? 'حسابي' : 'My Account',
          desc: language === 'ar' ? 'تغيير كلمة مرور الدخول' : 'Change login password',
          onClick: () => setOpenModal('profile'),
        },

      ],
    },
    {
      title: language === 'ar' ? 'المتجر والفرع' : 'Store & Branch',
      items: [
        {
          icon: Store,
          label: language === 'ar' ? 'إعدادات المتجر' : 'Store Configuration',
          desc: language === 'ar' ? 'نسبة الضريبة والإعدادات العامة' : 'Tax rate and store options',
          onClick: () => setOpenModal('store'),
        },

      ],
    },
    {
      title: language === 'ar' ? 'القائمة والتنبيهات' : 'Menu & Alerts',
      items: [
        {
          icon: QrCode,
          label: language === 'ar' ? 'قائمة QR' : 'QR Menu',
          desc: language === 'ar' ? 'رابط ورمز قائمة العملاء' : 'Public menu link and QR code',
          onClick: () => setOpenModal('qr'),
        },
        {
          icon: Send,
          label: language === 'ar' ? 'تقارير تيليجرام' : 'Telegram Reports',
          desc: language === 'ar' ? 'تقارير المبيعات اليومية' : 'Daily sales report notifications',
          onClick: () => setOpenModal('telegram'),
        },
      ],
    },
  ];

  return (
    <div className="space-y-3 md:space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-lg md:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <SettingsIcon size={22} className="text-mocha-600" />
          {language === 'ar' ? 'الإعدادات' : 'Settings'}
        </h1>
        <p className="text-xs md:text-base text-gray-500">
          {language === 'ar'
            ? 'إدارة الحساب والمتجر والفرع والمزامنة.'
            : 'Manage account, store, branch, and sync preferences.'}
        </p>
      </div>

      <div className="space-y-3 md:space-y-6">
        {sections.map((section, idx) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08 }}
            className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
          >
            <div className="px-4 md:px-6 py-4 bg-gray-50 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{section.title}</h2>
            </div>
            <div className="p-2">
              {section.items.map((item) => (
                <button
                  key={item.label}
                  onClick={item.onClick}
                  className="mobile-touch-target w-full flex items-center gap-4 p-4 hover:bg-gray-50 rounded-xl transition-colors text-left group tap-highlight-none"
                >
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-mocha-50 group-hover:text-mocha-700 transition-colors">
                    <item.icon size={20} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 text-sm md:text-base">{item.label}</h3>
                    <p className="text-xs md:text-sm text-gray-500">{item.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        ))}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
            <DatabaseStatus />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32 }}>
            <SyncStatus />
          </motion.div>
        </div>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.36 }}
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 p-4 text-red-600 bg-red-50 hover:bg-red-100 rounded-2xl transition-colors font-medium text-sm md:text-base"
        >
          <LogOut size={20} />
          {language === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}
        </motion.button>
      </div>

      <ProfileSettingsModal isOpen={openModal === 'profile'} onClose={() => setOpenModal(null)} />
      <StoreConfigModal isOpen={openModal === 'store'} onClose={() => setOpenModal(null)} />

      <QrMenuModal isOpen={openModal === 'qr'} onClose={() => setOpenModal(null)} />
      <TelegramConfigModal isOpen={openModal === 'telegram'} onClose={() => setOpenModal(null)} />
    </div>
  );
}
