import React from 'react';
import { MenuItem } from '../../types/menu';
import { Edit, Trash2, Power } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '../../context/LanguageContext';

interface MenuItemCardProps {
  item: MenuItem;
  onEdit: (item: MenuItem) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (id: string) => void;
}

export function MenuItemCard({ item, onEdit, onDelete, onToggleStatus }: MenuItemCardProps) {
  const { t, isRtl } = useLanguage();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={`bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden group relative p-4 flex flex-col justify-between ${!item.available ? 'opacity-75 grayscale-[0.5]' : ''}`}
    >
      <div>
        {/* Header */}
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1 min-w-0 mr-2">
            <h3 className="font-bold text-base text-gray-900 truncate">{t(item.name)}</h3>
            <span className="text-[10px] text-gray-500 font-medium px-2 py-0.5 bg-gray-100 rounded-full">
              {(() => {
                const parts = item.category.split('|');
                const menuCat = parts[0];
                const prepArea = parts[1] === 'Kitchen' ? 'مطبخ' : parts[1] === 'Bar' ? 'بار' : '';
                return prepArea ? `${t(menuCat) || menuCat} (${prepArea})` : (t(menuCat) || menuCat);
              })()}
            </span>
          </div>
          <div className="flex flex-col items-end shrink-0 gap-1">
            <span className="font-bold text-base text-mocha-700">{item.price.toFixed(2)} {isRtl ? 'ج.م' : 'EGP'}</span>
            {!item.available && (
              <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
                {t('Sold Out')}
              </span>
            )}
          </div>
        </div>

        <p className="text-gray-500 text-xs font-sans mb-3.5 h-8 overflow-hidden">{t(item.description)}</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onToggleStatus(item.id)}
          className={`flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
            item.available 
              ? 'bg-green-50 text-green-600 hover:bg-green-100' 
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Power size={12} />
          {item.available ? t('Available') : t('Unavailable')}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(item); }}
          className="p-2 bg-gray-50 hover:bg-blue-50 text-gray-500 hover:text-blue-600 rounded-xl transition-colors border border-gray-100"
          title={t('Edit')}
        >
          <Edit size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(item.id.toString()); }}
          className="p-2 bg-gray-50 hover:bg-red-50 text-gray-500 hover:text-red-600 rounded-xl transition-colors border border-gray-100"
          title={t('Delete')}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  );
}
