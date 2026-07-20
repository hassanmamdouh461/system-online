import React, { useState } from 'react';
import { User, LogOut } from 'lucide-react';
import { motion } from 'framer-motion';
import { DatabaseStatus } from '../components/ui/DatabaseStatus';
import { SyncStatus } from '../components/ui/SyncStatus';
import { useAuth } from '../context/AuthContext';
import { ProfileSettingsModal } from '../components/settings/ProfileSettingsModal';

export default function Settings() {
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const { logout } = useAuth();

  const sections = [
    {
      title: 'Profile Settings',
      items: [
        { 
          icon: User, 
          label: 'My Account', 
          desc: 'Manage your personal details',
          onClick: () => setIsProfileModalOpen(true)
        },
      ]
    }
  ];

  return (
    <div className="space-y-3 md:space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-lg md:text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-xs md:text-base text-gray-500">Manage your account and preferences.</p>
      </div>

      <div className="space-y-3 md:space-y-6">
        {sections.map((section, idx) => (
          <motion.div 
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
          >
            <div className="px-4 md:px-6 py-4 bg-gray-50 border-b border-gray-100">
               <h2 className="font-semibold text-gray-900">{section.title}</h2>
            </div>
            <div className="p-2">
               {section.items.map((item, i) => (
                  <button 
                    key={i} 
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

        {/* Database & Sync Connection Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <DatabaseStatus />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.33 }}
          >
            <SyncStatus />
          </motion.div>
        </div>

        <motion.button 
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           transition={{ delay: 0.4 }}
           onClick={logout}
           className="w-full flex items-center justify-center gap-2 p-4 text-red-600 bg-red-50 hover:bg-red-100 rounded-2xl transition-colors font-medium text-sm md:text-base"
        >
           <LogOut size={20} />
           Sign Out
        </motion.button>
      </div>

      <ProfileSettingsModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />
    </div>
  );
}
