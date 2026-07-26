import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, DollarSign, ShoppingBag,
  Coffee, Calendar, Download,
  CheckCircle2, Clock, XCircle, AlertCircle, Utensils,
  UserCheck, Award, Coins, Building2, RefreshCw,
  Signal, SignalHigh, WifiOff, Package, AlertTriangle, BarChart3, Languages, Users, Search, Settings, Send, Scale, TrendingDown, Wallet,
  Undo2, Printer, Trash2, X
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../context/LanguageContext';
import { getTaxRate, getBranchConfig } from '../utils/settingsConfig';
import { useMenu } from '../hooks/useMenu';
import { useAnalytics, AnalyticsPeriod } from '../hooks/useAnalytics';
import { inventoryService } from '../services/inventoryService';
import { resolveInvItem } from '../utils/inventoryHelpers';
import { telegramService } from '../services/telegramService';
import { menuService } from '../services/menuService';
import { isCloudConfigured, getWorkerUrl } from '../services/cloudConfig';
import { RecipeIngredient } from '../global';
import { lazy, Suspense } from 'react';
import { LoadingScreen } from '../components/ui/LoadingScreen';
import { getIngredientBaseQty } from '../utils/units';
import { useToast } from '../components/ui/Toast';
import { useOrders } from '../hooks/useOrders';
import { useAuth } from '../context/AuthContext';
import { printCustomerReceipt } from '../utils/printReceipts';
import {
  getCustomerAccountBalance,
  getCompanyAccountBalance,
  getCustomerOpenInvoices,
  getCompanyOpenInvoices,
} from '../utils/accountBalance';
import { companiesService } from '../services/companiesService';
import { formatOrderNumber } from '../utils/orderNumber';
import { getOrderGrandTotal } from '../types/order';
import { RevenueAreaChart } from '../components/ui/RevenueAreaChart';



const SettingsPage = lazy(() => import('./Settings'));
const InventoryPage = lazy(() => import('./Inventory'));
const CustomersPage = lazy(() => import('./Customers'));
const MenuPage = lazy(() => import('./Menu'));


// ─── Interfaces ──────────────────────────────────────────────────────────────
interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface D1OrderDoc {
  $id: string;
  $createdAt: string;
  branch_id: string;
  total_amount: number;
  payment_method: string;
  items: string; // stringified JSON array of OrderItem
  tableId?: string; // Optional, fallback table
  paymentStatus?: string; // Optional, Paid/Unpaid/OnAccount
  status?: string;
  grandTotal?: number;
  totalAmount?: number;
}

// ─── Date Period Config ────────────────────────────────────────────────────────
// AnalyticsPeriod is imported from useAnalytics (single source of truth)

const CHART_CONFIG: Record<AnalyticsPeriod, {
  labelsAr: string[];
  labelsEn: string[];
  getBucket: (d: Date) => number;
}> = {
  'Today': {
    labelsAr: ['١٢ص', '٢ص', '٤ص', '٦ص', '٨ص', '١٠ص', '١٢م', '٢م', '٤م', '٦م', '٨م', '١٠م'],
    labelsEn: ['12am', '2am', '4am', '6am', '8am', '10am', '12pm', '2pm', '4pm', '6pm', '8pm', '10pm'],
    getBucket: (d) => Math.floor(d.getHours() / 2),
  },
  'This Week': {
    labelsAr: ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'],
    labelsEn: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    getBucket: (d) => (d.getDay() + 6) % 7,
  },
  'This Month': {
    labelsAr: ['الأسبوع ١', 'الأسبوع ٢', 'الأسبوع ٣', 'الأسبوع ٤'],
    labelsEn: ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4'],
    getBucket: (d) => Math.min(Math.floor((d.getDate() - 1) / 7), 3),
  },
  'This Year': {
    labelsAr: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
    labelsEn: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    getBucket: (d) => d.getMonth(),
  },
};

// ─── Date Filter Check ────────────────────────────────────────────────────────
function inPeriod(dateStr: string, period: AnalyticsPeriod): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  switch (period) {
    case 'Today':
      return d.toDateString() === now.toDateString();
    case 'This Week': {
      const start = new Date(now);
      start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      start.setHours(0, 0, 0, 0);
      return d >= start;
    }
    case 'This Month':
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    case 'This Year':
      return d.getFullYear() === now.getFullYear();
  }
}

// ─── Stat Card Component ──────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string;
  icon: React.ElementType;
  trend: string;
  color: 'orange' | 'blue' | 'green' | 'purple';
}

const colorConfig = {
  orange: { 
    gradient: 'from-amber-200 to-orange-200', 
    iconBg: 'bg-gradient-to-br from-amber-50 to-orange-50', 
    iconText: 'text-amber-600',
    glow: 'shadow-amber-200/10'
  },
  blue: { 
    gradient: 'from-blue-200 to-cyan-200', 
    iconBg: 'bg-gradient-to-br from-blue-50 to-cyan-50', 
    iconText: 'text-blue-500',
    glow: 'shadow-blue-200/10'
  },
  green: { 
    gradient: 'from-green-200 to-emerald-200', 
    iconBg: 'bg-gradient-to-br from-green-50 to-emerald-50', 
    iconText: 'text-green-500',
    glow: 'shadow-green-200/10'
  },
  purple: { 
    gradient: 'from-purple-200 to-pink-200', 
    iconBg: 'bg-gradient-to-br from-purple-50 to-pink-50', 
    iconText: 'text-purple-500',
    glow: 'shadow-purple-200/10'
  },
};

function StatCard({ label, value, icon: Icon, trend, color }: StatCardProps) {
  const colors = colorConfig[color] || colorConfig.orange;
  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/95 backdrop-blur-sm p-3 sm:p-4 md:p-6 rounded-xl sm:rounded-2xl shadow-sm hover:shadow-md border border-gray-200/50 relative overflow-hidden group transition-all"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${colors.gradient} opacity-0 group-hover:opacity-[0.03] transition-opacity duration-300`} />
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-3 sm:mb-4 gap-1">
          <motion.div
            whileHover={{ rotate: 15, scale: 1.05 }}
            transition={{ duration: 0.3 }}
            className={`p-2 sm:p-3 rounded-lg sm:rounded-xl ${colors.iconBg} ${colors.iconText} shadow-sm border border-current/10 shrink-0`}
          >
            <Icon className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6" strokeWidth={2} />
          </motion.div>
          <span className="text-[9px] sm:text-[10px] md:text-xs font-sans font-semibold text-green-600 bg-green-50 px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-lg border border-green-100/50 shadow-sm text-right leading-tight max-w-[60%]">
            {trend}
          </span>
        </div>
        <h3 className="text-gray-500 text-[10px] sm:text-xs md:text-sm font-semibold mb-1 uppercase tracking-wide line-clamp-2">{label}</h3>
        <p className="text-base sm:text-xl md:text-2xl lg:text-3xl font-bold text-gray-800 leading-tight">{value}</p>
      </div>
      <div className={`absolute -right-4 -bottom-4 w-24 h-24 bg-gradient-to-br ${colors.gradient} rounded-full opacity-5 group-hover:opacity-10 transition-opacity duration-300 blur-2xl`} />
    </motion.div>
  );
}


