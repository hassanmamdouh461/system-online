import React from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, DollarSign, ShoppingBag,
  Clock, Coffee, Users, Scale, Award
} from 'lucide-react';

interface OverviewTabProps {
  processedData: any;
  dateRange: string;
  setDateRange: (range: any) => void;
  selectedBranch: string;
  setSelectedBranch: (branch: string) => void;
  t: (key: string) => string;
  isRtl: boolean;
}

export function OverviewTab({
  processedData,
  t,
}: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* 4 Main Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <motion.div
          whileHover={{ y: -4 }}
          className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-3 rounded-xl bg-orange-50 text-amber-600 border border-orange-100/50">
              <DollarSign className="w-6 h-6" />
            </div>
            <span className="text-xs font-semibold text-green-600 bg-green-50 px-2.5 py-1 rounded-lg border border-green-100">
              +12.5%
            </span>
          </div>
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">{t('Total Revenue')}</p>
          <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mt-1">
            {processedData.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-xs text-gray-500 font-normal">ج.م</span>
          </h3>
        </motion.div>

        <motion.div
          whileHover={{ y: -4 }}
          className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600 border border-blue-100/50">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">
              {processedData.totalOrdersCount} {t('orders')}
            </span>
          </div>
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">{t('Total Orders')}</p>
          <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mt-1">
            {processedData.totalOrdersCount}
          </h3>
        </motion.div>

        <motion.div
          whileHover={{ y: -4 }}
          className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100/50">
              <Scale className="w-6 h-6" />
            </div>
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100">
              {t('Average Ticket')}
            </span>
          </div>
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">{t('Avg. Order Value')}</p>
          <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mt-1">
            {processedData.avgOrderValue.toFixed(2)} <span className="text-xs text-gray-500 font-normal">ج.م</span>
          </h3>
        </motion.div>

        <motion.div
          whileHover={{ y: -4 }}
          className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-3 rounded-xl bg-purple-50 text-purple-600 border border-purple-100/50">
              <Users className="w-6 h-6" />
            </div>
          </div>
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wider">{t('Customers')}</p>
          <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mt-1">
            {processedData.loyaltyCount}
          </h3>
        </motion.div>
      </div>

      {/* Top Items & Payment Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Items Card */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Coffee className="w-5 h-5 text-amber-600" />
              {t('Top Items')}
            </h4>
          </div>
          {processedData.topItems && processedData.topItems.length > 0 ? (
            <div className="space-y-3">
              {processedData.topItems.slice(0, 5).map((item: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-gray-50/80 hover:bg-gray-100/80 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 font-bold text-sm flex items-center justify-center">
                      #{idx + 1}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{item.name}</p>
                      <p className="text-xs text-gray-500">{item.count} {t('Quantity sold')}</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-900">
                    {item.revenue.toFixed(2)} ج.م
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-6">{t('No recent activity')}</p>
          )}
        </div>

        {/* Payment Methods Card */}
        <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Award className="w-5 h-5 text-blue-600" />
              {t('Payment Methods')}
            </h4>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm font-medium text-gray-700 mb-1">
                <span>{t('Cash')} ({processedData.cashPercentage}%)</span>
                <span>{processedData.cashAmount.toFixed(2)} ج.م</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div className="bg-amber-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${processedData.cashPercentage}%` }}></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm font-medium text-gray-700 mb-1">
                <span>{t('Card')} ({processedData.cardPercentage}%)</span>
                <span>{processedData.cardAmount.toFixed(2)} ج.م</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div className="bg-blue-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${processedData.cardPercentage}%` }}></div>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 grid grid-cols-2 gap-4 text-center">
              <div className="p-3 bg-gray-50 rounded-xl">
                <p className="text-xs text-gray-500">{t('Takeaway')}</p>
                <p className="text-lg font-bold text-gray-800">{processedData.takeawayCount}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl">
                <p className="text-xs text-gray-500">{t('Dine-in')}</p>
                <p className="text-lg font-bold text-gray-800">{processedData.dineInCount}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
