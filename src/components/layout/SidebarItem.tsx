import React from 'react';
import { NavLink } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { useLanguage } from '../../context/LanguageContext';

interface SidebarItemProps {
  icon: LucideIcon;
  label: string;
  to: string;
  collapsed?: boolean;
  onClick?: () => void;
}

export function SidebarItem({ icon: Icon, label, to, collapsed, onClick }: SidebarItemProps) {
  const { isRtl } = useLanguage();
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 group relative",
          isActive 
            ? "bg-mocha-600 text-white shadow-lg shadow-mocha-500/20" 
            : "text-gray-400 hover:bg-gray-800 hover:text-white"
        )
      }
    >
      <Icon className="w-5 h-5 min-w-[20px]" />
      {!collapsed && (
        <span className="font-medium whitespace-nowrap overflow-hidden">
          {label}
        </span>
      )}
      {collapsed && (
        <div className={clsx(
          "absolute px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap",
          isRtl ? "right-full mr-2" : "left-full ml-2"
        )}>
          {label}
        </div>
      )}
    </NavLink>
  );
}
