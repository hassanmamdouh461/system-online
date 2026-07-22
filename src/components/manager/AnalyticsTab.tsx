import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, BarChart3 } from 'lucide-react';

interface AnalyticsTabProps {
  processedData: any;
  dateRange: string;
  t: (key: string) => string;
}

export function AnalyticsTab({ processedData, dateRange, t }: AnalyticsTabProps) {
  const chartPoints = processedData.chartData || [];
  const maxVal = Math.max(...chartPoints.map((p: any) => p.value || 0), 1);

  return (
    <div className="space-y-6">
      {/* Chart Card */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-amber-600" />
              {t('Revenue Trend')} ({t(dateRange)})
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{t('Track your cafe performance and growth.')}</p>
          </div>
        </div>

        {/* Visual Bar Chart */}
        <div className="h-64 flex items-end gap-2 md:gap-4 pt-6 pb-2 px-2">
          {chartPoints.map((point: any, index: number) => {
            const heightPercent = Math.max((point.value / maxVal) * 100, 4);
            return (
              <div key={index} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 text-white text-[10px] py-1 px-2 rounded shadow-lg whitespace-nowrap z-10 pointer-events-none">
                  {point.value.toFixed(2)} ج.م ({point.orders} {t('orders')})
                </div>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${heightPercent}%` }}
                  transition={{ duration: 0.5, delay: index * 0.05 }}
                  className="w-full bg-gradient-to-t from-amber-500 to-orange-400 rounded-t-lg group-hover:from-amber-600 group-hover:to-orange-500 transition-colors relative"
                />
                <span className="text-[11px] font-medium text-gray-500 truncate w-full text-center">
                  {point.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
