import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, DollarSign, ShoppingBag,
  Coffee, Calendar, Download,
  CheckCircle2, Clock, XCircle, AlertCircle, Utensils,
  UserCheck, Award, Coins, Building2, ChevronDown, RefreshCw,
  Signal, SignalHigh, WifiOff, Package, AlertTriangle, BarChart3, Languages, Users, Search, Settings, Send, Scale
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { getTaxRate } from '../utils/settingsConfig';
import { useMenu } from '../hooks/useMenu';
import SettingsPage from './Settings';

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
  paymentStatus?: string; // Optional, Paid/Unpaid
}

interface ChartPoint {
  label: string;
  value: number;
  orders: number;
}

interface TopItem {
  name: string;
  count: number;
  revenue: number;
}

// ─── Branch Config ────────────────────────────────────────────────────────────
const BRANCHES = [
  { id: 'all', labelAr: 'الفرع الرئيسي', labelEn: 'Main Branch' }
];

// ─── Date Period Config ────────────────────────────────────────────────────────
type AnalyticsPeriod = 'Today' | 'This Week' | 'This Month' | 'This Year';

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

// ─── Dynamic Mock Data Generator (Fallback) ───────────────────────────────────
const generateMockOrders = (): D1OrderDoc[] => {
  const now = new Date();
  
  // Custom items list to randomly pick from
  const itemsList = [
    [
      { name: "Spanish Latte", quantity: 2, price: 6.00 },
      { name: "Cortado", quantity: 1, price: 4.50 }
    ],
    [
      { name: "Iced Caramel Macchiato", quantity: 3, price: 6.50 },
      { name: "Americano", quantity: 1, price: 4.00 }
    ],
    [
      { name: "Cappuccino", quantity: 2, price: 5.00 },
      { name: "Warm Chocolate Brownie", quantity: 1, price: 5.50 }
    ],
    [
      { name: "Mocha Frappe", quantity: 1, price: 7.00 },
      { name: "Espresso Shot", quantity: 4, price: 4.00 }
    ],
    [
      { name: "Turkish Coffee", quantity: 2, price: 3.50 }
    ],
    [
      { name: "Spanish Latte", quantity: 1, price: 6.00 },
      { name: "Oreo Milkshake", quantity: 2, price: 6.50 }
    ],
    [
      { name: "Prime Beef Cheeseburger", quantity: 1, price: 12.00 },
      { name: "Cheese Fries", quantity: 1, price: 5.00 },
      { name: "Mint Lemonade", quantity: 1, price: 4.50 }
    ],
    [
      { name: "Classic Club Sandwich", quantity: 1, price: 10.00 },
      { name: "Peach Iced Tea", quantity: 2, price: 5.00 }
    ]
  ];

  const calcTotal = (items: OrderItem[]) => items.reduce((sum, item) => sum + item.quantity * item.price, 0);

  // Generate 20 realistic orders distributed nicely over times & branches
  const rawMocks = [
    // Today
    { branch_id: 'branch_1', payment_method: 'Cash', minutesAgo: 25, itemsIdx: 0, paymentStatus: 'Paid' },
    { branch_id: 'branch_1', payment_method: 'Card', minutesAgo: 60, itemsIdx: 1, paymentStatus: 'Paid' },
    { branch_id: 'branch_2', payment_method: 'Cash', minutesAgo: 95, itemsIdx: 2, paymentStatus: 'Paid' },
    { branch_id: 'branch_3', payment_method: 'Card', minutesAgo: 150, itemsIdx: 3, paymentStatus: 'Paid' },
    { branch_id: 'branch_2', payment_method: 'Cash', minutesAgo: 190, itemsIdx: 4, paymentStatus: 'Unpaid' }, // Unpaid invoice demo
    { branch_id: 'branch_3', payment_method: 'Cash', minutesAgo: 280, itemsIdx: 5, paymentStatus: 'Paid' },
    
    // Yesterday
    { branch_id: 'branch_1', payment_method: 'Card', daysAgo: 1, itemsIdx: 6, paymentStatus: 'Paid' },
    { branch_id: 'branch_2', payment_method: 'Cash', daysAgo: 1, itemsIdx: 7, paymentStatus: 'Paid' },
    { branch_id: 'branch_3', payment_method: 'Card', daysAgo: 1, itemsIdx: 0, paymentStatus: 'Paid' },
    { branch_id: 'branch_1', payment_method: 'Cash', daysAgo: 1, itemsIdx: 1, paymentStatus: 'Unpaid' }, // Unpaid invoice demo
    
    // This Week
    { branch_id: 'branch_1', payment_method: 'Cash', daysAgo: 2, itemsIdx: 2, paymentStatus: 'Paid' },
    { branch_id: 'branch_2', payment_method: 'Card', daysAgo: 3, itemsIdx: 3, paymentStatus: 'Paid' },
    { branch_id: 'branch_3', payment_method: 'Cash', daysAgo: 4, itemsIdx: 4, paymentStatus: 'Paid' },
    { branch_id: 'branch_1', payment_method: 'Card', daysAgo: 5, itemsIdx: 5, paymentStatus: 'Paid' },
    
    // This Month
    { branch_id: 'branch_2', payment_method: 'Cash', daysAgo: 9, itemsIdx: 6, paymentStatus: 'Paid' },
    { branch_id: 'branch_3', payment_method: 'Card', daysAgo: 14, itemsIdx: 7, paymentStatus: 'Paid' },
    { branch_id: 'branch_1', payment_method: 'Cash', daysAgo: 19, itemsIdx: 1, paymentStatus: 'Paid' },
    
    // This Year
    { branch_id: 'branch_2', payment_method: 'Card', daysAgo: 40, itemsIdx: 0, paymentStatus: 'Paid' },
    { branch_id: 'branch_3', payment_method: 'Cash', daysAgo: 80, itemsIdx: 2, paymentStatus: 'Paid' },
    { branch_id: 'branch_1', payment_method: 'Card', daysAgo: 110, itemsIdx: 3, paymentStatus: 'Paid' },
    { branch_id: 'branch_2', payment_method: 'Cash', daysAgo: 160, itemsIdx: 4, paymentStatus: 'Paid' }
  ];

  return rawMocks.map((m, idx) => {
    const orderDate = new Date();
    if (m.minutesAgo !== undefined) {
      orderDate.setMinutes(orderDate.getMinutes() - m.minutesAgo);
    } else if (m.daysAgo !== undefined) {
      orderDate.setDate(orderDate.getDate() - m.daysAgo);
      orderDate.setHours(9 + (idx % 12), (idx * 7) % 60, 0, 0);
    }
    const items = itemsList[m.itemsIdx % itemsList.length];
    const total_amount = calcTotal(items);

    return {
      $id: `mock-doc-${idx + 1}`,
      $createdAt: orderDate.toISOString(),
      branch_id: m.branch_id,
      total_amount,
      payment_method: m.payment_method,
      items: JSON.stringify(items),
      tableId: m.itemsIdx % 3 === 0 ? 'Takeaway' : String((idx % 6) + 1),
      paymentStatus: m.paymentStatus
    };
  });
};

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
      className="bg-white/95 backdrop-blur-sm p-4 md:p-6 rounded-2xl shadow-sm hover:shadow-md border border-gray-200/50 relative overflow-hidden group transition-all"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${colors.gradient} opacity-0 group-hover:opacity-[0.03] transition-opacity duration-300`} />
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-4 gap-1">
          <motion.div 
            whileHover={{ rotate: 15, scale: 1.05 }}
            transition={{ duration: 0.3 }}
            className={`p-3 rounded-xl ${colors.iconBg} ${colors.iconText} shadow-sm border border-current/10 shrink-0`}
          >
            <Icon className="w-5 h-5 md:w-6 md:h-6" strokeWidth={2} />
          </motion.div>
          <span className="text-[10px] md:text-xs font-sans font-semibold text-green-600 bg-green-50 px-2.5 py-1 rounded-lg border border-green-100/50 shadow-sm text-right leading-tight max-w-[62%]">
            {trend}
          </span>
        </div>
        <h3 className="text-gray-500 text-xs md:text-sm font-semibold mb-1 uppercase tracking-wide">{label}</h3>
        <p className="text-2xl md:text-3xl font-bold text-gray-800">{value}</p>
      </div>
      <div className={`absolute -right-4 -bottom-4 w-24 h-24 bg-gradient-to-br ${colors.gradient} rounded-full opacity-5 group-hover:opacity-10 transition-opacity duration-300 blur-2xl`} />
    </motion.div>
  );
}

const INITIAL_STOCKS: Record<string, number> = {
  'inv-beans': 50.0,
  'inv-milk': 100.0,
  'inv-sugar': 50.0,
  'inv-caramel': 20.0,
  'inv-vanilla': 20.0,
  'inv-cups': 1000.0,
  'inv-beef': 200.0,
  'inv-buns': 200.0,
  'inv-cheese': 300.0,
  'inv-fries': 100.0,
  'inv-chicken': 80.0,
  'inv-bread': 500.0,
  'inv-lettuce': 30.0,
  'inv-tomato': 40.0,
  'inv-mayo': 15.0,
  'inv-croissant': 150.0,
  'inv-turkey': 200.0,
  'inv-mozzarella': 25.0,
  'inv-flour': 50.0,
  'inv-chocolate': 30.0,
  'inv-tea': 15.0,
  'inv-peach': 10.0,
  'inv-mint': 5.0,
  'inv-lemon': 500.0,
  'inv-soda': 120.0,
  'inv-passion': 10.0,
  'inv-oreo': 800.0,
  'inv-strawberry': 20.0,
  'inv-mango': 25.0,
  'inv-icecream': 40.0,
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ManagerDashboard() {
  const { t, isRtl, language, toggleLanguage } = useLanguage();
  const { items: localMenuItems } = useMenu();

  // Filters State
  const [selectedBranch, setSelectedBranch] = useState<string>(() => {
    return localStorage.getItem('manager_selected_branch') || 'all';
  });
  const [dateRange, setDateRange] = useState<AnalyticsPeriod>(() => {
    const saved = localStorage.getItem('manager_date_range');
    if (saved === 'Today' || saved === 'This Week' || saved === 'This Month' || saved === 'This Year') {
      return saved as AnalyticsPeriod;
    }
    return 'This Week';
  });
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'analytics' | 'inventory' | 'settings'>('analytics');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');

  // Data Fetching State
  const [orders, setOrders] = useState<D1OrderDoc[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [dbInventory, setDbInventory] = useState<any[]>([]);
  const [dbRecipes, setDbRecipes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  const taxRate = getTaxRate();

  // ── Fetch orders and customers from Database ──
  // Uses Electron IPC when running as desktop app, direct REST fetch when in browser

  const fetchOrders = async () => {
    setLoading(true);
    setErrorInfo(null);
    try {
      let ordersList: any[];
      let customersList: any[];
      let invList: any[] = [];
      let recList: any[] = [];

      if (window.electronAPI?.getManagerOrders) {
        // Desktop Electron app — fetch via Node main process (bypasses CORS)
        ordersList = await window.electronAPI.getManagerOrders();
        customersList = await window.electronAPI.getManagerCustomers();
        if (window.electronAPI?.getInventory) {
          invList = await window.electronAPI.getInventory();
        }
        if (window.electronAPI?.getMenuRecipes) {
          recList = await window.electronAPI.getMenuRecipes();
        }
      } else {
        // Web Mode — read from Client B's isolated database (IndexedDB / Client B API)
        const { orderRepository, customerRepository } = await import('../repositories');
        const localOrders = await orderRepository.getAll();
        const localCustomers = await customerRepository.getAll();
        const { inventoryService } = await import('../services/inventoryService');
        const localInventory = await inventoryService.getAll();

        ordersList = localOrders.map(o => ({
          $id: o.id,
          $createdAt: o.createdAt,
          branch_id: o.branchId || 'main_branch',
          total_amount: o.totalAmount,
          payment_method: o.paymentMethod || 'Cash',
          items: typeof o.items === 'string' ? o.items : JSON.stringify(o.items),
          tableId: o.tableId,
          paymentStatus: o.paymentStatus
        }));

        customersList = localCustomers.map(c => ({
          $id: c.id,
          name: c.name,
          phone: c.phone,
          points: c.points,
          createdAt: c.createdAt,
          branchId: c.branchId || 'main_branch'
        }));

        invList = localInventory.map(i => ({
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
    } catch (err: any) {
      console.warn("[ManagerDashboard] Fetch error:", err);
      setErrorInfo(err.message || "Network Timeout");
      setOrders([]);
      setCustomers([]);
      setDbInventory([]);
      setDbRecipes([]);
      setIsDemoMode(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
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

    // 2. Resolve selected branch label
    const branchNames: Record<string, string> = {
      'branch_1': language === 'ar' ? 'فرع المعادي (فرع 1)' : 'Maadi Branch (1)',
      'branch_2': language === 'ar' ? 'فرع مصر الجديدة (فرع 2)' : 'Heliopolis Branch (2)',
      'branch_3': language === 'ar' ? 'فرع الزمالك (فرع 3)' : 'Zamalek Branch (3)',
      'default': language === 'ar' ? 'الفرع الرئيسي' : 'Main Branch'
    };

    const activeBranchName = selectedBranch === 'all' 
      ? (language === 'ar' ? 'كافة الفروع' : 'All Branches')
      : (branchNames[selectedBranch] || selectedBranch);

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

      // Filter orders matching current dateRange and branch
      const filteredOrders = orders.filter(order => {
        const matchesBranch = selectedBranch === 'all' || order.branch_id === selectedBranch;
        const matchesPeriod = inPeriod(order.$createdAt, dateRange);
        return matchesBranch && matchesPeriod;
      });

      if (filteredOrders.length === 0) {
        alert(language === 'ar' ? 'لا توجد مبيعات مسجلة في هذه الفترة لإرسالها!' : 'No orders recorded in this period to send!');
        return;
      }

      // Group by branch for consolidated report if 'all' is selected
      const branchStats: Record<string, { totalOrders: number; totalRevenue: number; totalUnpaid: number; cash: number; card: number }> = {};
      if (selectedBranch === 'all') {
        filteredOrders.forEach(order => {
          const bId = order.branch_id || 'default';
          if (!branchStats[bId]) {
            branchStats[bId] = { totalOrders: 0, totalRevenue: 0, totalUnpaid: 0, cash: 0, card: 0 };
          }
          
          branchStats[bId].totalOrders += 1;
          const amount = Number(order.total_amount) || 0;
          
          if (order.paymentStatus === 'Unpaid') {
            branchStats[bId].totalUnpaid += amount;
          } else {
            branchStats[bId].totalRevenue += amount;
            if (order.payment_method === 'Card') {
              branchStats[bId].card += amount;
            } else {
              branchStats[bId].cash += amount;
            }
          }
        });
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

      if (selectedBranch === 'all' && Object.keys(branchStats).length > 0) {
        message += `🏢 <b>تفاصيل الفروع المفرّقة:</b>\n`;
        Object.entries(branchStats).forEach(([bId, s]) => {
          const bName = branchNames[bId] || bId;
          message += `📍 <b>${bName}:</b>\n`;
          message += `• عدد الطلبات: <b>${s.totalOrders}</b>\n`;
          message += `• مبيعات محصلة: <b>${s.totalRevenue.toFixed(2)}</b> ج.م\n`;
          message += `• مبيعات آجلة: <b>${s.totalUnpaid.toFixed(2)}</b> ج.م\n`;
          message += `• كاش: <b>${s.cash.toFixed(2)}</b> | شبكة: <b>${s.card.toFixed(2)}</b>\n\n`;
        });
      }

      if (processedData.topItems && processedData.topItems.length > 0) {
        message += `☕ <b>أكثر الأصناف مبيعاً في هذه الفترة:</b>\n`;
        processedData.topItems.forEach(item => {
          message += `• ${item.name}: عدد <b>${item.count}</b>\n`;
        });
        message += `\n`;
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

      if (selectedBranch === 'all') {
        message += `🏢 <b>الكميات المتبقية مقارنة بين الفروع:</b>\n`;
        inventoryData.forEach(inv => {
          const name = language === 'ar' ? inv.nameAr : inv.nameEn;
          const unit = language === 'ar' ? inv.unitAr : inv.unit;
          
          message += `• <b>${name}:</b>\n`;
          ['branch_1', 'branch_2', 'branch_3'].forEach(bId => {
            const bd = inv.branches[bId];
            const bName = branchNames[bId] || bId;
            if (bd) {
              const warning = bd.isLow ? ' ⚠️ (نقص)' : '';
              message += `  - ${bName}: <code>${bd.remaining}</code> ${unit}${warning}\n`;
            }
          });
        });
        message += `\n`;
      } else {
        message += `📋 <b>تفاصيل كميات المواد الخام بالفرع:</b>\n`;
        inventoryData.forEach(inv => {
          const bd = inv.branches[selectedBranch];
          if (!bd) return;
          const name = language === 'ar' ? inv.nameAr : inv.nameEn;
          const unit = language === 'ar' ? inv.unitAr : inv.unit;
          const warning = bd.isLow ? ' ⚠️ (نقص)' : '';
          message += `• ${name}: <b>${bd.remaining}</b> ${unit} (${bd.percentage}%)${warning}\n`;
        });
        message += `\n`;
      }

      message += `✅ تم تصدير تقرير المخزون من لوحة الإشراف المركزية`;

    } else if (activeTab === 'customers') {
      // 👥 REPORT 3: CUSTOMERS REPORT
      const totalPoints = filteredCustomers.reduce((sum, c) => sum + (Number(c.points) || 0), 0);

      message = `👥 <b>تقرير العملاء ونقاط الولاء: ${activeBranchName}</b>\n`;
      message += `⏱️ التاريخ: <code>${todayStr}</code>\n\n`;

      message += `📊 <b>إحصائيات ولاء العملاء:</b>\n`;
      message += `• إجمالي العملاء المسجلين: <b>${filteredCustomers.length}</b> عضو\n`;
      message += `• إجمالي نقاط الولاء الموزعة: <b>${totalPoints.toLocaleString()}</b> نقطة\n`;
      message += `• قيمة استرداد النقاط الكلية: <b>${totalPoints.toLocaleString()}</b> ج.م\n\n`;

      if (filteredCustomers.length > 0) {
        message += `📋 <b>قائمة العملاء المسجلين (أعلى 30 نقاط):</b>\n`;
        const displayLimit = 30;
        const sortedCustomers = [...filteredCustomers].sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0));
        
        sortedCustomers.slice(0, displayLimit).forEach(c => {
          const branchLabel = BRANCHES.find(b => b.id === c.branchId);
          const bLabel = language === 'ar' ? branchLabel?.labelAr : branchLabel?.labelEn;
          message += `• ${c.name || 'عميل'} (<code>${c.phone}</code>): <b>${c.points || 0}</b> نقطة [${bLabel || 'default'}]\n`;
        });

        if (filteredCustomers.length > displayLimit) {
          message += `• ... و <b>${filteredCustomers.length - displayLimit}</b> عميل آخرين\n`;
        }
        message += `\n`;
      } else {
        message += `⚠️ لا يوجد عملاء مسجلين حالياً في هذا النطاق.\n\n`;
      }

      message += `✅ تم تصدير تقرير العملاء من لوحة الإشراف المركزية`;
    }

    // 6. Send message to Telegram
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'
        })
      });
      const data = await res.json();
      if (data.ok) {
        alert(language === 'ar' ? 'تم إرسال تقرير الفترة المحددة للتليجرام بنجاح!' : 'Report for the selected period sent successfully to Telegram!');
      } else {
        throw new Error(data.description);
      }
    } catch(err: any) {
      alert(`${language === 'ar' ? 'فشل الإرسال: ' : 'Send failed: '}${err.message || 'خطأ غير معروف'}`);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClose = () => setIsBranchDropdownOpen(false);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, []);

  // ── Scoped Data Processing ──────────────────────────────────────────────────
  const processedData = useMemo(() => {
    // 1. Branch Filtering
    const branchFiltered = orders.filter(order => {
      if (selectedBranch === 'all') return true;
      return order.branch_id === selectedBranch;
    });

    // 2. Date Filtering
    const periodFiltered = branchFiltered.filter(order => inPeriod(order.$createdAt, dateRange));

    // 3. Paid vs Unpaid split
    const paidOrders = periodFiltered.filter(order => order.paymentStatus !== 'Unpaid');
    const unpaidOrders = periodFiltered.filter(order => order.paymentStatus === 'Unpaid');

    // 4. Calculate Stats
    // Sum subtotal * (1 + taxRate)
    const realRevenue = paidOrders.reduce((sum, order) => sum + Number(order.total_amount) * (1 + taxRate), 0);
    const totalOrdersCount = periodFiltered.length;
    const paidOrdersCount = paidOrders.length;
    const avgOrderValue = paidOrdersCount > 0 ? realRevenue / paidOrdersCount : 0;

    // 5. Calculate Chart Trend
    const cfg = CHART_CONFIG[dateRange];
    const chartLabels = language === 'ar' ? cfg.labelsAr : cfg.labelsEn;
    const chartRevenue = new Array(chartLabels.length).fill(0);
    const chartOrderCounts = new Array(chartLabels.length).fill(0);

    paidOrders.forEach(order => {
      const bucketIdx = cfg.getBucket(new Date(order.$createdAt));
      if (bucketIdx >= 0 && bucketIdx < chartLabels.length) {
        chartRevenue[bucketIdx] += Number(order.total_amount) * (1 + taxRate);
        chartOrderCounts[bucketIdx] += 1;
      }
    });

    const chartData: ChartPoint[] = chartLabels.map((label, idx) => ({
      label,
      value: chartRevenue[idx],
      orders: chartOrderCounts[idx]
    }));

    // 6. Calculate Top Selling Products
    const topItemMap: Record<string, TopItem> = {};
    paidOrders.forEach(order => {
      try {
        const items: OrderItem[] = JSON.parse(order.items);
        if (Array.isArray(items)) {
          items.forEach(item => {
            const name = item.name;
            if (!topItemMap[name]) {
              topItemMap[name] = { name, count: 0, revenue: 0 };
            }
            topItemMap[name].count += item.quantity;
            topItemMap[name].revenue += item.quantity * item.price * (1 + taxRate);
          });
        }
      } catch (e) {
        console.error("Failed to parse order items JSON:", e);
      }
    });

    const topItems = Object.values(topItemMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 7. Order Mode Breakdown (Dine-in vs Takeaway)
    let takeawayCount = 0;
    let dineInCount = 0;
    periodFiltered.forEach(order => {
      // Check tableId inside schema (if defined), otherwise infer from payments or id hashes
      const isTakeaway = order.tableId === 'Takeaway' || (!order.tableId && order.$id.charCodeAt(order.$id.length - 1) % 2 === 0);
      if (isTakeaway) {
        takeawayCount++;
      } else {
        dineInCount++;
      }
    });

    // 8. Invoice Breakdown amounts
    const paidAmount = paidOrders.reduce((sum, order) => sum + Number(order.total_amount) * (1 + taxRate), 0);
    const unpaidAmount = unpaidOrders.reduce((sum, order) => sum + Number(order.total_amount) * (1 + taxRate), 0);

    // 9. Payment Methods Breakdown
    let cashAmount = 0;
    let cardAmount = 0;
    paidOrders.forEach(order => {
      const isCard = order.payment_method?.toLowerCase() === 'card';
      const amount = Number(order.total_amount) * (1 + taxRate);
      if (isCard) {
        cardAmount += amount;
      } else {
        cashAmount += amount;
      }
    });

    const totalPaidAmount = cashAmount + cardAmount;
    const cashPercentage = totalPaidAmount > 0 ? Math.round((cashAmount / totalPaidAmount) * 100) : 0;
    const cardPercentage = totalPaidAmount > 0 ? Math.round((cardAmount / totalPaidAmount) * 100) : 0;

    // 10. Recent Transactions (Paid only, sorted by newest)
    const recentTransactions = [...paidOrders]
      .sort((a, b) => new Date(b.$createdAt).getTime() - new Date(a.$createdAt).getTime())
      .slice(0, 5);

    // 11. Real Loyalty values from Cloud D1 database
    const branchCustomers = customers.filter(c => {
      if (selectedBranch === 'all') return true;
      return c.branchId === selectedBranch;
    });
    const totalPoints = branchCustomers.reduce((sum, c) => sum + (Number(c.points) || 0), 0);
    const activeLoyalty = {
      count: branchCustomers.length,
      points: totalPoints
    };

    return {
      totalRevenue: realRevenue,
      totalOrdersCount,
      avgOrderValue,
      chartData,
      topItems,
      takeawayCount,
      dineInCount,
      totalCount: totalOrdersCount,
      paidCount: paidOrders.length,
      unpaidCount: unpaidOrders.length,
      paidAmount,
      unpaidAmount,
      cashAmount,
      cardAmount,
      cashPercentage,
      cardPercentage,
      recentTransactions,
      loyaltyCount: activeLoyalty.count,
      loyaltyPoints: activeLoyalty.points,
      loyaltyValue: activeLoyalty.points // 1 point = 1 EGP
    };
  }, [orders, selectedBranch, dateRange, language, taxRate]);

  // ── Inventory Data (Starting Stock & Recipes for consumption calc) ──────────
  const INVENTORY_ITEMS = useMemo(() => {
    if (dbInventory && dbInventory.length > 0) {
      return dbInventory.map(item => {
        const startVal = INITIAL_STOCKS[item.id] || item.stock * 1.5 || 100;
        return {
          id: item.id,
          nameAr: item.name,
          nameEn: item.name,
          unit: item.unit,
          unitAr: item.unit,
          costPerUnit: item.costPerUnit,
          startingStock: {
            branch_1: item.branch_id === 'branch_1' ? startVal : 0,
            branch_2: item.branch_id === 'branch_2' ? startVal : 0,
            branch_3: item.branch_id === 'branch_3' ? startVal : 0,
          },
          minStock: item.minStock,
        };
      });
    }
    return [
      { id: 'inv-beans', nameAr: 'حبوب القهوة إسبريسو', nameEn: 'Espresso Coffee Beans', unit: 'kg', unitAr: 'كجم', costPerUnit: 25.00, startingStock: { branch_1: 50.0, branch_2: 50.0, branch_3: 50.0 }, minStock: 5.0 },
      { id: 'inv-milk', nameAr: 'حليب كامل الدسم', nameEn: 'Whole Milk', unit: 'liter', unitAr: 'لتر', costPerUnit: 1.50, startingStock: { branch_1: 100.0, branch_2: 100.0, branch_3: 100.0 }, minStock: 10.0 },
      { id: 'inv-sugar', nameAr: 'سكر أبيض', nameEn: 'White Sugar', unit: 'kg', unitAr: 'كجم', costPerUnit: 1.10, startingStock: { branch_1: 50.0, branch_2: 50.0, branch_3: 50.0 }, minStock: 5.0 },
      { id: 'inv-caramel', nameAr: 'صوص كراميل', nameEn: 'Caramel Syrup', unit: 'liter', unitAr: 'لتر', costPerUnit: 12.00, startingStock: { branch_1: 20.0, branch_2: 20.0, branch_3: 20.0 }, minStock: 2.0 },
      { id: 'inv-vanilla', nameAr: 'سيروب فانيليا', nameEn: 'Vanilla Syrup', unit: 'liter', unitAr: 'لتر', costPerUnit: 12.00, startingStock: { branch_1: 20.0, branch_2: 20.0, branch_3: 20.0 }, minStock: 2.0 },
      { id: 'inv-cups', nameAr: 'أكواب ورقية (12 أونص)', nameEn: 'Paper Cups (12oz)', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.15, startingStock: { branch_1: 1000.0, branch_2: 1000.0, branch_3: 1000.0 }, minStock: 100.0 },
      { id: 'inv-beef', nameAr: 'شريحة لحم بقري بريميوم (150 جم)', nameEn: 'Prime Beef Patty (150g)', unit: 'piece', unitAr: 'قطعة', costPerUnit: 2.50, startingStock: { branch_1: 200.0, branch_2: 200.0, branch_3: 200.0 }, minStock: 20.0 },
      { id: 'inv-buns', nameAr: 'خبز البرجر', nameEn: 'Burger Buns', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.50, startingStock: { branch_1: 200.0, branch_2: 200.0, branch_3: 200.0 }, minStock: 20.0 },
      { id: 'inv-cheese', nameAr: 'شرائح جبن شيدر', nameEn: 'Cheddar Cheese Slices', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.30, startingStock: { branch_1: 300.0, branch_2: 300.0, branch_3: 300.0 }, minStock: 30.0 },
      { id: 'inv-fries', nameAr: 'بطاطس مقلية', nameEn: 'Potato Fries', unit: 'kg', unitAr: 'كجم', costPerUnit: 2.00, startingStock: { branch_1: 100.0, branch_2: 100.0, branch_3: 100.0 }, minStock: 10.0 },
      { id: 'inv-chicken', nameAr: 'صدور دجاج', nameEn: 'Chicken Breast', unit: 'kg', unitAr: 'كجم', costPerUnit: 4.50, startingStock: { branch_1: 80.0, branch_2: 80.0, branch_3: 80.0 }, minStock: 10.0 },
      { id: 'inv-bread', nameAr: 'توست خبز', nameEn: 'Bread Toast', unit: 'slice', unitAr: 'شريحة', costPerUnit: 0.05, startingStock: { branch_1: 500.0, branch_2: 500.0, branch_3: 500.0 }, minStock: 5.0 },
      { id: 'inv-lettuce', nameAr: 'خس', nameEn: 'Lettuce', unit: 'kg', unitAr: 'كجم', costPerUnit: 1.20, startingStock: { branch_1: 30.0, branch_2: 30.0, branch_3: 30.0 }, minStock: 5.0 },
      { id: 'inv-tomato', nameAr: 'طماطم', nameEn: 'Tomato', unit: 'kg', unitAr: 'كجم', costPerUnit: 1.00, startingStock: { branch_1: 40.0, branch_2: 40.0, branch_3: 40.0 }, minStock: 5.0 },
      { id: 'inv-mayo', nameAr: 'مايونيز', nameEn: 'Mayonnaise', unit: 'kg', unitAr: 'كجم', costPerUnit: 3.00, startingStock: { branch_1: 15.0, branch_2: 15.0, branch_3: 15.0 }, minStock: 2.0 },
      { id: 'inv-croissant', nameAr: 'كرواسون سادة', nameEn: 'Croissant Plain', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.80, startingStock: { branch_1: 150.0, branch_2: 150.0, branch_3: 150.0 }, minStock: 15.0 },
      { id: 'inv-turkey', nameAr: 'شريحة ديك رومي', nameEn: 'Turkey Slice', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.40, startingStock: { branch_1: 200.0, branch_2: 200.0, branch_3: 200.0 }, minStock: 20.0 },
      { id: 'inv-mozzarella', nameAr: 'جبن موزاريلا', nameEn: 'Mozzarella', unit: 'kg', unitAr: 'كجم', costPerUnit: 6.00, startingStock: { branch_1: 25.0, branch_2: 25.0, branch_3: 25.0 }, minStock: 3.0 },
      { id: 'inv-flour', nameAr: 'دقيق', nameEn: 'Flour', unit: 'kg', unitAr: 'كجم', costPerUnit: 0.80, startingStock: { branch_1: 50.0, branch_2: 50.0, branch_3: 50.0 }, minStock: 5.0 },
      { id: 'inv-chocolate', nameAr: 'شوكولاتة فادج', nameEn: 'Chocolate Fudge', unit: 'kg', unitAr: 'كجم', costPerUnit: 5.00, startingStock: { branch_1: 30.0, branch_2: 30.0, branch_3: 30.0 }, minStock: 3.0 },
      { id: 'inv-tea', nameAr: 'أوراق شاي', nameEn: 'Tea Leaves', unit: 'kg', unitAr: 'كجم', costPerUnit: 8.00, startingStock: { branch_1: 15.0, branch_2: 15.0, branch_3: 15.0 }, minStock: 2.0 },
      { id: 'inv-peach', nameAr: 'سيروب خوخ', nameEn: 'Peach Syrup', unit: 'liter', unitAr: 'لتر', costPerUnit: 10.00, startingStock: { branch_1: 10.0, branch_2: 10.0, branch_3: 10.0 }, minStock: 1.0 },
      { id: 'inv-mint', nameAr: 'أوراق نعناع', nameEn: 'Mint Leaves', unit: 'kg', unitAr: 'كجم', costPerUnit: 3.00, startingStock: { branch_1: 5.0, branch_2: 5.0, branch_3: 5.0 }, minStock: 0.5 },
      { id: 'inv-lemon', nameAr: 'ليمون', nameEn: 'Lemon', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.10, startingStock: { branch_1: 500.0, branch_2: 500.0, branch_3: 500.0 }, minStock: 50.0 },
      { id: 'inv-soda', nameAr: 'مياه صودا', nameEn: 'Soda Water', unit: 'liter', unitAr: 'لتر', costPerUnit: 0.50, startingStock: { branch_1: 120.0, branch_2: 120.0, branch_3: 120.0 }, minStock: 12.0 },
      { id: 'inv-passion', nameAr: 'سيروب فواكه الاستوائية', nameEn: 'Passion Fruit Syrup', unit: 'liter', unitAr: 'لتر', costPerUnit: 15.00, startingStock: { branch_1: 10.0, branch_2: 10.0, branch_3: 10.0 }, minStock: 1.0 },
      { id: 'inv-oreo', nameAr: 'بسكويت أوريو', nameEn: 'Oreo Biscuits', unit: 'piece', unitAr: 'قطعة', costPerUnit: 0.20, startingStock: { branch_1: 800.0, branch_2: 800.0, branch_3: 800.0 }, minStock: 50.0 },
      { id: 'inv-strawberry', nameAr: 'فراولة', nameEn: 'Strawberry', unit: 'kg', unitAr: 'كجم', costPerUnit: 3.50, startingStock: { branch_1: 20.0, branch_2: 20.0, branch_3: 20.0 }, minStock: 2.0 },
      { id: 'inv-mango', nameAr: 'مانجو', nameEn: 'Mango', unit: 'kg', unitAr: 'كجم', costPerUnit: 4.00, startingStock: { branch_1: 25.0, branch_2: 25.0, branch_3: 25.0 }, minStock: 2.0 },
      { id: 'inv-icecream', nameAr: 'أيس كريم فانيليا', nameEn: 'Vanilla Ice Cream', unit: 'kg', unitAr: 'كجم', costPerUnit: 6.00, startingStock: { branch_1: 40.0, branch_2: 40.0, branch_3: 40.0 }, minStock: 5.0 }
    ];
  }, [dbInventory]);

  // Recipe: how much raw material each menu product consumes
  const ITEM_RECIPES: Record<string, Record<string, number>> = useMemo(() => {
    if (dbRecipes && dbRecipes.length > 0) {
      const mapped: Record<string, Record<string, number>> = {};
      dbRecipes.forEach(rec => {
        if (!mapped[rec.menuItemId]) {
          mapped[rec.menuItemId] = {};
        }
        mapped[rec.menuItemId][rec.inventoryItemId] = rec.quantity;
      });
      return mapped;
    }
    return {
      'Espresso': { 'inv-beans': 0.009, 'inv-cups': 1 },
      'Double Espresso': { 'inv-beans': 0.018, 'inv-cups': 1 },
      'Cortado': { 'inv-beans': 0.012, 'inv-milk': 0.05, 'inv-cups': 1 },
      'Flat White': { 'inv-beans': 0.018, 'inv-milk': 0.12, 'inv-cups': 1 },
      'Cafe Latte': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-cups': 1 },
      'Cappuccino': { 'inv-beans': 0.015, 'inv-milk': 0.18, 'inv-cups': 1 },
      'Spanish Latte': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-caramel': 0.02, 'inv-cups': 1 },
      'Americano': { 'inv-beans': 0.015, 'inv-cups': 1 },
      'Cafe Mocha': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-chocolate': 0.02, 'inv-cups': 1 },
      'Turkish Coffee': { 'inv-beans': 0.008, 'inv-cups': 1 },
      'French Coffee': { 'inv-beans': 0.008, 'inv-milk': 0.10, 'inv-cups': 1 },
      'Iced Americano': { 'inv-beans': 0.015, 'inv-cups': 1 },
      'Iced Latte': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-cups': 1 },
      'Iced Spanish Latte': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-caramel': 0.02, 'inv-cups': 1 },
      'Iced Caramel Macchiato': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-caramel': 0.02, 'inv-vanilla': 0.01, 'inv-cups': 1 },
      'Iced Mocha': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-chocolate': 0.02, 'inv-cups': 1 },
      'Cold Brew': { 'inv-beans': 0.020, 'inv-cups': 1 },
      'Iced Pistachio Latte': { 'inv-beans': 0.015, 'inv-milk': 0.20, 'inv-vanilla': 0.02, 'inv-cups': 1 },
      'Mocha Frappe': { 'inv-beans': 0.015, 'inv-milk': 0.15, 'inv-chocolate': 0.03, 'inv-icecream': 0.05, 'inv-cups': 1 },
      'Caramel Frappe': { 'inv-beans': 0.015, 'inv-milk': 0.15, 'inv-caramel': 0.03, 'inv-icecream': 0.05, 'inv-cups': 1 },
      'Coffee Frappe': { 'inv-beans': 0.015, 'inv-milk': 0.15, 'inv-icecream': 0.05, 'inv-cups': 1 },
      'Oreo Frappe': { 'inv-beans': 0.015, 'inv-milk': 0.15, 'inv-oreo': 3, 'inv-cups': 1 },
      'Oreo Milkshake': { 'inv-milk': 0.25, 'inv-oreo': 4, 'inv-icecream': 0.10, 'inv-cups': 1 },
      'Strawberry Milkshake': { 'inv-milk': 0.20, 'inv-strawberry': 0.10, 'inv-icecream': 0.10, 'inv-cups': 1 },
      'Chocolate Milkshake': { 'inv-milk': 0.20, 'inv-chocolate': 0.03, 'inv-icecream': 0.10, 'inv-cups': 1 },
      'Vanilla Milkshake': { 'inv-milk': 0.20, 'inv-vanilla': 0.02, 'inv-icecream': 0.15, 'inv-cups': 1 },
      'Mango Milkshake': { 'inv-milk': 0.20, 'inv-mango': 0.10, 'inv-icecream': 0.10, 'inv-cups': 1 },
      'Green Tea': { 'inv-tea': 0.005, 'inv-cups': 1 },
      'Karak Tea': { 'inv-tea': 0.006, 'inv-milk': 0.05, 'inv-cups': 1 },
      'Mint Lemonade': { 'inv-lemon': 2, 'inv-mint': 0.01, 'inv-soda': 0.20, 'inv-cups': 1 },
      'Peach Iced Tea': { 'inv-tea': 0.005, 'inv-peach': 0.03, 'inv-cups': 1 },
      'Passion Fruit Mojito': { 'inv-lemon': 1, 'inv-mint': 0.01, 'inv-passion': 0.03, 'inv-soda': 0.25, 'inv-cups': 1 },
      'Classic Club Sandwich': { 'inv-bread': 3, 'inv-chicken': 0.10, 'inv-lettuce': 0.02, 'inv-tomato': 0.03, 'inv-mayo': 0.01 },
      'Prime Beef Cheeseburger': { 'inv-beef': 1, 'inv-buns': 1, 'inv-cheese': 1, 'inv-lettuce': 0.01, 'inv-tomato': 0.02 },
      'Chicken Pane Sandwich': { 'inv-chicken': 0.12, 'inv-bread': 2, 'inv-lettuce': 0.01, 'inv-cheese': 1, 'inv-mayo': 0.01 },
      'Turkey & Cheese Croissant': { 'inv-croissant': 1, 'inv-turkey': 2, 'inv-cheese': 1 },
      'Grilled Cheese Sandwich': { 'inv-bread': 2, 'inv-cheese': 2, 'inv-mozzarella': 0.05 },
      'Cheese Fries': { 'inv-fries': 0.20, 'inv-cheese': 1 },
      'Chocolate Fudge Cake': { 'inv-flour': 0.05, 'inv-chocolate': 0.04, 'inv-sugar': 0.03 },
      'Warm Chocolate Brownie': { 'inv-flour': 0.03, 'inv-chocolate': 0.03, 'inv-icecream': 0.05 }
    };
  }, [dbRecipes]);

  // Compute per-branch consumed quantities from synced orders
  const inventoryData = useMemo(() => {
    const branchIds = ['branch_1', 'branch_2', 'branch_3'] as const;
    // Accumulate consumption per branch
    const consumption: Record<string, Record<string, number>> = {};
    branchIds.forEach(b => { consumption[b] = {}; });

    orders.forEach(order => {
      const bId = order.branch_id;
      if (!consumption[bId]) return;
      try {
        const items: OrderItem[] = JSON.parse(order.items);
        if (!Array.isArray(items)) return;
        items.forEach(item => {
          // Try lookup by id first, then name
          const recipe = ITEM_RECIPES[item.id] || ITEM_RECIPES[item.menuItemId || ''] || ITEM_RECIPES[item.name];
          if (!recipe) return;
          Object.entries(recipe).forEach(([matId, qty]) => {
            consumption[bId][matId] = (consumption[bId][matId] || 0) + qty * item.quantity;
          });
        });
      } catch {}
    });

    // Now compute remaining stock per branch
    return INVENTORY_ITEMS.map(inv => {
      const branchData: Record<string, { remaining: number; consumed: number; startStock: number; percentage: number; isLow: boolean }> = {};
      branchIds.forEach(bId => {
        // Find starting stock
        const start = INITIAL_STOCKS[inv.id] || (inv.startingStock && inv.startingStock[bId]) || 100;
        const consumed = consumption[bId]?.[inv.id] || 0;
        let remaining = Math.max(start - consumed, 0);

        // Crucial override: if this is the active branch and we have real SQLite database data for this item,
        // use the actual remaining stock from SQLite instead of calculated consumption!
        if (dbInventory && dbInventory.length > 0) {
          const dbItem = dbInventory.find(item => item.id === inv.id && item.branch_id === bId);
          if (dbItem) {
            remaining = dbItem.stock;
          }
        }

        const percentage = start > 0 ? (remaining / start) * 100 : 0;
        branchData[bId] = {
          remaining: Math.round(remaining * 100) / 100,
          consumed: Math.round(consumed * 100) / 100,
          startStock: start,
          percentage: Math.min(Math.round(percentage), 100),
          isLow: remaining <= inv.minStock,
        };
      });
      return { ...inv, branches: branchData };
    });
  }, [orders, INVENTORY_ITEMS, ITEM_RECIPES, dbInventory]);

  // ── Compute average selling yields for materials based on recipes and menu prices ──
  const materialYields = useMemo(() => {
    const yields: Record<string, number> = {};

    INVENTORY_ITEMS.forEach(inv => {
      let totalYield = 0;
      let validCount = 0;

      Object.entries(ITEM_RECIPES).forEach(([menuName, recipe]) => {
        const qty = recipe[inv.id];
        if (qty && qty > 0) {
          // Find menu item price (localMenuItems has them)
          const menuItem = localMenuItems?.find(m => m.name === menuName || m.id === menuName);
          const price = menuItem ? menuItem.price : 0;
          if (price > 0) {
            totalYield += price / qty;
            validCount++;
          }
        }
      });

      yields[inv.id] = validCount > 0 ? (totalYield / validCount) : 0;
    });

    return yields;
  }, [INVENTORY_ITEMS, ITEM_RECIPES, localMenuItems]);

  // Inventory summary stats
  const inventorySummary = useMemo(() => {
    const branchIds = selectedBranch === 'all' ? ['branch_1', 'branch_2', 'branch_3'] : [selectedBranch];
    let totalValue = 0;
    let totalSalesValue = 0;
    let totalProfitValue = 0;
    let lowStockCount = 0;
    let totalItems = 0;

    inventoryData.forEach(inv => {
      branchIds.forEach(bId => {
        const bd = inv.branches[bId];
        if (bd) {
          const costVal = bd.remaining * inv.costPerUnit;
          const salesVal = bd.remaining * (materialYields[inv.id] || 0);
          const profitVal = salesVal > 0 ? Math.max(salesVal - costVal, 0) : 0;

          totalValue += costVal;
          totalSalesValue += salesVal;
          totalProfitValue += profitVal;
          
          if (bd.isLow) lowStockCount++;
          totalItems++;
        }
      });
    });

    return { totalValue, totalSalesValue, totalProfitValue, lowStockCount, totalItems };
  }, [inventoryData, selectedBranch, materialYields]);

  // Max bounds for graphing
  const maxRevenueValue = Math.max(...processedData.chartData.map(d => d.value), 1);
  const maxItemCount = Math.max(...processedData.topItems.map(i => i.count), 1);

  // Labels helper
  const activeBranchLabel = useMemo(() => {
    const branch = BRANCHES.find(b => b.id === selectedBranch);
    return language === 'ar' ? branch?.labelAr : branch?.labelEn;
  }, [selectedBranch, language]);

  const pLabel = useMemo(() => {
    const map: Record<AnalyticsPeriod, string> = {
      'Today': 'today', 'This Week': 'this week', 'This Month': 'this month', 'This Year': 'this year',
    };
    return t(map[dateRange]);
  }, [dateRange, t]);

  const currencyStr = language === 'ar' ? 'ج.م' : 'EGP';

  // Stat Cards
  const statCards = [
    {
      label: t('TOTAL REVENUE (INCL. TAX)'),
      value: `${processedData.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: DollarSign,
      trend: `${t('Paid revenue')} (${pLabel})`,
      color: 'green' as const,
    },
    {
      label: t('TOTAL ORDERS'),
      value: processedData.totalOrdersCount.toLocaleString(),
      icon: ShoppingBag,
      trend: `${processedData.paidCount} ${t('completed')} · ${processedData.unpaidCount} ${t('Open')}`,
      color: 'blue' as const,
    },
    {
      label: t('AVG. ORDER VALUE'),
      value: `${processedData.avgOrderValue.toFixed(2)} ${currencyStr}`,
      icon: TrendingUp,
      trend: `${t('Average ticket')} (${pLabel})`,
      color: 'orange' as const,
    },
    {
      label: t('Menu Items'),
      value: localMenuItems ? localMenuItems.length.toString() : '40',
      icon: Coffee,
      trend: `${localMenuItems ? localMenuItems.filter(i => i.available).length : '40'} ${t('available now')}`,
      color: 'purple' as const,
    },
    {
      label: t('Total Stock Cost'),
      value: `${inventorySummary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currencyStr}`,
      icon: Scale,
      trend: language === 'ar' ? 'سعر شراء الخامات بالمخزن' : 'Cost value of remaining stock',
      color: 'blue' as const,
    },
    {
      label: t('Expected Potential Profit'),
      value: `${inventorySummary.totalProfitValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currencyStr}`,
      icon: TrendingUp,
      trend: language === 'ar' ? 'الأرباح المتوقعة من الخامات بالمخزن' : 'Potential profit of remaining stock',
      color: 'green' as const,
    },
  ];

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      // Branch filter
      if (selectedBranch !== 'all' && c.branchId !== selectedBranch) return false;
      // Search filter
      const query = customerSearchTerm.trim().toLowerCase();
      if (!query) return true;
      return (
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.phone && c.phone.includes(query))
      );
    });
  }, [customers, selectedBranch, customerSearchTerm]);

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
    <div className="space-y-4 md:space-y-8 text-gray-900 pb-16">
      
      {/* ── Header Area with Live Status & Filters ─────────────────────────────────── */}
      <div className="flex flex-col tablet:flex-row tablet:items-center xl:flex-row xl:items-center justify-between gap-4 bg-white/50 backdrop-blur-md p-4 rounded-2xl border border-gray-200/40 shadow-sm relative z-30">
        
        {/* Title and Cloud Sync Connection Badge */}
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">
              {language === 'ar' ? 'لوحة تحكم المدير العام' : 'Web Manager Central Dashboard'}
            </h1>
            
            {/* Live Connection Sync Status Badge */}
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-colors shadow-sm ${
              isDemoMode 
                ? 'bg-amber-50 text-amber-600 border-amber-200/50' 
                : 'bg-emerald-50 text-emerald-600 border-emerald-200/50'
            }`}>
              {isDemoMode ? (
                <>
                  <WifiOff size={13} className="animate-pulse" />
                  <span>{language === 'ar' ? 'عرض تجريبي (أوفلاين)' : 'Demo Mode (Offline)'}</span>
                </>
              ) : (
                <>
                  <SignalHigh size={13} className="text-emerald-500 animate-pulse" />
                  <span>{language === 'ar' ? 'سيرفر Cloudflare مباشر' : 'Cloudflare Live Database'}</span>
                </>
              )}
            </div>
            
            {/* Manual Refresh Button */}
            <button 
              onClick={fetchOrders}
              className="p-2 rounded-lg hover:bg-gray-100 border border-gray-200 transition-all text-gray-500 hover:text-gray-900"
              title="Refresh Stats"
            >
              <RefreshCw size={14} className="hover:rotate-45 transition-transform" />
            </button>
          </div>
          <p className="text-xs md:text-sm text-gray-500 font-medium">
            {language === 'ar' 
              ? 'مراقبة إيرادات ومبيعات كافة الفروع المتصلة بقاعدة البيانات المركزية' 
              : 'Monitor revenues and sales across all branches synced to the cloud.'}
          </p>
        </div>

        {/* Filters Panel (Date Selector) */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">

          {/* Date Range Dropdown */}
          <div className="relative flex items-center bg-white border border-gray-250/70 rounded-xl shadow-sm pr-3">
            <Calendar className="text-gray-400 w-4 h-4 ml-2 mr-2" />
            <select
              value={dateRange}
              onChange={e => {
                const val = e.target.value as AnalyticsPeriod;
                setDateRange(val);
                localStorage.setItem('manager_date_range', val);
              }}
              className="py-2.5 bg-transparent border-0 outline-none text-xs md:text-sm font-bold text-gray-700 cursor-pointer pr-8"
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
            className="flex items-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs md:text-sm font-bold transition-all active:scale-95 shadow-sm"
            title={language === 'ar' ? 'إرسال تقرير اليوم لتليجرام' : 'Send Daily Report to Telegram'}
          >
            <Send size={14} />
            <span>{language === 'ar' ? 'تقرير التليجرام' : 'Telegram Report'}</span>
          </button>

          {/* Print Report */}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-black text-white rounded-xl text-xs md:text-sm font-bold transition-all active:scale-95 shadow-sm"
          >
            <Download size={14} />
            <span>{t('Export')}</span>
          </button>
        </div>
      </div>

      {/* ── Tab Switcher ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 bg-white/80 backdrop-blur-sm p-1.5 rounded-xl border border-gray-200/50 shadow-sm w-fit">
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all ${
            activeTab === 'analytics'
              ? 'bg-gray-900 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <BarChart3 size={16} />
          {language === 'ar' ? 'الإحصائيات والتحليلات' : 'Analytics & Insights'}
        </button>
        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all relative ${
            activeTab === 'inventory'
              ? 'bg-gray-900 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Package size={16} />
          {language === 'ar' ? 'حالة المخزون بالفروع' : 'Branch Inventory Status'}
          {inventorySummary.lowStockCount > 0 && (
            <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center ${
              activeTab === 'inventory' ? 'bg-red-500 text-white' : 'bg-red-500 text-white animate-pulse'
            }`}>
              {inventorySummary.lowStockCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all relative ${
            activeTab === 'settings'
              ? 'bg-gray-900 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Settings size={16} />
          {language === 'ar' ? 'الإعدادات' : 'Settings'}
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

      {/* ── Metrics Stat Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 tablet:grid-cols-3 lg:grid-cols-3 gap-4 md:gap-6">
        {statCards.map((s, i) => <StatCard key={i} {...s} />)}
      </div>

      {/* ── Chart & Top Items Panels ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 tablet:grid-cols-3 lg:grid-cols-3 gap-6 md:gap-8">
        
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

          <div className="flex-1 flex items-end justify-between gap-2 h-64 pb-2 pt-6">
            {processedData.chartData.map((data, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2 group">
                <div className="relative w-full h-52 flex items-end justify-center">
                  
                  {/* Animated Bar */}
                  <motion.div
                    key={`${dateRange}-${selectedBranch}-bar-${idx}`}
                    initial={{ height: 0 }}
                    animate={{ height: `${(data.value / maxRevenueValue) * 85 + 5}%` }}
                    transition={{ duration: 0.7, ease: 'easeOut', delay: idx * 0.03 }}
                    className="w-full max-w-[28px] md:max-w-[36px] rounded-t-lg transition-opacity group-hover:opacity-75 relative bg-gradient-to-t from-mocha-500 to-caramel shadow-sm"
                  >
                    {/* Hover Tooltip */}
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-12 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] md:text-xs py-1.5 px-2 rounded-lg pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl">
                      {data.value.toFixed(2)} {currencyStr}
                      {data.orders > 0 ? ` · ${data.orders} ${t('orders')}` : ''}
                    </div>
                  </motion.div>
                </div>
                <span className="text-[10px] md:text-xs font-bold text-gray-500 truncate max-w-[50px]">{data.label}</span>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-md bg-gradient-to-t from-mocha-500 to-caramel" />
              <span className="text-xs text-gray-500 font-semibold">
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
                      key={`${dateRange}-${selectedBranch}-top-${idx}`}
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
      <div className="grid grid-cols-1 tablet:grid-cols-3 lg:grid-cols-3 gap-6 md:gap-8">
        
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
                    key={`takeaway-${dateRange}-${selectedBranch}`}
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
                    key={`dinein-${dateRange}-${selectedBranch}`}
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
                    key={`paid-inv-${dateRange}-${selectedBranch}`}
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
                    key={`open-inv-${dateRange}-${selectedBranch}`}
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
                      key={`cash-${dateRange}-${selectedBranch}`}
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
                      key={`card-${dateRange}-${selectedBranch}`}
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
                  const items: OrderItem[] = JSON.parse(order.items);
                  if (Array.isArray(items) && items.length > 0) {
                    summary = items.slice(0, 2).map(i => `${i.quantity}× ${t(i.name)}`).join(', ');
                    if (items.length > 2) {
                      more = ` +${items.length - 2}`;
                    }
                  }
                } catch {}

                const branchLabel = BRANCHES.find(b => b.id === order.branch_id);
                const bLabel = language === 'ar' ? branchLabel?.labelAr : branchLabel?.labelEn;

                const elapsed = Math.round((Date.now() - new Date(order.$createdAt).getTime()) / 60000);
                const timeStr = elapsed < 1 ? t('just now') : elapsed < 60 ? `${elapsed}${t('m ago')}` : `${Math.round(elapsed / 60)}${t('h ago')}`;

                return (
                  <motion.div
                    key={order.$id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="flex items-center justify-between py-3 gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-2 bg-green-50 text-green-600 rounded-xl shrink-0">
                        <CheckCircle2 size={16} />
                      </div>
                      <div className="min-w-0 text-left">
                        <p className="text-xs md:text-sm font-extrabold text-gray-900 truncate">
                          {order.tableId === 'Takeaway' ? t('Takeaway') : `${t('Table')} ${order.tableId}`}
                          <span className="text-[10px] text-mocha-600 font-bold bg-mocha-50 border border-mocha-100 px-1.5 py-0.5 rounded mx-1.5">{bLabel}</span>
                        </p>
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">{summary}{more}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs md:text-sm font-extrabold text-gray-900">
                        {(Number(order.total_amount) * (1 + taxRate)).toFixed(2)} {currencyStr}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{timeStr}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

      </div>



      </>)}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ══ INVENTORY TAB ══════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'inventory' && (
        <div className="space-y-6">

          {/* Inventory Summary Stat Cards */}
          <div className="grid grid-cols-2 tablet:grid-cols-4 lg:grid-cols-4 gap-4 md:gap-6">
            <StatCard
              label={language === 'ar' ? 'إجمالي تكلفة المخزون' : 'Total Stock Cost'}
              value={`${inventorySummary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currencyStr}`}
              icon={DollarSign}
              trend={language === 'ar' ? `${activeBranchLabel} - سعر الشراء` : `${activeBranchLabel} - Cost Price`}
              color="blue"
            />
            <StatCard
              label={language === 'ar' ? 'إجمالي القيمة البيعية' : 'Potential Sales Value'}
              value={`${inventorySummary.totalSalesValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currencyStr}`}
              icon={Coins}
              trend={language === 'ar' ? `قيمة البيع المتوقعة` : `Est. selling yield`}
              color="green"
            />
            <StatCard
              label={language === 'ar' ? 'إجمالي الأرباح المتوقعة' : 'Expected Potential Profit'}
              value={`${inventorySummary.totalProfitValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currencyStr}`}
              icon={TrendingUp}
              trend={language === 'ar' ? `الأرباح الكامنة بالمخزن` : `Expected margin`}
              color="purple"
            />
            <StatCard
              label={language === 'ar' ? 'تنبيهات نقص المخزون' : 'Low Stock Alerts'}
              value={inventorySummary.lowStockCount.toString()}
              icon={AlertTriangle}
              trend={inventorySummary.lowStockCount > 0
                ? (language === 'ar' ? '⚠️ يحتاج إعادة طلب فوري' : '⚠️ Needs immediate reorder')
                : (language === 'ar' ? '✅ جميع الأصناف متوفرة' : '✅ All items sufficient')}
              color={inventorySummary.lowStockCount > 0 ? 'orange' : 'green'}
            />
          </div>

          {/* Inventory Table / Cards */}
          {selectedBranch === 'all' ? (
            /* ── Multi-Branch Comparative Table ────────────────────────────── */
            <div className="bg-white rounded-2xl shadow-sm border border-gray-150 overflow-hidden">
              <div className="p-4 md:p-6 border-b border-gray-100">
                <h2 className="text-base md:text-lg font-extrabold text-gray-900">
                  {language === 'ar' ? 'مقارنة المخزون بين الفروع' : 'Cross-Branch Inventory Comparison'}
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  {language === 'ar' 
                    ? 'عرض الكميات المتبقية والمستهلكة لكل مادة خام في كل فرع محسوبة من الطلبات الفعلية'
                    : 'Remaining and consumed quantities per material across branches, calculated from actual sales'}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs md:text-sm">
                  <thead>
                    <tr className="bg-gray-50/80">
                      <th className="text-left px-4 py-3 font-bold text-gray-700 sticky left-0 bg-gray-50/80 z-10">
                        {language === 'ar' ? 'المادة الخام' : 'Material'}
                      </th>
                      <th className="text-center px-3 py-3 font-bold text-gray-500">
                        {language === 'ar' ? 'الوحدة' : 'Unit'}
                      </th>
                      {BRANCHES.filter(b => b.id !== 'all').map(branch => (
                        <th key={branch.id} className="text-center px-3 py-3 font-bold text-gray-700 min-w-[140px]">
                          {language === 'ar' ? branch.labelAr : branch.labelEn}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {inventoryData.map((inv, idx) => (
                      <motion.tr
                        key={inv.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.03 }}
                        className="hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="px-4 py-3 font-bold text-gray-800 sticky left-0 bg-white z-10">
                          {language === 'ar' ? inv.nameAr : inv.nameEn}
                        </td>
                        <td className="text-center px-3 py-3 text-gray-400 font-semibold">
                          {language === 'ar' ? inv.unitAr : inv.unit}
                        </td>
                        {['branch_1', 'branch_2', 'branch_3'].map(bId => {
                          const bd = inv.branches[bId];
                          if (!bd) return <td key={bId} className="text-center px-3 py-3">-</td>;
                          return (
                            <td key={bId} className="px-3 py-3">
                              <div className="flex flex-col items-center gap-1">
                                <span className={`font-bold text-sm ${
                                  bd.isLow ? 'text-red-600' : 'text-gray-800'
                                }`}>
                                  {bd.remaining}
                                  {bd.isLow && <AlertTriangle size={12} className="inline ml-1 text-red-500" />}
                                </span>
                                <div className="w-full max-w-[100px] h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${bd.percentage}%` }}
                                    transition={{ duration: 0.8, delay: idx * 0.03 }}
                                    className={`h-full rounded-full ${
                                      bd.percentage > 50 ? 'bg-emerald-500' :
                                      bd.percentage > 25 ? 'bg-amber-500' : 'bg-red-500'
                                    }`}
                                  />
                                </div>
                                <span className="text-[10px] text-gray-400">{bd.percentage}%</span>
                              </div>
                            </td>
                          );
                        })}
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* ── Single Branch Detailed Inventory Grid ─────────────────────── */
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="text-base md:text-lg font-extrabold text-gray-900">
                  {language === 'ar' ? `تفاصيل مخزون ${activeBranchLabel}` : `${activeBranchLabel} Inventory Details`}
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {inventoryData.map((inv, idx) => {
                  const bd = inv.branches[selectedBranch];
                  if (!bd) return null;
                  return (
                    <motion.div
                      key={inv.id}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04 }}
                      className={`bg-white p-4 rounded-2xl border shadow-sm transition-all hover:shadow-md ${
                        bd.isLow ? 'border-red-200 bg-red-50/30' : 'border-gray-150'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-bold text-gray-900 text-sm">
                            {language === 'ar' ? inv.nameAr : inv.nameEn}
                          </h3>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {language === 'ar' ? inv.unitAr : inv.unit} · {inv.costPerUnit} {currencyStr}/{language === 'ar' ? inv.unitAr : inv.unit}
                          </p>
                        </div>
                        {bd.isLow && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-100 px-2 py-1 rounded-lg">
                            <AlertTriangle size={11} />
                            {language === 'ar' ? 'نقص' : 'Low'}
                          </span>
                        )}
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${bd.percentage}%` }}
                          transition={{ duration: 0.8, delay: idx * 0.04 }}
                          className={`h-full rounded-full ${
                            bd.percentage > 50 ? 'bg-emerald-500' :
                            bd.percentage > 25 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                        />
                      </div>

                      <div className="flex justify-between text-[11px] text-gray-500 font-semibold">
                        <span>
                          {language === 'ar' ? 'متبقي' : 'Remaining'}: <span className="text-gray-800 font-bold">{bd.remaining}</span>
                        </span>
                        <span>{bd.percentage}%</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                        <span>{language === 'ar' ? 'مستهلك' : 'Consumed'}: {bd.consumed}</span>
                        <span>{language === 'ar' ? 'بداية' : 'Start'}: {bd.startStock}</span>
                      </div>
                      <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                        <p className="text-[10px] text-gray-400 font-bold flex justify-between">
                          <span>{language === 'ar' ? 'القيمة التقديرية (تكلفة):' : 'Cost Value:'}</span>
                          <span className="text-gray-700 ml-1">
                            {(bd.remaining * inv.costPerUnit).toLocaleString(undefined, { maximumFractionDigits: 0 })} {currencyStr}
                          </span>
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold flex justify-between">
                          <span>{language === 'ar' ? 'القيمة البيعية المتوقعة:' : 'Potential Selling Value:'}</span>
                          <span className="text-emerald-600 ml-1">
                            {(bd.remaining * (materialYields[inv.id] || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })} {currencyStr}
                          </span>
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold flex justify-between">
                          <span>{language === 'ar' ? 'الأرباح المتوقعة:' : 'Potential Profit:'}</span>
                          <span className="text-sky-600 ml-1">
                            {Math.max((bd.remaining * (materialYields[inv.id] || 0)) - (bd.remaining * inv.costPerUnit), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} {currencyStr}
                          </span>
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}


      {/* ── SETTINGS TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-gray-150 shadow-sm">
          <SettingsPage />
        </div>
      )}

    </div>
  );
}
