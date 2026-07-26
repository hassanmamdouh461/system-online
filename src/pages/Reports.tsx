import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, DollarSign, ShoppingBag,
  Coffee, Calendar, Download,
  CheckCircle2, Clock, XCircle, AlertCircle, Utensils,
  UserCheck, Award, Coins, TrendingDown, AlertTriangle, Scale, Wallet
} from 'lucide-react';
import { useAnalytics, AnalyticsPeriod } from '../hooks/useAnalytics';
import { useOrders } from '../hooks/useOrders';
import { StatCard } from '../components/ui/StatCard';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { OrderStatus, getOrderGrandTotal } from '../types/order';
import { formatOrderNumber } from '../utils/orderNumber';
import { useLanguage } from '../context/LanguageContext';
import { getTaxRate } from '../utils/settingsConfig';
import { inventoryService } from '../services/inventoryService';
import { resolveInvItem } from '../utils/inventoryHelpers';
import { menuService } from '../services/menuService';
import { MenuItem } from '../types/menu';
import { getIngredientBaseQty } from '../utils/units';
import { RevenueAreaChart } from '../components/ui/RevenueAreaChart';
import { safeMoney, addMoney, subtractMoney, multiplyMoney, divideMoney, sumMoneyBy, averageMoney, maxMoney, moneyRatio, moneyPercent, formatMoney } from '../utils/money';


// ─── Status display config (UI-only: icons & colours) ────────────────────────
const STATUS_CONFIG: Array<{
  status: OrderStatus;
  label: string;
  icon: React.ElementType;
  color: string;
  bar: string;
}> = [
  { status: 'New',       label: 'New',       icon: Coffee,       color: 'text-mocha-700', bar: 'bg-mocha-400' },
  { status: 'Preparing', label: 'Preparing', icon: Clock,        color: 'text-amber-600', bar: 'bg-amber-400' },
  { status: 'Ready',     label: 'Ready',     icon: AlertCircle,  color: 'text-blue-600',  bar: 'bg-blue-400'  },
  { status: 'Completed', label: 'Completed', icon: CheckCircle2, color: 'text-green-600', bar: 'bg-green-500' },
  { status: 'Cancelled', label: 'Cancelled', icon: XCircle,      color: 'text-red-500',   bar: 'bg-red-400'   },
];