// ─── Main Component ───────────────────────────────────────────────────────────
export default function ManagerDashboard() {
  const toast = useToast();
  const { t, isRtl, language, toggleLanguage } = useLanguage();

  const { items: localMenuItems } = useMenu();

  // Filters State
  const [dateRange, setDateRange] = useState<AnalyticsPeriod>(() => {
    const saved = localStorage.getItem('manager_date_range');
    if (saved === 'Today' || saved === 'This Week' || saved === 'This Month' || saved === 'This Year') {
      return saved as AnalyticsPeriod;
    }
    // Default to week so restored cloud history is visible after browser wipe
    return 'This Week';
  });

  const [activeTab, setActiveTab] = useState<'analytics' | 'menu' | 'inventory' | 'customers' | 'settings'>('analytics');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');

  // Unified Analytics & Inventory State
  const analytics = useAnalytics(dateRange);
  const { orders: allRealOrders, refundOrder, deleteOrder } = useOrders();
  const { user } = useAuth();
  const [refundTarget, setRefundTarget] = useState<any | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [liveInventory, setLiveInventory] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);

  useEffect(() => {
    inventoryService.getAll().then(setLiveInventory).catch(() => {});
    inventoryService.getMenuRecipes().then(res => { if (Array.isArray(res)) setRecipes(res); }).catch(() => {});
    menuService.getAll().then(setMenuItems).catch(() => {});
    companiesService.getAll(undefined).then(setCompanies).catch(() => {});
  }, []);

  // Data Fetching State
  const [orders, setOrders] = useState<D1OrderDoc[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [dbInventory, setDbInventory] = useState<any[]>([]);
  const [dbRecipes, setDbRecipes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  const taxRate = getTaxRate();

  // ── Fetch orders, inventory, and menu items from Database ──

  const fetchOrders = async (showToast = false) => {
    if (showToast) setIsRefreshing(true);
    setErrorInfo(null);
    try {
      let ordersList: any[];
      let customersList: any[];
      let invList: any[] = [];
      let recList: any[] = [];

      // Fetch live inventory, menu items, and recipes simultaneously
      const [liveInv, liveRec, liveMenuItems] = await Promise.all([
        inventoryService.getAll(),
        inventoryService.getMenuRecipes(),
        menuService.getAll()
      ]);
      setLiveInventory(liveInv);
      if (Array.isArray(liveRec)) setRecipes(liveRec);
      if (Array.isArray(liveMenuItems)) setMenuItems(liveMenuItems);

      if (window.electronAPI?.getManagerOrders) {
        // Desktop Electron app — fetch via Node main process
        ordersList = await window.electronAPI.getManagerOrders();
        customersList = await window.electronAPI.getManagerCustomers();
        if (window.electronAPI?.getInventory) {
          invList = await window.electronAPI.getInventory();
        }
        if (window.electronAPI?.getMenuRecipes) {
          recList = await window.electronAPI.getMenuRecipes();
        }
      } else {
        // Web Mode — ALWAYS hydrate from Cloudflare D1 first (cross-browser source of truth)
        // then merge into IndexedDB so a fresh manager browser sees cashier sales.
        try {
          const { hydrateFromCloud } = await import('../services/cloudHydrate');
          await hydrateFromCloud(true);
        } catch (hydrateErr) {
          console.warn('[ManagerDashboard] cloud hydrate failed, using local/remote merge:', hydrateErr);
        }

        const { orderRepository, customerRepository } = await import('../repositories');
        // undefined branchId = all branches (manager view)
        const localOrders = await orderRepository.getAll(undefined);
        const localCustomers = await customerRepository.getAll(undefined);

        ordersList = localOrders.map(o => ({
          $id: o.id,
          $createdAt: o.createdAt,
          branch_id: o.branchId || 'main_branch',
          total_amount:
            typeof o.grandTotal === 'number' && o.grandTotal > 0
              ? o.grandTotal
              : o.totalAmount,
          payment_method: o.paymentMethod || 'Cash',
          items: typeof o.items === 'string' ? o.items : JSON.stringify(o.items),
          tableId: o.tableId,
          paymentStatus: o.paymentStatus,
          paidAt: o.paidAt,
          taxAmount: o.taxAmount,
          taxRate: o.taxRate,
          grandTotal: o.grandTotal,
        }));

        customersList = localCustomers.map(c => ({
          $id: c.id,
          name: c.name,
          phone: c.phone,
          points: c.points,
          createdAt: c.createdAt,
          branchId: c.branchId || 'main_branch'
        }));

        invList = liveInv.map(i => ({
          $id: i.id,
          name: i.name,
          unit: i.unit,
          stock: i.stock,
          minStock: i.minStock,
          costPerUnit: i.costPerUnit,
          branch_id: i.branchId || 'main_branch'
        }));
      }

      setOrders(ordersList);
      setCustomers(customersList);
      setDbInventory(invList);
      setDbRecipes(recList);
      setIsDemoMode(false);

      if (showToast) {
        toast.success(language === 'ar' ? 'تم تحديث كافة البيانات والمخزون والإحصائيات بنجاح 🔄' : 'All data, inventory, and stats refreshed successfully 🔄');
      }
    } catch (err: any) {
      console.warn("[ManagerDashboard] Fetch error:", err);
      setErrorInfo(err.message || "Network Timeout");
      setIsDemoMode(false);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };


  useEffect(() => {
    fetchOrders();
    const interval = setInterval(() => {
      fetchOrders();
    }, 10000);
    return () => clearInterval(interval);
  }, []);


  const sendConsolidatedTelegramReport = async () => {
    // 1. Get config
    const configRaw = localStorage.getItem('brewmaster_telegram_config');
    if (!configRaw) {
      alert(language === 'ar' ? 'يرجى إعداد التليجرام أولاً من صفحة الإعدادات!' : 'Please configure Telegram first in Settings!');
      return;
    }
    let config;
    try {
      config = JSON.parse(configRaw);
    } catch(e) {}
    if (!config || !config.botToken || !config.chatId) {
      alert(language === 'ar' ? 'يرجى إدخال التوكن ومعرف المحادثة في الإعدادات أولاً!' : 'Please enter Bot Token and Chat ID in Settings!');
      return;
    }

    const { botToken, chatId } = config;

    if (activeTab === 'settings') {
      alert(language === 'ar' ? 'يرجى فتح لوحة الإحصائيات أو المخزون أو العملاء لإرسال تقرير تليجرام المخصص لها!' : 'Please open the Analytics, Inventory, or Customers tab to send its report!');
      return;
    }

    // 2. Branch label — single-branch system, name comes from branch settings
    const activeBranchName = getBranchConfig().branchName;

    const todayStr = new Date().toLocaleDateString('en-CA');
    let message = '';

    if (activeTab === 'analytics') {
      // 📑 REPORT 1: SALES & ANALYTICS REPORT
      const periodNames: Record<AnalyticsPeriod, string> = {
        'Today': language === 'ar' ? 'اليوم' : 'Today',
        'This Week': language === 'ar' ? 'هذا الأسبوع' : 'This Week',
        'This Month': language === 'ar' ? 'هذا الشهر' : 'This Month',
        'This Year': language === 'ar' ? 'هذا العام' : 'This Year'
      };
      const activePeriodLabel = periodNames[dateRange] || dateRange;

      // Filter orders matching current dateRange (single-branch system)
      const filteredOrders = orders.filter(order => inPeriod(order.$createdAt, dateRange));

      if (filteredOrders.length === 0) {
        alert(language === 'ar' ? 'لا توجد مبيعات مسجلة في هذه الفترة لإرسالها!' : 'No orders recorded in this period to send!');
        return;
      }

      message = `📊 <b>تقرير مبيعات BrewMaster: ${activeBranchName}</b>\n`;
      message += `⏱️ الفئة/الفترة: <b>${activePeriodLabel}</b> (بتاريخ: <code>${todayStr}</code>)\n\n`;

      message += `💰 <b>الملخص المالي للفترة:</b>\n`;
      message += `• إجمالي المبيعات (المحصلة): <b>${processedData.totalRevenue.toFixed(2)}</b> ج.م\n`;
      message += `• عدد الطلبات الكلي: <b>${processedData.totalCount}</b> طلب\n`;
      message += `• إجمالي الآجل: <b>${processedData.unpaidAmount.toFixed(2)}</b> ج.م\n\n`;

      message += `💳 <b>تفاصيل طرق الدفع (المحصلة):</b>\n`;
      message += `• نقدي (Cash): <b>${processedData.cashAmount.toFixed(2)}</b> ج.م (${processedData.cashPercentage}%)\n`;
      message += `• شبكة/بطاقة (Card): <b>${processedData.cardAmount.toFixed(2)}</b> ج.م (${processedData.cardPercentage}%)\n\n`;

      message += `🍽️ <b>أنواع الطلبات:</b>\n`;
      message += `• سفري (Takeaway): <b>${processedData.takeawayCount}</b> طلب\n`;
      message += `• صالة (Dine-in): <b>${processedData.dineInCount}</b> طلب\n\n`;

      if (processedData.topItems && processedData.topItems.length > 0) {
        message += `☕ <b>أكثر الأصناف مبيعاً في هذه الفترة:</b>\n`;
        processedData.topItems.forEach(item => {
          message += `• ${item.name}: عدد <b>${item.count}</b>\n`;
        });
        message += `\n`;
      }

      // ── Outstanding Receivables section ──
      if (receivablesData.grandTotal > 0) {
        message += `💸 <b>المبالغ المستحقة (على الحساب):</b>\n`;
        message += `• إجمالي المستحقات: <b>${receivablesData.grandTotal.toFixed(2)}</b> ج.م\n`;
        if (receivablesData.companiesOwed.length > 0) {
          message += `🏢 <b>ديون الشركات:</b>\n`;
          receivablesData.companiesOwed.slice(0, 5).forEach(co => {
            message += `• ${co.name}: <b>${co.balance.toFixed(2)}</b> ج.م (${co.invoiceCount} فاتورة)\n`;
          });
          message += `\n`;
        }
        if (receivablesData.customersOwed.length > 0) {
          message += `👤 <b>ديون العملاء:</b>\n`;
          receivablesData.customersOwed.slice(0, 5).forEach(c => {
            message += `• ${c.name}: <b>${c.balance.toFixed(2)}</b> ج.م\n`;
          });
          if (receivablesData.customersOwed.length > 5) {
            message += `• و ${receivablesData.customersOwed.length - 5} عميل آخر\n`;
          }
          message += `\n`;
        }
      }

      message += `✅ تم تصدير التقرير من لوحة الإشراف المركزية`;

    } else if (activeTab === 'inventory') {
      // 📦 REPORT 2: INVENTORY REPORT
      message = `📦 <b>تقرير حالة المخزون: ${activeBranchName}</b>\n`;
      message += `⏱️ التاريخ: <code>${todayStr}</code>\n\n`;

      message += `📊 <b>ملخص حالة المخزون للفترة:</b>\n`;
      message += `• القيمة التقديرية للمخزون: <b>${inventorySummary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> ج.م\n`;
      message += `• عدد المواد الخام المتابعة: <b>${inventorySummary.totalItems}</b> صنف\n`;
      message += `• تنبيهات نقص المخزون: <b>${inventorySummary.lowStockCount}</b> صنف\n\n`;

      message += `📋 <b>تفاصيل كميات المواد الخام:</b>\n`;
      inventoryData.forEach(inv => {
        const name = language === 'ar' ? inv.nameAr : inv.nameEn;
        const unit = language === 'ar' ? inv.unitAr : inv.unit;
        const warning = inv.isLow ? ' ⚠️ (نقص)' : '';
        message += `• ${name}: <b>${inv.remaining}</b> ${unit} (${inv.percentage}%)${warning}\n`;
      });
      message += `\n`;

      message += `✅ تم تصدير تقرير المخزون من لوحة الإشراف المركزية`;

    } else if (activeTab === 'customers') {
      // 👥 REPORT 3: CUSTOMERS REPORT
      message = `👥 <b>تقرير العملاء: ${activeBranchName}</b>\n`;
      message += `⏱️ التاريخ: <code>${todayStr}</code>\n\n`;

      message += `📊 <b>ملخص قاعدة العملاء:</b>\n`;
      message += `• إجمالي العملاء المسجلين: <b>${customers.length}</b> عميل\n\n`;

      const owed = receivablesData.customersOwed;
      const customersDebtTotal = owed.reduce((s, c) => s + (Number(c.balance) || 0), 0);
      if (owed.length > 0) {
        message += `💸 <b>مديونية العملاء (على الحساب):</b>\n`;
        message += `• إجمالي المستحق على العملاء: <b>${customersDebtTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> ج.م\n`;
        message += `• عدد العملاء المدينين: <b>${owed.length}</b> عميل\n`;
        owed.slice(0, 5).forEach(c => {
          message += `• ${c.name}: <b>${c.balance.toFixed(2)}</b> ج.م (${c.invoiceCount} فاتورة)\n`;
        });
        if (owed.length > 5) {
          message += `• و ${owed.length - 5} عميل آخر\n`;
        }
        message += `\n`;
      } else {
        message += `✅ لا توجد مبالغ مستحقة على العملاء حالياً\n\n`;
      }

      message += `✅ تم تصدير تقرير العملاء من لوحة الإشراف المركزية`;
    }

    // Guard: never send an empty report (e.g. from the menu tab, which has no report)
    if (!message.trim()) {
      alert(language === 'ar' ? 'يرجى فتح لوحة الإحصائيات أو المخزون أو العملاء لإرسال تقرير تليجرام المخصص لها!' : 'Please open the Analytics, Inventory, or Customers tab to send its report!');
      return;
    }

    // Send message to Telegram using shared service
    try {
      await telegramService.sendMessage(botToken, chatId, message, 'HTML');
      alert(language === 'ar' ? 'تم إرسال تقرير الفترة المحددة للتليجرام بنجاح!' : 'Report for the selected period sent successfully to Telegram!');
    } catch(err: any) {
      alert(`${language === 'ar' ? 'فشل الإرسال: ' : 'Send failed: '}${err.message || 'خطأ غير معروف'}`);
    }
  };

  // ── Scoped Data Processing (Directly from analytics hook for 100% parity with Reports) ──
  const processedData = useMemo(() => {
    // Canonical order total: prefer frozen grandTotal, else compute from totalAmount+tax-points
    const orderTotal = (o: any) => getOrderGrandTotal(o, taxRate);

    const cashAmount = analytics.completedPeriod
      .filter(o => o.paymentMethod === 'Cash')
      .reduce((s, o) => s + orderTotal(o), 0);
    const cardAmount = analytics.completedPeriod
      .filter(o => o.paymentMethod === 'Card')
      .reduce((s, o) => s + orderTotal(o), 0);
    const cashCardTotal = cashAmount + cardAmount;

    return {
      totalRevenue: analytics.totalRevenue,
      totalOrdersCount: analytics.totalOrders,
      avgOrderValue: analytics.avgOrderValue,
      chartData: analytics.chartData,
      topItems: analytics.topItems,
      takeawayCount: analytics.completedPeriod.filter(o => o.tableId === 'Takeaway').length,
      dineInCount: analytics.completedPeriod.filter(o => o.tableId !== 'Takeaway').length,
      // Match Reports: paid = Paid only, open = Unpaid + OnAccount
      paidCount: analytics.completedPeriod.length,
      unpaidCount: analytics.periodOrders.filter(
        o => o.status !== 'Cancelled' && (o.paymentStatus === 'Unpaid' || o.paymentStatus === 'OnAccount')
      ).length,
      totalCount: analytics.completedPeriod.length,
      paidAmount: analytics.realRevenue,
      unpaidAmount: analytics.periodOrders
        .filter(o => o.status !== 'Cancelled' && (o.paymentStatus === 'Unpaid' || o.paymentStatus === 'OnAccount'))
        .reduce((s, o) => s + orderTotal(o), 0),
      cashAmount,
      cardAmount,
      // Percentage of settled (cash+card) revenue — excludes on-account so cash+card = 100%
      cashPercentage: cashCardTotal > 0 ? Math.round((cashAmount / cashCardTotal) * 100) : 0,
      cardPercentage: cashCardTotal > 0 ? Math.round((cardAmount / cashCardTotal) * 100) : 0,
      recentTransactions: analytics.recentTransactions,
      customerCount: customers.length,
    };
  }, [analytics, taxRate, customers]);

  // ── Inventory Data for Tab views ──
  const activeInventory = useMemo(() => {
    return liveInventory && liveInventory.length > 0 ? liveInventory : dbInventory;
  }, [liveInventory, dbInventory]);

  const inventoryData = useMemo(() => {
    // Single-branch system: real stock, reported once. The previous shape
    // duplicated the same stock value under branch_1/2/3 keys, which fabricated
    // a per-branch comparison in the Telegram report that never existed.
    return activeInventory.map(inv => ({
      ...inv,
      nameAr: inv.name,
      nameEn: inv.name,
      unitAr: inv.unit,
      remaining: inv.stock,
      consumed: 0,
      startStock: inv.stock,
      percentage: 100,
      isLow: inv.stock <= inv.minStock,
    }));
  }, [activeInventory]);

  // ── Compute average selling yields for materials (100% Identical to Reports) ──
  const itemYields = useMemo(() => {
    const yields: Record<string, number> = {};

    const invMapById = new Map<string, any>();
    activeInventory.forEach(item => invMapById.set(item.id, item));

    const resolveInvItem = (inventoryItemId: string): any => {
      if (invMapById.has(inventoryItemId)) return invMapById.get(inventoryItemId);
      if (inventoryItemId.startsWith('inv_b_')) {
        const num = parseInt(inventoryItemId.replace('inv_b_', ''), 10);
        if (!isNaN(num) && num > 0 && num <= activeInventory.length) {
          return activeInventory[num - 1];
        }
      }
      return undefined;
    };

    const getUnitCost = (invItemId: string): number => {
      const found = resolveInvItem(invItemId);
      return found?.costPerUnit && found.costPerUnit > 0 ? found.costPerUnit : 1;
    };

    const menuRecipeMap: Record<string, any[]> = {};
    recipes.forEach(r => {
      if (r.menuItemId) {
        if (!menuRecipeMap[r.menuItemId]) menuRecipeMap[r.menuItemId] = [];
        menuRecipeMap[r.menuItemId].push(r);
      }
    });

    const activeMenuItems = (menuItems.length > 0 ? menuItems : (localMenuItems || []));
    const menuMap = new Map(activeMenuItems.map(m => [String(m.id), m]));

    const menuTotalCostMap = new Map<string, number>();
    Object.entries(menuRecipeMap).forEach(([mId, ingList]) => {
      const totalCost = ingList.reduce((sum, ing) => {
        const invItem = resolveInvItem(ing.inventoryItemId);
        const cost = invItem?.costPerUnit && invItem.costPerUnit > 0 ? invItem.costPerUnit : 1;
        const baseQty = getIngredientBaseQty(ing.quantity, ing.unit || '', invItem?.unit || '');
        return sum + (baseQty * cost);
      }, 0);
      menuTotalCostMap.set(mId, totalCost > 0 ? totalCost : 1);
    });

    const invRecipesMap = new Map<string, { menuItemId: string; quantity: number, unit?: string }[]>();
    recipes.forEach(r => {
      const invItem = resolveInvItem(r.inventoryItemId);
      const targetId = invItem ? invItem.id : r.inventoryItemId;

      if (!invRecipesMap.has(targetId)) invRecipesMap.set(targetId, []);
      invRecipesMap.get(targetId)!.push({
        menuItemId: String(r.menuItemId),
        quantity: r.quantity,
        unit: r.unit
      });
    });

    activeInventory.forEach((item: any) => {
      const itemRecipes = invRecipesMap.get(item.id) || [];
      const itemUnitCost = item.costPerUnit && item.costPerUnit > 0 ? item.costPerUnit : 1;

      if (itemRecipes.length === 0) {
        // No recipe linked — use a simple 2.5x markup as fallback estimate
        yields[item.id] = itemUnitCost * 2.5;
        return;
      }

      let totalUnitYield = 0;
      let validCount = 0;

      itemRecipes.forEach(rec => {
        const menuItem = menuMap.get(String(rec.menuItemId));
        const totalRecipeCost = menuTotalCostMap.get(String(rec.menuItemId)) || 1;
        if (menuItem && menuItem.price > 0 && rec.quantity > 0) {
          const baseQty = getIngredientBaseQty(rec.quantity, rec.unit || '', item.unit || '');
          if (baseQty > 0) {
            const itemCostInRecipe = baseQty * itemUnitCost;
            const costShareFraction = itemCostInRecipe / totalRecipeCost;
            const allocatedRevenue = menuItem.price * costShareFraction;
            const unitYield = allocatedRevenue / baseQty;
            totalUnitYield += unitYield;
            validCount++;
          }
        }
      });

      yields[item.id] = validCount > 0 ? (totalUnitYield / validCount) : (itemUnitCost * 2.5);
    });

    return yields;
  }, [activeInventory, recipes, menuItems, localMenuItems]);

  // Inventory summary stats matching Reports page
  const inventorySummary = useMemo(() => {
    let totalValue = 0;
    let totalProfitValue = 0;
    let lowStockCount = 0;
    let totalItems = 0;

    activeInventory.forEach((item: any) => {
      const stock = Number(item.stock || 0);
      const costPerUnit = Number(item.costPerUnit || 0);
      const costVal = stock * costPerUnit;
      const avgYield = itemYields[item.id] || (costPerUnit * 2.5);
      const potSales = stock * avgYield;
      const potProfit = potSales > 0 ? Math.max(potSales - costVal, 0) : 0;

      totalValue += costVal;
      totalProfitValue += potProfit;

      if (stock <= (item.minStock || 0)) lowStockCount++;
      totalItems++;
    });

    return { totalValue, totalSalesValue: totalValue + totalProfitValue, totalProfitValue, lowStockCount, totalItems };
  }, [activeInventory, itemYields]);

  // Max bounds for graphing
  const maxRevenueValue = Math.max(...processedData.chartData.map(d => d.value), 1);
  const maxItemCount = Math.max(...processedData.topItems.map(i => i.count), 1);

  // Labels helper — single-branch system, name comes from branch settings
  const activeBranchLabel = useMemo(() => getBranchConfig().branchName, []);

  const pLabel = useMemo(() => {
    const map: Record<AnalyticsPeriod, string> = {
      'Today': 'today', 'This Week': 'this week', 'This Month': 'this month', 'This Year': 'this year',
    };
    return t(map[dateRange]);
  }, [dateRange, t]);

  const currencyStr = language === 'ar' ? 'ج.م' : 'EGP';

  // COGS & Net Profit Calculations (100% Identical to Reports)
  const recipeCosts = useMemo(() => {
    const costMap: Record<string, number> = {};
    for (const r of recipes) {
      const invItem = activeInventory.find((i: any) => i.id === r.inventoryItemId);
      const itemCost = invItem ? invItem.costPerUnit : 0;
      const baseQty = getIngredientBaseQty(r.quantity, r.unit || '', invItem?.unit || '');
      costMap[r.menuItemId] = (costMap[r.menuItemId] || 0) + (baseQty * itemCost);
    }
    return costMap;
  }, [recipes, activeInventory]);

  const cogs = useMemo(() => {
    let totalCogs = 0;
    for (const order of analytics.completedPeriod) {
      for (const item of order.items) {
        const itemCost = recipeCosts[item.menuItemId || item.id] || 0;
        totalCogs += itemCost * item.quantity;
      }
    }
    return totalCogs;
  }, [analytics.completedPeriod, recipeCosts]);

  const netProfit = useMemo(() => {
    // totalRevenue is tax-inclusive (sum of grandTotal). Subtract the ACTUAL
    // collected tax (from frozen snapshots) — NOT revenue * taxRate, which
    // would double-discount and under-report profit.
    return Math.max(0, analytics.totalRevenue - analytics.totalTax - cogs);
  }, [analytics.totalRevenue, analytics.totalTax, cogs]);

  // ── Receivables breakdown (canonical, matching Payment.tsx exactly) ──
  const receivablesData = useMemo(() => {
    // Single-branch system: every order belongs to the one branch.
    const realOrders = allRealOrders || [];

    const accountOrders = realOrders.filter(o => o.paymentStatus === 'OnAccount' && o.status !== 'Cancelled');

    // Create lookup maps
    const customerByPhone = new Map<string, any>();
    for (const c of customers) {
      const p = (c.phone || '').replace(/[\s\-()]/g, '').trim().toLowerCase();
      if (p) customerByPhone.set(p, c);
      if (c.id) customerByPhone.set(`id:${c.id}`, c);
    }

    const companyById = new Map<string, any>();
    companies.forEach(c => companyById.set(c.id, c));

    // Helper functions (same as Payment.tsx)
    const normalize = (s: string) => s.replace(/[\s\-()]/g, '').trim().toLowerCase();
    const realName = (name?: string | null) => {
      const n = (name || '').trim();
      if (!n) return undefined;
      const lower = n.toLowerCase();
      if (lower === 'عميل' || lower === 'customer' || lower === 'شركة' || lower === 'company' || n === '—') return undefined;
      return n;
    };
    const resolveCustomerName = (o: any) => {
      const fromOrder = realName(o.customerName);
      if (fromOrder) return fromOrder;
      if (o.customerId) {
        const byId = customerByPhone.get(`id:${o.customerId}`);
        const n = realName(byId?.name);
        if (n) return n;
      }
      if (o.customerPhone) {
        const byPhone = customerByPhone.get(normalize(o.customerPhone));
        const n = realName(byPhone?.name);
        if (n) return n;
      }
      return undefined;
    };
    const resolveCompanyId = (o: any) => {
      if (o.billedToType === 'customer') return undefined;
      if (o.companyId) return o.companyId;
      return undefined;
    };

    const companiesMap = new Map<string, any>();
    const customersMap = new Map<string, any>();
    
    let grandTotal = 0;

    for (const o of accountOrders) {
      // Calculate order total exactly like Payment.tsx (using getOrderGrandTotal logic)
      const rate = typeof o.taxRate === 'number' && Number.isFinite(o.taxRate) ? o.taxRate : taxRate;
      const tax = typeof o.taxAmount === 'number' && Number.isFinite(o.taxAmount) ? o.taxAmount : (o.totalAmount || 0) * rate;
      let total = (o.totalAmount || 0) + tax;
      if (typeof o.grandTotal === 'number' && Number.isFinite(o.grandTotal) && o.grandTotal > 0) {
        total = o.grandTotal;
      }
      total = Math.max(0, Number.isFinite(total) ? total : 0);

      grandTotal += total;

      const coId = resolveCompanyId(o);
      const custName = resolveCustomerName(o);

      if (coId) {
        const key = coId;
        const existing = companiesMap.get(key);
        if (existing) {
          existing.balance += total;
          existing.invoiceCount += 1;
        } else {
          const co = companyById.get(coId);
          companiesMap.set(key, {
            id: coId,
            name: co ? co.name : (language === 'ar' ? 'شركة' : 'Company'),
            phone: co?.phone,
            balance: total,
            invoiceCount: 1,
            type: 'company'
          });
        }
        continue;
      }

      // Customer
      const phoneKey = o.customerPhone ? normalize(o.customerPhone) : '';
      const idPart = o.customerId || phoneKey || o.id;
      const key = idPart;
      const existing = customersMap.get(key);
      const displayName = custName || o.customerPhone?.trim() || (language === 'ar' ? 'عميل' : 'Customer');

      if (existing) {
        existing.balance += total;
        existing.invoiceCount += 1;
        if (!existing.phone && o.customerPhone) existing.phone = o.customerPhone;
        if (custName) {
          existing.name = custName;
        } else if (o.customerPhone && (existing.name === 'عميل' || existing.name === 'Customer')) {
          existing.name = o.customerPhone;
        }
      } else {
        customersMap.set(key, {
          id: key,
          name: displayName,
          phone: o.customerPhone,
          balance: total,
          invoiceCount: 1,
          type: 'customer'
        });
      }
    }

    return {
      customersOwed: Array.from(customersMap.values()).sort((a, b) => b.balance - a.balance),
      companiesOwed: Array.from(companiesMap.values()).sort((a, b) => b.balance - a.balance),
      grandTotal
    };
  }, [allRealOrders, customers, companies, taxRate, language]);

  const totalReceivables = receivablesData.grandTotal;

  // All 8 Stat Cards (Matching Reports page 100%)
  const statCardsRow1 = [
    {
      label: t('TOTAL REVENUE (INCL. TAX)'),
      value: `${analytics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: DollarSign,
      trend: analytics.realRevenue > 0 ? `+${analytics.realRevenue.toFixed(2)} ${currencyStr} ${pLabel}` : t('Lifetime total'),
      color: 'green' as const,
    },
    {
      label: language === 'ar' ? 'إجمالي المبالغ المستحقة' : 'Total Amounts Due',
      value: `${totalReceivables.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: Wallet,
      trend: language === 'ar' ? 'إجمالي الآجل المستحق على العملاء والشركات' : 'Outstanding customer & company balances',
      color: 'orange' as const,
    },
    {
      label: t('TOTAL ORDERS'),
      value: analytics.totalOrders.toLocaleString(),
      icon: ShoppingBag,
      trend: `${analytics.realOrders} ${t('new')} ${pLabel}`,
      color: 'blue' as const,
    },
    {
      label: t('Menu Items'),
      value: analytics.menuItemsCount.toString(),
      icon: Coffee,
      trend: `${analytics.availableMenuItemsCount} ${t('available now')}`,
      color: 'purple' as const,
    },
  ];

  const statCardsRow2 = [
    {
      label: t('Cost of Goods Sold (COGS)'),
      value: `${cogs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: TrendingDown,
      trend: language === 'ar' ? 'تكلفة الخامات الملازمة للوجبات المباعة' : 'Recipe materials cost',
      color: 'orange' as const,
    },
    {
      label: t('Net Profit'),
      value: `${netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: Coins,
      trend: language === 'ar' ? 'صافي الربح الفعلي بعد الخامات والضريبة' : 'Earnings after COGS & tax',
      color: 'green' as const,
    },
    {
      label: t('Total Stock Cost'),
      value: `${inventorySummary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: Scale,
      trend: language === 'ar' ? 'سعر شراء الخامات بالمخزن' : 'Cost value of remaining stock',
      color: 'blue' as const,
    },
    {
      label: t('Expected Potential Profit'),
      value: `${inventorySummary.totalProfitValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: TrendingUp,
      trend: language === 'ar' ? 'الأرباح المتوقعة من الخامات بالمخزن' : 'Potential profit of remaining stock',
      color: 'purple' as const,
    },
  ];

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      // Search filter
      const query = customerSearchTerm.trim().toLowerCase();
      if (!query) return true;
      return (
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.phone && c.phone.includes(query))
      );
    });
  }, [customers, customerSearchTerm]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] text-gray-700 space-y-4">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
          className="p-3 bg-mocha-100 rounded-full text-mocha-650"
        >
          <RefreshCw size={32} />
        </motion.div>
        <p className="font-semibold text-lg">{language === 'ar' ? 'جاري جلب إحصائيات الفروع...' : 'Fetching branch statistics...'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-8 text-gray-900 pb-16 sm:pb-4">
      
      {/* ── Header Area with Live Status & Filters ─────────────────────────────────── */}
      <div className="flex flex-col tablet:flex-row tablet:items-center xl:flex-row xl:items-center justify-between gap-3 sm:gap-4 bg-white/50 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-gray-200/40 shadow-sm relative z-30">
        
        {/* Title and Cloud Sync Connection Badge */}
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">
              {language === 'ar' ? 'لوحة تحكم المدير العام' : 'Web Manager Central Dashboard'}
            </h1>
            
            {/* Live Connection Sync Status Badge — honest cloud status */}
            {(() => {
              const cloudOn = isCloudConfigured();
              const offline = typeof navigator !== 'undefined' && !navigator.onLine;
              if (isDemoMode || offline) {
                return (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-colors shadow-sm bg-amber-50 text-amber-600 border-amber-200/50">
                    <WifiOff size={13} className="animate-pulse" />
                    <span>{language === 'ar' ? 'أوفلاين / محلي' : 'Offline / Local'}</span>
                  </div>
                );
              }
              if (!cloudOn) {
                return (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-colors shadow-sm bg-red-50 text-red-600 border-red-200/50" title={language === 'ar' ? 'اضبط VITE_CLOUDFLARE_WORKER_URL' : 'Set VITE_CLOUDFLARE_WORKER_URL'}>
                    <AlertCircle size={13} />
                    <span>{language === 'ar' ? 'سحابة غير مفعّلة (محلي فقط)' : 'Cloud off (local only)'}</span>
                  </div>
                );
              }
              return (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-colors shadow-sm bg-emerald-50 text-emerald-600 border-emerald-200/50" title={getWorkerUrl()}>
                  <SignalHigh size={13} className="text-emerald-500 animate-pulse" />
                  <span>{language === 'ar' ? 'Cloudflare D1 مفعّل' : 'Cloudflare D1 Enabled'}</span>
                </div>
              );
            })()}
            
            {/* Manual Refresh Button */}
            <button 
              onClick={() => fetchOrders(true)}
              disabled={isRefreshing}
              className="p-2 rounded-lg hover:bg-gray-100 border border-gray-200 transition-all text-gray-500 hover:text-gray-900 active:scale-95 disabled:opacity-50"
              title={language === 'ar' ? 'تحديث كافة البيانات والمخزون' : 'Refresh All Data & Inventory'}
            >
              <RefreshCw size={14} className={`transition-transform ${isRefreshing ? 'animate-spin text-mocha-650' : 'hover:rotate-45'}`} />
            </button>

          </div>
          <p className="text-xs md:text-sm text-gray-500 font-medium">
            {language === 'ar' 
              ? 'مراقبة إيرادات ومبيعات كافة الفروع المتصلة بقاعدة البيانات المركزية' 
              : 'Monitor revenues and sales across all branches synced to the cloud.'}
          </p>
        </div>

        {/* Filters Panel (Date Selector) - Only show on analytics tab */}
        {activeTab === 'analytics' && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">

            {/* Date Range Dropdown */}
            <div className="relative flex items-center bg-white border border-gray-250/70 rounded-xl shadow-sm pr-2 sm:pr-3">
              <Calendar className="text-gray-400 w-4 h-4 ml-2 mr-1.5 sm:mr-2 shrink-0" />
              <select
                value={dateRange}
                onChange={e => {
                  const val = e.target.value as AnalyticsPeriod;
                  setDateRange(val);
                  localStorage.setItem('manager_date_range', val);
                }}
                className="py-2 sm:py-2.5 bg-transparent border-0 outline-none text-[11px] sm:text-xs md:text-sm font-bold text-gray-700 cursor-pointer pr-6 sm:pr-8"
              >
                <option value="Today">{t('Today')}</option>
                <option value="This Week">{t('This Week')}</option>
                <option value="This Month">{t('This Month')}</option>
                <option value="This Year">{t('This Year')}</option>
              </select>
            </div>

            {/* Telegram Daily Report */}
            <button
              onClick={sendConsolidatedTelegramReport}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-[11px] sm:text-xs md:text-sm font-bold transition-all active:scale-95 shadow-sm"
              title={language === 'ar' ? 'إرسال تقرير اليوم لتليجرام' : 'Send Daily Report to Telegram'}
            >
              <Send size={14} className="shrink-0" />
              <span className="whitespace-nowrap">{language === 'ar' ? 'تليجرام' : 'Telegram'}</span>
            </button>

            {/* Print Report */}
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-gray-900 hover:bg-black text-white rounded-xl text-[11px] sm:text-xs md:text-sm font-bold transition-all active:scale-95 shadow-sm"
            >
              <Download size={14} className="shrink-0" />
              <span className="whitespace-nowrap">{t('Export')}</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Tab Switcher ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 sm:gap-2 bg-white/80 backdrop-blur-sm p-1.5 rounded-xl border border-gray-200/50 shadow-sm w-full sm:w-fit max-w-full overflow-x-auto hide-scrollbar">
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-[11px] sm:text-xs md:text-sm font-bold transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'analytics'
              ? 'bg-gray-900 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <BarChart3 size={15} className="shrink-0" />
          <span className="truncate">{language === 'ar' ? 'الإحصائيات' : 'Analytics'}</span>
        </button>
        <button
          onClick={() => setActiveTab('menu')}
          className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-[11px] sm:text-xs md:text-sm font-bold transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'menu'
              ? 'bg-gray-900 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Coffee size={15} className="shrink-0" />
          <span className="truncate">{language === 'ar' ? 'القائمة' : 'Menu'}</span>
        </button>
        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-[11px] sm:text-xs md:text-sm font-bold transition-all relative whitespace-nowrap shrink-0 ${
            activeTab === 'inventory'
              ? 'bg-gray-900 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Package size={15} className="shrink-0" />
          <span className="truncate">{language === 'ar' ? 'المخزون' : 'Inventory'}</span>
          {inventorySummary.lowStockCount > 0 && (
            <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center ${
              activeTab === 'inventory' ? 'bg-red-500 text-white' : 'bg-red-500 text-white animate-pulse'
            }`}>
              {inventorySummary.lowStockCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('customers')}
          className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-[11px] sm:text-xs md:text-sm font-bold transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'customers'
              ? 'bg-gray-900 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Users size={15} className="shrink-0" />
          <span className="truncate">{language === 'ar' ? 'العملاء' : 'Customers'}</span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-[11px] sm:text-xs md:text-sm font-bold transition-all relative whitespace-nowrap shrink-0 ${
            activeTab === 'settings'
              ? 'bg-gray-900 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Settings size={15} className="shrink-0" />
          <span className="truncate">{language === 'ar' ? 'الإعدادات' : 'Settings'}</span>
        </button>
      </div>

      {/* ── Error Banner for Demo Fallback Mode ────────────────────────────────────── */}
      {isDemoMode && errorInfo && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start gap-3"
        >
          <AlertCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-sm">{language === 'ar' ? 'تم تشغيل الوضع التجريبي الاحتياطي' : 'Offline Demo Mode Active'}</h4>
            <p className="text-xs text-amber-700/90 leading-normal">
              {language === 'ar' 
                ? `تعذر الاتصال بقاعدة بيانات Cloudflare المركزية (${errorInfo}). تم تحميل حزمة تحاكي الإحصائيات الحية لـ 3 فروع لتسهيل العرض التقديمي بشكل تفاعلي بالكامل.`
                : `Could not connect to Cloudflare central database (${errorInfo}). Loaded a robust local fallback representing 3 branches to ensure full dashboard interactivity for your presentation.`}
            </p>
          </div>
        </motion.div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ══ ANALYTICS TAB ═══════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'analytics' && (<>

      {/* ── All 8 Stat Cards in 2 Rows (100% Identical to Reports Page) ───────────── */}
      <div className="space-y-3 sm:space-y-4 md:space-y-6">
        {/* Row 1: 4 cards (Revenue, Receivables/المبالغ المستحقة, Orders, Menu Items) */}
        <div className="grid grid-cols-2 tablet:grid-cols-4 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
          {statCardsRow1.map((s, i) => <StatCard key={i} {...s} />)}
        </div>
        {/* Row 2: 4 cards (COGS, Net Profit, Stock Cost, Potential Profit) */}
        <div className="grid grid-cols-2 tablet:grid-cols-4 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
          {statCardsRow2.map((s, i) => <StatCard key={i} {...s} />)}
        </div>
      </div>

      {/* ── Chart & Top Items Panels ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 tablet:grid-cols-3 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
        
        {/* Revenue Trend Chart */}
        <div className="lg:col-span-2 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-150 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base md:text-lg font-extrabold text-gray-900">
                {language === 'ar' ? 'منحنى الإيرادات المركّب' : 'Aggregated Revenue Trend'}
              </h2>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {language === 'ar' 
                  ? `أرقام المبيعات المسجلة لـ (${activeBranchLabel}) خلال ${pLabel}`
                  : `Visualizing completed sales for (${activeBranchLabel}) during ${pLabel}`}
              </p>
            </div>
            {processedData.totalRevenue > 0 && (
              <span className="text-xs text-green-600 bg-green-50 px-3 py-1 rounded-full font-bold border border-green-100">
                +{processedData.totalRevenue.toFixed(0)} {currencyStr}
              </span>
            )}
          </div>

          <div className="flex-1 w-full pt-2">
            <RevenueAreaChart
              data={processedData.chartData}
              currencyStr={currencyStr}
              isRtl={language === 'ar'}
              ordersText={t('orders')}
            />
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-2 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-r from-amber-500 via-sky-500 to-blue-600 shadow-sm" />
              <span className="text-xs text-gray-600 font-semibold">
                {language === 'ar' ? 'إجمالي المبيعات المحققة' : 'Completed Sales Revenue'}
              </span>
            </div>
          </div>

        </div>

        {/* Top Selling Items (الأصناف الأكثر مبيعاً) */}
        <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-150 flex flex-col justify-between">
          <div>
            <h2 className="text-base md:text-lg font-extrabold text-gray-900 mb-1">
              {t('Top Selling Items')}
            </h2>
            <p className="text-[11px] text-gray-400 mb-6">
              {language === 'ar' 
                ? 'الأصناف الأعلى طلباً من الفواتير المدفوعة المحسوبة للفترة' 
                : 'Top items sorted by quantity sold in the selected period.'}
            </p>
          </div>

          {processedData.topItems.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-gray-400">
              <Utensils size={36} className="mb-2 text-gray-300" />
              <p className="text-xs">{t('No orders')} ({pLabel})</p>
            </div>
          ) : (
            <div className="space-y-4 md:space-y-5 flex-1">
              {processedData.topItems.map((item, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="flex justify-between text-xs md:text-sm">
                    <span className="font-bold text-gray-800">{t(item.name)}</span>
                    <span className="text-mocha-700 font-bold shrink-0 ml-2">{item.count}x</span>
                  </div>
                  
                  {/* Progress bar with exactly original visual style */}
                  <div className="w-full h-2.5 bg-mocha-100 rounded-full overflow-hidden">
                    <motion.div
                      key={`${dateRange}-top-${idx}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${(item.count / maxItemCount) * 100}%` }}
                      transition={{ duration: 0.9, delay: idx * 0.05 }}
                      className="h-full bg-caramel rounded-full"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400">
                    {item.revenue.toFixed(2)} {currencyStr} {language === 'ar' ? 'مبيعات' : 'revenue'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Breakdown Panels ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 tablet:grid-cols-3 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
        
        {/* Order Mode Breakdown (Dine-in vs Takeaway) */}
        <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-150">
          <div className="mb-6">
            <h2 className="text-base md:text-lg font-extrabold text-gray-900">{t('Sales by Order Mode')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('Dine-in vs Takeaway orders in the selected period')}
            </p>
          </div>

          {processedData.totalCount === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <p className="text-xs">{t('No orders')}</p>
            </div>
          ) : (
            <div className="space-y-6 py-2">
              {/* Takeaway Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-gray-800">{t('Takeaway')}</span>
                  </div>
                  <span className="font-bold text-mocha-700 tabular-nums">
                    {processedData.takeawayCount} {t('orders')} ({Math.round((processedData.takeawayCount / processedData.totalCount) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-mocha-50 rounded-full overflow-hidden border border-mocha-100/50">
                  <motion.div
                    key={`takeaway-`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(processedData.takeawayCount / processedData.totalCount) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-mocha-650 rounded-full"
                  />
                </div>
              </div>

              {/* Dine-in Progress */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-gray-800">{t('Dine-in')}</span>
                  </div>
                  <span className="font-bold text-caramel-600 tabular-nums">
                    {processedData.dineInCount} {t('orders')} ({Math.round((processedData.dineInCount / processedData.totalCount) * 100)}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-caramel-50/50 rounded-full overflow-hidden border border-caramel-100/30">
                  <motion.div
                    key={`dinein-`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(processedData.dineInCount / processedData.totalCount) * 100}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full bg-caramel rounded-full"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Invoice Payment Status & Payment Methods */}
        <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-150">
          <div className="mb-4">
            <h2 className="text-base md:text-lg font-extrabold text-gray-900">{t('Invoice Payment Status')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('Paid vs Open invoices breakdown')}
            </p>
          </div>

          {processedData.totalCount === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <p className="text-xs">{t('No orders')}</p>
            </div>
          ) : (
            <div className="space-y-5">
              
              {/* Paid Invoices */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs md:text-sm font-bold text-gray-700">
                  <span className="flex items-center gap-1.5">{t('Paid Invoices')}</span>
                  <span>{processedData.paidCount} ({Math.round((processedData.paidCount / processedData.totalCount) * 100)}%)</span>
                </div>
                <div className="w-full h-2.5 bg-green-50 rounded-full overflow-hidden border border-green-100/50">
                  <motion.div
                    key={`paid-inv-`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(processedData.paidCount / processedData.totalCount) * 100}%` }}
                    className="h-full bg-green-600 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-gray-400 font-bold">
                  {t('Total Paid')}: {processedData.paidAmount.toFixed(2)} {currencyStr}
                </p>
              </div>

              {/* Open/Unpaid Invoices */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs md:text-sm font-bold text-gray-700">
                  <span className="flex items-center gap-1.5">{t('Open Invoices')}</span>
                  <span>{processedData.unpaidCount} ({Math.round((processedData.unpaidCount / processedData.totalCount) * 100)}%)</span>
                </div>
                <div className="w-full h-2.5 bg-amber-50 rounded-full overflow-hidden border border-amber-100/30">
                  <motion.div
                    key={`open-inv-`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(processedData.unpaidCount / processedData.totalCount) * 100}%` }}
                    className="h-full bg-amber-500 rounded-full"
                  />
                </div>
                <p className="text-[10px] text-gray-400 font-bold">
                  {t('Total Open')}: {processedData.unpaidAmount.toFixed(2)} {currencyStr}
                </p>
              </div>

              <div className="border-t border-gray-155 my-3 pt-3" />

              {/* Payment Methods */}
              <div className="space-y-3">
                <h3 className="text-xs md:text-sm font-bold text-gray-800">{t('Payment Methods')}</h3>
                
                {/* Cash */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-gray-600">
                    <span className="flex items-center gap-1.5">{t('Cash')}</span>
                    <span>{processedData.cashPercentage}%</span>
                  </div>
                  <div className="w-full h-2 bg-emerald-50 rounded-full overflow-hidden border border-emerald-100">
                    <motion.div
                      key={`cash-`}
                      initial={{ width: 0 }}
                      animate={{ width: `${processedData.cashPercentage}%` }}
                      className="h-full bg-emerald-600 rounded-full"
                    />
                  </div>
                  <p className="text-[9px] text-gray-400 font-bold">
                    {t('Total Cash')}: {processedData.cashAmount.toFixed(2)} {currencyStr}
                  </p>
                </div>

                {/* Card */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-gray-600">
                    <span className="flex items-center gap-1.5">{t('Card')}</span>
                    <span>{processedData.cardPercentage}%</span>
                  </div>
                  <div className="w-full h-2 bg-blue-50 rounded-full overflow-hidden border border-blue-100">
                    <motion.div
                      key={`card-`}
                      initial={{ width: 0 }}
                      animate={{ width: `${processedData.cardPercentage}%` }}
                      className="h-full bg-blue-600 rounded-full"
                    />
                  </div>
                  <p className="text-[9px] text-gray-400 font-bold">
                    {t('Total Card')}: {processedData.cardAmount.toFixed(2)} {currencyStr}
                  </p>
                </div>

              </div>

            </div>
          )}
        </div>

        {/* Recent Transactions Feed */}
        <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-150 flex flex-col justify-between">
          <div>
            <h2 className="text-base md:text-lg font-extrabold text-gray-900 mb-1">{t('Recent Transactions')}</h2>
            <p className="text-xs text-gray-400 mb-4">{language === 'ar' ? 'أحدث المعاملات المقبوضة عبر الفروع' : 'Latest completed checkouts.'}</p>
          </div>

          {processedData.recentTransactions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-12 text-gray-400 text-xs">
              <p>{t('No completed orders')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 flex-1">
              {processedData.recentTransactions.map((order, idx) => {
                let summary = "";
                let more = "";
                try {
                  const items = order.items || [];
                  if (Array.isArray(items) && items.length > 0) {
                    summary = items.slice(0, 2).map(i => `${i.quantity}× ${t(i.name)}`).join(', ');
                    if (items.length > 2) {
                      more = ` +${items.length - 2}`;
                    }
                  }
                } catch {}

                const elapsed = Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000);
                const timeStr = elapsed < 1 ? t('just now') : elapsed < 60 ? `${elapsed}${t('m ago')}` : `${Math.round(elapsed / 60)}${t('h ago')}`;

                const isPaid = order.paymentStatus === 'Paid';
                const isRefunded = order.paymentStatus === 'Refunded';

                return (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex items-center justify-between py-3 gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`p-2 rounded-xl shrink-0 ${isRefunded ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
                        {isRefunded ? <Undo2 size={16} /> : <CheckCircle2 size={16} />}
                      </div>
                      <div className="min-w-0 text-left">
                        <p className="text-xs md:text-sm font-extrabold text-gray-900 truncate">
                          #{formatOrderNumber(order)}
                          {isRefunded && (
                            <span className="text-[10px] text-amber-700 font-bold bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                              {language === 'ar' ? 'مسترجعة' : 'Refunded'}
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">
                          {order.tableId === 'Takeaway' ? t('Takeaway') : `${t('Table')} ${order.tableId}`}
                          {order.customerName ? ` · ${order.customerName}` : order.customerPhone ? ` · ${order.customerPhone}` : ''}
                        </p>
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">{summary}{more}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-xs md:text-sm font-extrabold text-gray-900">
                          {getOrderGrandTotal(order, taxRate).toFixed(2)} {currencyStr}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{timeStr}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => printCustomerReceipt(order, language === 'ar' ? 'ar' : 'en')}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-mocha-700 hover:bg-mocha-50 transition-colors"
                          title={language === 'ar' ? 'طباعة الفاتورة' : 'Print Receipt'}
                        >
                          <Printer size={15} />
                        </button>
                        {user?.role === 'manager' && isPaid && (
                          <button
                            onClick={() => { setRefundTarget(order); setRefundReason(''); }}
                            className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-100 hover:text-amber-800 transition-colors"
                            title={language === 'ar' ? 'إرجاع الفاتورة' : 'Refund Invoice'}
                          >
                            <Undo2 size={15} />
                          </button>
                        )}
                        {user?.role === 'manager' && (
                          <button
                            onClick={() => setDeleteTargetId(order.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title={language === 'ar' ? 'حذف الفاتورة' : 'Delete Invoice'}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* ── Outstanding Receivables Report (المبالغ المستحقة) ──────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-150 overflow-hidden">
        <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base md:text-lg font-extrabold text-gray-900 flex items-center gap-2">
              <Wallet className="text-orange-500" size={20} />
              {language === 'ar' ? 'المبالغ المستحقة (على الحساب)' : 'Outstanding Receivables'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {language === 'ar'
                ? 'ديون العملاء والشركات غير المسددة من فواتير على الحساب'
                : 'Unpaid customer & company balances from on-account invoices'}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[10px] text-gray-400 font-bold">
              {language === 'ar' ? 'إجمالي المستحقات' : 'Total Receivable'}
            </p>
            <p className="text-xl md:text-2xl font-black text-orange-600">
              {receivablesData.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyStr}
            </p>
          </div>
        </div>

        {receivablesData.grandTotal === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="mx-auto text-green-500 mb-2" size={36} />
            <p className="text-sm text-gray-400">
              {language === 'ar' ? 'لا توجد مبالغ مستحقة 🎉' : 'No outstanding balances 🎉'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {/* Companies section */}
            {receivablesData.companiesOwed.length > 0 && (
              <>
                <div className="px-4 md:px-6 py-2.5 bg-purple-50/40">
                  <p className="text-xs font-extrabold text-purple-700 flex items-center gap-1.5">
                    <Building2 size={13} />
                    {language === 'ar' ? 'الشركات' : 'Companies'} ({receivablesData.companiesOwed.length})
                  </p>
                </div>
                {receivablesData.companiesOwed.map(co => (
                  <div key={co.id} className="px-4 md:px-6 py-3 flex items-center justify-between gap-3 hover:bg-purple-50/20 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-xl bg-purple-100 text-purple-700 shrink-0">
                        <Building2 size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-gray-900 truncate">{co.name}</p>
                        <p className="text-[11px] text-gray-400">
                          {co.invoiceCount} {language === 'ar' ? 'فاتورة' : 'invoices'}
                          {co.memberCount > 0 && ` · ${co.memberCount} ${language === 'ar' ? 'عضو' : 'members'}`}
                          {co.phone && ` · ${co.phone}`}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-black text-red-600 shrink-0">
                      {co.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyStr}
                    </p>
                  </div>
                ))}
              </>
            )}

            {/* Customers section */}
            {receivablesData.customersOwed.length > 0 && (
              <>
                <div className="px-4 md:px-6 py-2.5 bg-mocha-50/40">
                  <p className="text-xs font-extrabold text-mocha-700 flex items-center gap-1.5">
                    <Users size={13} />
                    {language === 'ar' ? 'العملاء' : 'Customers'} ({receivablesData.customersOwed.length})
                  </p>
                </div>
                {receivablesData.customersOwed.slice(0, 20).map(c => (
                  <div key={c.id} className="px-4 md:px-6 py-3 flex items-center justify-between gap-3 hover:bg-mocha-50/20 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-xl bg-mocha-100 text-mocha-700 shrink-0">
                        <UserCheck size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-gray-900 truncate">{c.name}</p>
                        <p className="text-[11px] text-gray-400">
                          {c.invoiceCount} {language === 'ar' ? 'فاتورة' : 'invoices'}{c.phone && ` · ${c.phone}`}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-black text-red-600 shrink-0">
                      {c.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyStr}
                    </p>
                  </div>
                ))}
                {receivablesData.customersOwed.length > 20 && (
                  <div className="px-4 md:px-6 py-2 text-center text-[11px] text-gray-400">
                    +{receivablesData.customersOwed.length - 20} {language === 'ar' ? 'عميل آخر' : 'more customers'}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>



      </>)}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ══ MENU TAB ═══════════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'menu' && (
        <Suspense fallback={<LoadingScreen />}>
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-gray-150 shadow-sm">
            <MenuPage />
          </div>
        </Suspense>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ══ INVENTORY TAB ══════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'inventory' && (
        <Suspense fallback={<LoadingScreen />}>
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-gray-150 shadow-sm">
            <InventoryPage />
          </div>
        </Suspense>
      )}

      {activeTab === 'customers' && (
        <Suspense fallback={<LoadingScreen />}>
          <CustomersPage managerMode />
        </Suspense>
      )}



      {/* ── SETTINGS TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <Suspense fallback={<LoadingScreen />}>
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-gray-150 shadow-sm">
            <SettingsPage />
          </div>
        </Suspense>
      )}


      {/* ── Refund Reason Modal ──────────────────────────────────────────────── */}
      {refundTarget && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => !refundBusy && setRefundTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-amber-50/60">
                <h3 className="font-extrabold text-gray-900 text-base flex items-center gap-2">
                  <Undo2 size={18} className="text-amber-600" />
                  {language === 'ar' ? 'إرجاع الفاتورة' : 'Refund Invoice'}
                </h3>
                <button
                  type="button"
                  onClick={() => !refundBusy && setRefundTarget(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-200/60 transition-colors disabled:opacity-50"
                  disabled={refundBusy}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-xs text-gray-500">{language === 'ar' ? 'فاتورة رقم' : 'Invoice'}</p>
                  <p className="font-black text-gray-900 text-lg">#{formatOrderNumber(refundTarget)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(refundTarget.createdAt).toLocaleString()}</p>
                  <p className="text-sm font-bold text-emerald-600 mt-1">{getOrderGrandTotal(refundTarget, taxRate).toFixed(2)} {currencyStr}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {language === 'ar' ? 'سبب الاسترجاع (اختياري)' : 'Refund reason (optional)'}
                  </label>
                  <textarea
                    rows={2}
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    disabled={refundBusy}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all resize-none bg-white text-gray-900 placeholder-gray-400 font-medium"
                    placeholder={language === 'ar' ? 'مثال: إرجاع بناءً على طلب العميل...' : 'e.g. Customer requested refund...'}
                  />
                </div>

                <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 text-xs text-amber-800 leading-relaxed">
                  {language === 'ar'
                    ? 'تحذير: سيتم تحويل حالة الفاتورة إلى "مسترجعة" وملغاة، وسيتم إرجاع كميات المكونات للمخزون تلقائياً.'
                    : 'Warning: the invoice will be marked as Refunded & Cancelled, and ingredient quantities will be restored to inventory automatically.'}
                </div>
              </div>

              <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
                <button
                  type="button"
                  onClick={() => !refundBusy && setRefundTarget(null)}
                  disabled={refundBusy}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  disabled={refundBusy}
                  onClick={async () => {
                    setRefundBusy(true);
                    try {
                      await refundOrder(refundTarget.id, refundReason.trim() || undefined);
                      setRefundTarget(null);
                      toast.success(language === 'ar' ? 'تم إرجاع الفاتورة بنجاح' : 'Invoice refunded successfully');
                    } catch (err) {
                      console.error('Refund failed:', err);
                      toast.error(language === 'ar'
                        ? 'فشل الإرجاع: ' + (err instanceof Error ? err.message : String(err))
                        : 'Refund failed: ' + (err instanceof Error ? err.message : String(err)));
                    } finally {
                      setRefundBusy(false);
                    }
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-700 shadow-lg shadow-amber-500/20 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {refundBusy ? (
                    <span>{language === 'ar' ? 'جاري الإرجاع...' : 'Refunding...'}</span>
                  ) : (
                    <>
                      <Undo2 size={16} />
                      <span>{language === 'ar' ? 'تأكيد الإرجاع' : 'Confirm Refund'}</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* ── Delete Confirmation Modal ───────────────────────────────────────── */}
      {deleteTargetId && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setDeleteTargetId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-rose-50/60">
                <h3 className="font-extrabold text-gray-900 text-base flex items-center gap-2">
                  <Trash2 size={18} className="text-rose-600" />
                  {language === 'ar' ? 'حذف الفاتورة' : 'Delete Invoice'}
                </h3>
                <button
                  type="button"
                  onClick={() => setDeleteTargetId(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-200/60 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-600 leading-relaxed">
                  {language === 'ar'
                    ? 'هل أنت متأكد من حذف هذه الفاتورة نهائياً؟ لا يمكن التراجع عن هذا الإجراء.'
                    : 'Are you sure you want to permanently delete this invoice? This action cannot be undone.'}
                </p>
              </div>
              <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
                <button
                  type="button"
                  onClick={() => setDeleteTargetId(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-bold hover:bg-gray-100 transition-colors"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const id = deleteTargetId;
                    setDeleteTargetId(null);
                    try {
                      await deleteOrder(id);
                      toast.success(language === 'ar' ? 'تم حذف الفاتورة' : 'Invoice deleted');
                    } catch (err) {
                      console.error('Delete failed:', err);
                      toast.error(language === 'ar' ? 'فشل الحذف' : 'Delete failed');
                    }
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 text-white font-bold hover:bg-rose-700 shadow-lg shadow-rose-500/20 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={16} />
                  <span>{language === 'ar' ? 'حذف نهائي' : 'Delete'}</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}


    </div>
  );
}