function periodLabel(p: AnalyticsPeriod, t: (k: string) => string) {
  const map: Record<AnalyticsPeriod, string> = {
    'Today': 'today', 'This Week': 'this week', 'This Month': 'this month', 'This Year': 'this year',
  };
  return t(map[p]);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Reports() {
  const { t, isRtl, language } = useLanguage();
  const { orders: allOrders } = useOrders();
  const [dateRange, setDateRange] = useState<AnalyticsPeriod>(() => {
    const saved = localStorage.getItem('reports_date_range');
    return (saved as AnalyticsPeriod) || 'This Week';
  });

  const handleDateRangeChange = (value: AnalyticsPeriod) => {
    setDateRange(value);
    localStorage.setItem('reports_date_range', value);
  };

  const [inventory, setInventory] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  useEffect(() => {
    inventoryService.getAll().then(setInventory).catch(console.error);
    inventoryService.getMenuRecipes().then(setRecipes).catch(console.error);
    menuService.getAll().then(setMenuItems).catch(console.error);
  }, []);

  // Precompute realistic selling yield for each inventory item ID using proportional F&B cost-weighted allocation
  const itemYields = useMemo(() => {
    const yields: Record<string, number> = {};

    const invMapById = new Map<string, any>();
    inventory.forEach(item => invMapById.set(item.id, item));

    const getUnitCost = (invItemId: string): number => {
      const found = resolveInvItem(invItemId, inventory);
      return found ? safeMoney(found.costPerUnit) : 0;
    };

    const menuRecipeMap: Record<string, any[]> = {};
    recipes.forEach(r => {
      if (r.menuItemId) {
        if (!menuRecipeMap[r.menuItemId]) menuRecipeMap[r.menuItemId] = [];
        menuRecipeMap[r.menuItemId].push(r);
      }
    });

    const menuMap = new Map(menuItems.map(m => [String(m.id), m]));

    const menuTotalCostMap = new Map<string, number>();
    Object.entries(menuRecipeMap).forEach(([mId, ingList]) => {
      // baseQty is a quantity (multiplier), cost is money -> multiplyMoney(cost, baseQty)
      const totalCost = sumMoneyBy(ingList, ing => {
        const invItem = resolveInvItem(ing.inventoryItemId, inventory);
        const cost = invItem ? safeMoney(invItem.costPerUnit) : 0;
        const baseQty = getIngredientBaseQty(ing.quantity, ing.unit || '', invItem?.unit || '');
        return multiplyMoney(cost, baseQty);
      });
      menuTotalCostMap.set(mId, totalCost > 0 ? totalCost : 1);
    });

    const invRecipesMap = new Map<string, { menuItemId: string; quantity: number, unit?: string }[]>();
    recipes.forEach(r => {
      const invItem = resolveInvItem(r.inventoryItemId, inventory);
      const targetId = invItem ? invItem.id : r.inventoryItemId;

      if (!invRecipesMap.has(targetId)) invRecipesMap.set(targetId, []);
      invRecipesMap.get(targetId)!.push({
        menuItemId: String(r.menuItemId),
        quantity: r.quantity,
        unit: r.unit
      });
    });

    inventory.forEach(item => {
      const itemRecipes = invRecipesMap.get(item.id) || [];
      const itemUnitCost = item.costPerUnit && item.costPerUnit > 0 ? item.costPerUnit : 1;

      if (itemRecipes.length === 0) {
        yields[item.id] = multiplyMoney(itemUnitCost, 2.5);
        return;
      }

      let totalUnitYield = 0;
      let validCount = 0;

      itemRecipes.forEach(rec => {
        const menuItem = menuMap.get(String(rec.menuItemId));
        const totalRecipeCost = menuTotalCostMap.get(String(rec.menuItemId)) || 1;
        if (menuItem && rec.quantity > 0) {
          const baseQty = getIngredientBaseQty(rec.quantity, rec.unit || '', item.unit || '');
          if (baseQty > 0) {
            const itemCostInRecipe = multiplyMoney(itemUnitCost, baseQty);
            // costShareFraction is a ratio (0-1), not money -> moneyRatio
            const costShareFraction = moneyRatio(itemCostInRecipe, totalRecipeCost);
            const allocatedRevenue = multiplyMoney(menuItem.price, costShareFraction);
            const unitYield = divideMoney(allocatedRevenue, baseQty);
            totalUnitYield = addMoney(totalUnitYield, unitYield);
            validCount++;
          }
        }
      });

      yields[item.id] = validCount > 0 ? averageMoney(totalUnitYield, validCount) : multiplyMoney(itemUnitCost, 2.5);
    });

    return yields;
  }, [inventory, recipes, menuItems]);

  const inventoryValuation = useMemo(() => {
    let totalCost = 0;
    let totalProfit = 0;

    inventory.forEach(item => {
      // item.stock is a quantity (multiplier), costPerUnit/avgYield are money
      const costVal = multiplyMoney(item.costPerUnit, item.stock);
      const avgYield = itemYields[item.id] || multiplyMoney(item.costPerUnit, 2.5);
      const potSales = multiplyMoney(avgYield, item.stock);
      // maxMoney clamps at 0 without changing the potSales > 0 gating logic
      const potProfit = potSales > 0 ? maxMoney(subtractMoney(potSales, costVal), 0) : 0;

      totalCost = addMoney(totalCost, costVal);
      totalProfit = addMoney(totalProfit, potProfit);
    });

    return { totalCost, totalProfit };
  }, [inventory, itemYields]);



  // Single hook call — all computation happens inside useAnalytics.
  // When dateRange = 'Today', every stat equals Dashboard's values exactly.
  const analytics = useAnalytics(dateRange);
  const taxRate = getTaxRate();

  const recipeCosts = useMemo(() => {
    const costMap: Record<string, number> = {};
    for (const r of recipes) {
      const invItem = inventory.find(i => i.id === r.inventoryItemId);
      const itemCost = invItem ? invItem.costPerUnit : 0;
      const baseQty = getIngredientBaseQty(r.quantity, r.unit || '', invItem?.unit || '');
      costMap[r.menuItemId] = addMoney(costMap[r.menuItemId] || 0, multiplyMoney(itemCost, baseQty));
    }
    return costMap;
  }, [recipes, inventory]);

  const cogs = useMemo(() => {
    let totalCogs = 0;
    for (const order of analytics.completedPeriod) {
      for (const item of order.items) {
        const itemCost = recipeCosts[item.menuItemId || item.id] || 0;
        // item.quantity is a count (multiplier), itemCost is money
        totalCogs = addMoney(totalCogs, multiplyMoney(itemCost, item.quantity));
      }
    }

    return totalCogs;
  }, [analytics.completedPeriod, recipeCosts, dateRange]);

  const netProfit = useMemo(() => {
    // totalRevenue is tax-inclusive (sum of grandTotal). Subtract the ACTUAL
    // collected tax from frozen snapshots — NOT revenue * taxRate (double-discount).
    return maxMoney(subtractMoney(analytics.totalRevenue, analytics.totalTax, cogs), 0);
  }, [analytics.totalRevenue, analytics.totalTax, cogs]);

  const lowStockItems = useMemo(() => {
    return inventory.filter(item => item.stock <= item.minStock);
  }, [inventory]);

  const invoiceStats = React.useMemo(() => {
    // "Paid" = realized revenue (Paid only).
    // "Open" = open bills (Unpaid + OnAccount). Cancelled/Refunded excluded from both.
    const validOrders = analytics.periodOrders.filter(
      o => o.status !== 'Cancelled' && o.paymentStatus !== 'Refunded'
    );
    const paidCount = validOrders.filter(
      o => o.paymentStatus === 'Paid'
    ).length;
    const openCount = validOrders.filter(o => o.paymentStatus === 'Unpaid' || o.paymentStatus === 'OnAccount').length;
    const paidAmount = sumMoneyBy(
      validOrders.filter(o => o.paymentStatus === 'Paid'),
      o => getOrderGrandTotal(o, taxRate)
    );
    const openAmount = sumMoneyBy(
      validOrders.filter(o => o.paymentStatus === 'Unpaid' || o.paymentStatus === 'OnAccount'),
      o => getOrderGrandTotal(o, taxRate)
    );
    const totalCount = paidCount + openCount;
    return { paidCount, openCount, paidAmount, openAmount, totalCount };
  }, [analytics.periodOrders, taxRate]);

  const paymentMethodStats = React.useMemo(() => {
    // Use canonical getOrderGrandTotal so totals match analytics revenue exactly
    // (respects frozen grandTotal snapshot)
    const realCashAmount = sumMoneyBy(
      analytics.completedPeriod.filter(o => o.paymentMethod === 'Cash'),
      o => getOrderGrandTotal(o, taxRate)
    );
    const realCardAmount = sumMoneyBy(
      analytics.completedPeriod.filter(o => o.paymentMethod === 'Card'),
      o => getOrderGrandTotal(o, taxRate)
    );

    const totalCashAmount = realCashAmount;
    const totalCardAmount = realCardAmount;
    const totalPaidAmount = addMoney(totalCashAmount, totalCardAmount);

    return {
      cashAmount: totalCashAmount,
      cardAmount: totalCardAmount,
      totalAmount: totalPaidAmount,
      cashPercentage: totalPaidAmount > 0 ? moneyPercent(totalCashAmount, totalPaidAmount) : 0,
      cardPercentage: totalPaidAmount > 0 ? moneyPercent(totalCardAmount, totalPaidAmount) : 0,
    };
  }, [analytics.completedPeriod, dateRange, taxRate]);

  const orderModeStats = React.useMemo(() => {
    const realTakeaway = analytics.periodOrders.filter(o => o.tableId === 'Takeaway').length;
    const realDineIn = analytics.periodOrders.filter(o => o.tableId !== 'Takeaway').length;

    const takeaway = realTakeaway;
    const dineIn = realDineIn;
    const total = takeaway + dineIn;

    return { takeaway, dineIn, total };
  }, [analytics.periodOrders, dateRange]);

  // Outstanding receivables: lifetime (all on-account invoices still open),
  // matching ManagerDashboard's receivablesData semantics.
  // NOTE: must stay above the early returns below — Rules of Hooks.
  const totalReceivables = useMemo(() => {
    return sumMoneyBy(
      (allOrders || []).filter(o => o.paymentStatus === 'OnAccount' && o.status !== 'Cancelled'),
      o => getOrderGrandTotal(o, taxRate)
    );
  }, [allOrders, taxRate]);

  if (analytics.loading) return <LoadingScreen />;
  if (analytics.error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">{t('Failed to load reports')}</p>
          <p className="text-gray-500 text-sm">{analytics.error.message}</p>
        </div>
      </div>
    );
  }

  const { chartData, topItems, recentTransactions } = analytics;
  const pLabel       = periodLabel(dateRange, t);
  const currencyStr = language === 'ar' ? 'ج.م' : 'EGP';
  const maxSale     = Math.max(1, ...(chartData || []).map(d => d.value));
  const maxItemCount = Math.max(1, ...(topItems || []).map(i => i.count));

  // Stat cards — when dateRange = 'Today', these equal Dashboard's values exactly
  const statCards = [
    {
      label: t('TOTAL REVENUE (INCL. TAX)'),
      value: `${analytics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: DollarSign,
      trend: analytics.realRevenue > 0 ? `+${formatMoney(analytics.realRevenue)} ${currencyStr} ${pLabel}` : t('Lifetime total'),
      color: 'green',
    },
    {
      label: language === 'ar' ? 'إجمالي المبالغ المستحقة' : 'Total Amounts Due',
      value: `${totalReceivables.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: Wallet,
      trend: language === 'ar' ? 'مبالغ آجلة مستحقة على العملاء والشركات' : 'Pending customer & company balances',
      color: 'orange',
    },
    {
      label: t('TOTAL ORDERS'),
      value: analytics.totalOrders.toLocaleString(),
      icon: ShoppingBag,
      trend: `${analytics.realOrders} ${t('new')} ${pLabel}`,
      color: 'blue',
    },
    {
      label: t('MENU ITEMS'),
      value: analytics.menuItemsCount.toString(),
      icon: Utensils,
      trend: `${analytics.availableMenuItemsCount} ${t('available now')}`,
      color: 'purple',
    },
  ];

  return (
    <div className="space-y-4 md:space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900">{t('Reports & Analytics')}</h1>
          <p className="text-xs md:text-base text-gray-500">{t('Track your cafe performance and growth.')}</p>
        </div>
        <div className="flex gap-2 md:gap-3">
          <div className="relative flex-1 md:flex-initial">
            <Calendar className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5 md:w-4 md:h-4 ${isRtl ? 'right-3' : 'left-3'}`} />
            <select
              value={dateRange}
              onChange={e => handleDateRangeChange(e.target.value as AnalyticsPeriod)}
              className={`w-full pr-3 md:pr-4 py-2 bg-white border border-gray-200 rounded-lg text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-caramel ${isRtl ? 'pr-8 md:pr-9 pl-3 md:pl-4' : 'pl-8 md:pl-9'}`}
            >
              <option value="Today">{t('Today')}</option>
              <option value="This Week">{t('This Week')}</option>
              <option value="This Month">{t('This Month')}</option>
              <option value="This Year">{t('This Year')}</option>
            </select>
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 bg-gray-900 text-white rounded-lg text-xs md:text-sm font-medium hover:bg-black transition-colors"
          >
            <Download size={14} className="md:w-4 md:h-4" />
            <span className="hidden sm:inline">{t('Export')}</span>
          </button>
        </div>
      </div>

      {/* ── Stat Cards (same StatCard component as Dashboard) ──────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 md:gap-6">
        {statCards.map((s, i) => <StatCard key={i} {...s} />)}
      </div>

      {/* ── Cost & Profit Cards Row ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 tablet:grid-cols-4 lg:grid-cols-4 gap-2 md:gap-6">
        <StatCard
          label={t('Cost of Goods Sold (COGS)')}
          value={`${cogs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`}
          icon={TrendingDown}
          trend={t('Recipe materials cost')}
          color="orange"
        />
        <StatCard
          label={t('Net Profit')}
          value={`${netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`}
          icon={Coins}
          trend={t('Earnings after COGS & tax')}
          color="green"
        />
        <StatCard
          label={t('Total Stock Cost')}
          value={`${inventoryValuation.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`}
          icon={Scale}
          trend={t('Cost value of remaining stock')}
          color="blue"
        />
        <StatCard
          label={t('Expected Potential Profit')}
          value={`${inventoryValuation.totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`}
          icon={TrendingUp}
          trend={t('Potential profit of remaining stock')}
          color="purple"
        />
      </div>

      {/* ── Low Stock Alerts banner ────────────────────────────────────────── */}
      {lowStockItems.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border border-red-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-red-900 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="bg-red-100 text-red-600 p-2 rounded-xl">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h3 className="font-bold text-sm">{t('Low Stock Alerts')}</h3>
              <p className="text-xs text-red-700">
                {lowStockItems.map(i => `${t(i.name)} (${i.stock.toFixed(2)} ${t(i.unit)} remaining)`).join(', ')}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Revenue Trend + Top Items ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 tablet:grid-cols-3 lg:grid-cols-3 gap-4 md:gap-8 text-gray-900">

        {/* Chart */}
        <div className="lg:col-span-2 bg-white p-3 md:p-6 rounded-xl md:rounded-2xl shadow-sm border border-gray-100 flex flex-col">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <h2 className="text-sm md:text-lg font-bold text-gray-900">{t('Revenue Trend')}</h2>
            {analytics.realRevenue > 0 && (
              <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full font-medium">
                +{formatMoney(analytics.realRevenue)} {currencyStr} {pLabel}
              </span>
            )}
          </div>
          <div className="flex-1 w-full pt-2">
            <RevenueAreaChart
              data={chartData}
              currencyStr={currencyStr}
              isRtl={isRtl}
              ordersText={t('orders')}
            />
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 md:mt-4 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-1.5">
              <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-r from-amber-500 via-sky-500 to-blue-600 shadow-sm" />
              <span className="text-xs text-gray-500 font-semibold">{t('Real orders')}</span>
            </div>
          </div>

        </div>

        {/* Top Selling Items */}
        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl shadow-sm border border-gray-100">
          <h2 className="text-sm md:text-lg font-bold text-gray-900 mb-4 md:mb-6">{t('Top Selling Items')}</h2>
          {topItems.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t('No orders')} {pLabel}</p>
          ) : (
            <div className="space-y-4 md:space-y-5">
              {topItems.map((item, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="flex justify-between text-xs md:text-sm">
                    <span className="font-medium text-gray-900">{t(item.name)}</span>
                    <span className="text-gray-500 shrink-0 ml-2">{item.count}x</span>
                  </div>
                  <div className="w-full h-2 bg-mocha-100 rounded-full overflow-hidden">
                    <motion.div
                      key={`${dateRange}-top-${idx}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${(item.count / maxItemCount) * 100}%` }}
                      transition={{ duration: 0.9, delay: 0.2 + idx * 0.08 }}
                      className="h-full bg-caramel rounded-full"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400">{formatMoney(item.revenue)} {currencyStr} {t('revenue')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Order Status Breakdown + Recent Transactions ────────────────────── */}
      <div className="grid grid-cols-1 tablet:grid-cols-3 lg:grid-cols-3 gap-4 md:gap-8 text-gray-900">

        {/* Sales by Order Mode */}
        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl shadow-sm border border-gray-100">
          <div className="mb-4 md:mb-6">
            <h2 className="text-sm md:text-lg font-bold text-gray-900">{t('Sales by Order Mode')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('Dine-in vs Takeaway orders in the selected period')}
            </p>
          </div>
          {orderModeStats.total === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t('No orders')}</p>
          ) : (
            <div className="space-y-6 md:space-y-8 py-2">
              {/* Takeaway Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{t('Takeaway')}</span>
                  </div>
                  <span className="font-bold text-mocha-700 tabular-nums">
                    {orderModeStats.takeaway} {t('orders')} ({Math.round((orderModeStats.takeaway / orderModeStats.total) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-mocha-50 rounded-full overflow-hidden border border-mocha-100/50">
                  <motion.div
                    key={`takeaway-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(orderModeStats.takeaway / orderModeStats.total) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-mocha-650 rounded-full"
                  />
                </div>
              </div>

              {/* Dine-in Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{t('Dine-in')}</span>
                  </div>
                  <span className="font-bold text-caramel-600 tabular-nums">
                    {orderModeStats.dineIn} {t('orders')} ({Math.round((orderModeStats.dineIn / orderModeStats.total) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-caramel-50/50 rounded-full overflow-hidden border border-caramel-100/30">
                  <motion.div
                    key={`dinein-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(orderModeStats.dineIn / orderModeStats.total) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-caramel rounded-full"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Invoice Payment Status */}
        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl shadow-sm border border-gray-100">
          <div className="mb-4 md:mb-6">
            <h2 className="text-sm md:text-lg font-bold text-gray-900 text-left">{t('Invoice Payment Status')}</h2>
            <p className="text-xs text-gray-400 mt-0.5 text-left">
              {t('Paid vs Open invoices breakdown')}
            </p>
          </div>
          {invoiceStats.totalCount === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t('No orders')}</p>
          ) : (
            <div className="space-y-6 md:space-y-8 py-2">
              {/* Paid Invoices Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{t('Paid Invoices')}</span>
                  </div>
                  <span className="font-bold text-green-700 tabular-nums">
                    {invoiceStats.paidCount} ({Math.round((invoiceStats.paidCount / invoiceStats.totalCount) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-green-50 rounded-full overflow-hidden border border-green-100/50">
                  <motion.div
                    key={`paid-invoices-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(invoiceStats.paidCount / invoiceStats.totalCount) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-green-600 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-left">
                  {t('Total Paid')}: {formatMoney(invoiceStats.paidAmount)} {language === 'ar' ? 'ج.م' : 'EGP'}
                </p>
              </div>

              {/* Open Invoices Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{t('Open Invoices')}</span>
                  </div>
                  <span className="font-bold text-amber-600 tabular-nums">
                    {invoiceStats.openCount} ({Math.round((invoiceStats.openCount / invoiceStats.totalCount) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-amber-50 rounded-full overflow-hidden border border-amber-100/30">
                  <motion.div
                    key={`open-invoices-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(invoiceStats.openCount / invoiceStats.totalCount) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-amber-500 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-left">
                  {t('Total Open')}: {formatMoney(invoiceStats.openAmount)} {language === 'ar' ? 'ج.م' : 'EGP'}
                </p>
              </div>

              {/* Divider */}
              <div className="border-t border-gray-100 my-4 pt-4" />

              <div className="mb-3">
                <h3 className="text-xs md:text-sm font-bold text-gray-850 text-left">{t('Payment Methods')}</h3>
                <p className="text-[10px] text-gray-400 text-left">
                  {t('Breakdown of paid revenue')}
                </p>
              </div>

              {/* Cash Revenue Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{t('Cash')}</span>
                  </div>
                  <span className="font-bold text-emerald-700 tabular-nums">
                    {paymentMethodStats.cashPercentage}%
                  </span>
                </div>
                <div className="w-full h-3 bg-emerald-50 rounded-full overflow-hidden border border-emerald-100/50">
                  <motion.div
                    key={`cash-rev-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${paymentMethodStats.cashPercentage}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-emerald-600 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-left">
                  {t('Total Cash')}: {formatMoney(paymentMethodStats.cashAmount)} {language === 'ar' ? 'ج.م' : 'EGP'}
                </p>
              </div>

              {/* Card Revenue Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{t('Card')}</span>
                  </div>
                  <span className="font-bold text-blue-700 tabular-nums">
                    {paymentMethodStats.cardPercentage}%
                  </span>
                </div>
                <div className="w-full h-3 bg-blue-50 rounded-full overflow-hidden border border-blue-100/50">
                  <motion.div
                    key={`card-rev-${dateRange}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${paymentMethodStats.cardPercentage}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-blue-600 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-gray-400 text-left">
                  {t('Total Card')}: {formatMoney(paymentMethodStats.cardAmount)} {language === 'ar' ? 'ج.م' : 'EGP'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Recent Transactions */}
        <div className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl shadow-sm border border-gray-100">
          <h2 className="text-sm md:text-lg font-bold text-gray-900 mb-4 md:mb-6">{t('Recent Transactions')}</h2>
          {recentTransactions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{t('No completed orders')} {pLabel}</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentTransactions.map((order, idx) => {
                const elapsed = Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000);
                const timeStr = elapsed < 1 ? t('just now') : elapsed < 60 ? `${elapsed}${t('m ago')}` : `${Math.round(elapsed / 60)}${t('h ago')}`;
                const summary = order.items.slice(0, 2).map(i => `${i.quantity}× ${t(i.name)}`).join(', ');
                const more    = order.items.length > 2 ? ` +${order.items.length - 2}` : '';
                return (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex items-center justify-between py-2.5 md:py-3 gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-1.5 bg-green-50 text-green-600 rounded-lg shrink-0">
                        <CheckCircle2 size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs md:text-sm font-semibold text-gray-900 truncate text-left">
                          #{formatOrderNumber(order)} · {order.tableId === 'Takeaway' || order.tableId === 'Dine-in' ? t(order.tableId) : `${t('Table')} ${order.tableId}`}
                        </p>
                        <p className="text-[11px] text-gray-400 truncate text-left">{summary}{more}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs md:text-sm font-bold text-gray-900">{formatMoney(getOrderGrandTotal(order, taxRate))} {language === 'ar' ? 'ج.م' : 'EGP'}</p>
                      <p className="text-[11px] text-gray-400">{timeStr}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>


    </div>
  );
}
