import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, DollarSign, ShoppingBag,
  Coffee, Calendar, Download,
  CheckCircle2, Clock, XCircle, AlertCircle, Utensils,
  UserCheck, Award, Coins, Building2, ChevronDown, RefreshCw,
  Signal, SignalHigh, WifiOff, Package, AlertTriangle, BarChart3, Languages, Users, Search, Settings, Send, Scale, TrendingDown
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { getTaxRate } from '../utils/settingsConfig';
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
import { useToast } from '../components/ui/Toast';


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
  const toast = useToast();
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
    // Default to week so restored cloud history is visible after browser wipe
    return 'This Week';
  });

  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'analytics' | 'menu' | 'inventory' | 'customers' | 'settings'>('analytics');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');

  // Unified Analytics & Inventory State
  const analytics = useAnalytics(dateRange);
  const [liveInventory, setLiveInventory] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);

  useEffect(() => {
    inventoryService.getAll().then(setLiveInventory).catch(() => {});
    inventoryService.getMenuRecipes().then(res => { if (Array.isArray(res)) setRecipes(res); }).catch(() => {});
    menuService.getAll().then(setMenuItems).catch(() => {});
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

      message += `📊 <b>إحصائيات ولاء العملاء:</b>\n`;
      message += `• إجمالي العملاء المسجلين: <b>${customers.length}</b> عضو\n`;
      message += `• إجمالي نقاط الولاء الموزعة: <b>${customers.reduce((s, c) => s + (Number(c.points) || 0), 0).toLocaleString()}</b> نقطة\n\n`;

      message += `✅ تم تصدير تقرير العملاء من لوحة الإشراف المركزية`;
    }

    // Send message to Telegram using shared service
    try {
      await telegramService.sendMessage(botToken, chatId, message, 'HTML');
      alert(language === 'ar' ? 'تم إرسال تقرير الفترة المحددة للتليجرام بنجاح!' : 'Report for the selected period sent successfully to Telegram!');
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

  // ── Scoped Data Processing (Directly from analytics hook for 100% parity with Reports) ──
  const processedData = useMemo(() => {
    return {
      totalRevenue: analytics.totalRevenue,
      totalOrdersCount: analytics.totalOrders,
      avgOrderValue: analytics.avgOrderValue,
      chartData: analytics.chartData,
      topItems: analytics.topItems,
      takeawayCount: analytics.periodOrders.filter(o => o.tableId === 'Takeaway').length,
      dineInCount: analytics.periodOrders.filter(o => o.tableId !== 'Takeaway').length,
      totalCount: analytics.totalOrders,
      paidCount: analytics.completedPeriod.length,
      unpaidCount: analytics.periodOrders.filter(o => o.paymentStatus === 'Unpaid').length,
      paidAmount: analytics.realRevenue,
      unpaidAmount: analytics.periodOrders.filter(o => o.paymentStatus === 'Unpaid').reduce((s, o) => s + o.totalAmount * (1 + taxRate), 0),
      cashAmount: analytics.completedPeriod.filter(o => o.paymentMethod === 'Cash').reduce((s, o) => s + o.totalAmount * (1 + taxRate), 0),
      cardAmount: analytics.completedPeriod.filter(o => o.paymentMethod === 'Card').reduce((s, o) => s + o.totalAmount * (1 + taxRate), 0),
      cashPercentage: analytics.totalRevenue > 0 ? Math.round((analytics.completedPeriod.filter(o => o.paymentMethod === 'Cash').reduce((s, o) => s + o.totalAmount * (1 + taxRate), 0) / analytics.totalRevenue) * 100) : 0,
      cardPercentage: analytics.totalRevenue > 0 ? Math.round((analytics.completedPeriod.filter(o => o.paymentMethod === 'Card').reduce((s, o) => s + o.totalAmount * (1 + taxRate), 0) / analytics.totalRevenue) * 100) : 0,
      recentTransactions: analytics.recentTransactions,
      loyaltyCount: customers.length,
      loyaltyPoints: 0,
      loyaltyValue: 0
    };
  }, [analytics, taxRate, customers]);

  // ── Inventory Data for Tab views ──
  const activeInventory = useMemo(() => {
    return liveInventory && liveInventory.length > 0 ? liveInventory : dbInventory;
  }, [liveInventory, dbInventory]);

  const inventoryData = useMemo(() => {
    return activeInventory.map(inv => ({
      ...inv,
      nameAr: inv.name,
      nameEn: inv.name,
      unitAr: inv.unit,
      branches: {
        all: { remaining: inv.stock, consumed: 0, startStock: inv.stock, percentage: 100, isLow: inv.stock <= inv.minStock },
        branch_1: { remaining: inv.stock, consumed: 0, startStock: inv.stock, percentage: 100, isLow: inv.stock <= inv.minStock },
        branch_2: { remaining: inv.stock, consumed: 0, startStock: inv.stock, percentage: 100, isLow: inv.stock <= inv.minStock },
        branch_3: { remaining: inv.stock, consumed: 0, startStock: inv.stock, percentage: 100, isLow: inv.stock <= inv.minStock }
      }
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
        const cost = getUnitCost(ing.inventoryItemId);
        return sum + (ing.quantity * cost);
      }, 0);
      menuTotalCostMap.set(mId, totalCost > 0 ? totalCost : 1);
    });

    const invRecipesMap = new Map<string, { menuItemId: string; quantity: number }[]>();
    recipes.forEach(r => {
      const invItem = resolveInvItem(r.inventoryItemId);
      const targetId = invItem ? invItem.id : r.inventoryItemId;

      if (!invRecipesMap.has(targetId)) invRecipesMap.set(targetId, []);
      invRecipesMap.get(targetId)!.push({
        menuItemId: String(r.menuItemId),
        quantity: r.quantity
      });
    });

    activeInventory.forEach((item: any) => {
      const itemRecipes = invRecipesMap.get(item.id) || [];
      const itemUnitCost = item.costPerUnit && item.costPerUnit > 0 ? item.costPerUnit : 1;

      if (itemRecipes.length === 0) {
        yields[item.id] = itemUnitCost * 2.5;
        return;
      }

      let totalUnitYield = 0;
      let validCount = 0;

      itemRecipes.forEach(rec => {
        const menuItem = menuMap.get(String(rec.menuItemId));
        const totalRecipeCost = menuTotalCostMap.get(String(rec.menuItemId)) || 1;
        if (menuItem && rec.quantity > 0) {
          const itemCostInRecipe = rec.quantity * itemUnitCost;
          const costShareFraction = itemCostInRecipe / totalRecipeCost;
          const allocatedRevenue = costShareFraction * menuItem.price;
          const unitYield = allocatedRevenue / rec.quantity;
          totalUnitYield += unitYield;
          validCount++;
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

  // COGS & Net Profit Calculations (100% Identical to Reports)
  const recipeCosts = useMemo(() => {
    const costMap: Record<string, number> = {};
    for (const r of recipes) {
      const invItem = activeInventory.find((i: any) => i.id === r.inventoryItemId);
      const itemCost = invItem ? invItem.costPerUnit : 0;
      costMap[r.menuItemId] = (costMap[r.menuItemId] || 0) + (r.quantity * itemCost);
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
    const revenue = analytics.totalRevenue;
    const tax = revenue * taxRate;
    return Math.max(0, revenue - tax - cogs);
  }, [analytics.totalRevenue, taxRate, cogs]);

  // All 7 Stat Cards (Matching Reports page 100%)
  const statCardsRow1 = [
    {
      label: t('TOTAL REVENUE (INCL. TAX)'),
      value: `${analytics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyStr}`,
      icon: DollarSign,
      trend: analytics.realRevenue > 0 ? `+${analytics.realRevenue.toFixed(2)} ${currencyStr} ${pLabel}` : t('Lifetime total'),
      color: 'green' as const,
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
          onClick={() => setActiveTab('menu')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all ${
            activeTab === 'menu'
              ? 'bg-gray-900 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Coffee size={16} />
          {language === 'ar' ? 'إدارة القائمة' : 'Menu Management'}
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
          {language === 'ar' ? 'إدارة المخزون' : 'Inventory Management'}
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
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all ${
            activeTab === 'customers'
              ? 'bg-gray-900 text-white shadow-md'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Users size={16} />
          {language === 'ar' ? 'العملاء والشركات' : 'Customers & Companies'}
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

      {/* ── All 7 Stat Cards in 2 Rows (100% Identical to Reports Page) ───────────── */}
      <div className="space-y-4 md:space-y-6">
        {/* Row 1: 3 cards (Revenue, Orders, Menu Items) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
          {statCardsRow1.map((s, i) => <StatCard key={i} {...s} />)}
        </div>
        {/* Row 2: 4 cards (COGS, Net Profit, Stock Cost, Potential Profit) */}
        <div className="grid grid-cols-2 tablet:grid-cols-4 lg:grid-cols-4 gap-4 md:gap-6">
          {statCardsRow2.map((s, i) => <StatCard key={i} {...s} />)}
        </div>
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
                  const items = order.items || [];
                  if (Array.isArray(items) && items.length > 0) {
                    summary = items.slice(0, 2).map(i => `${i.quantity}× ${t(i.name)}`).join(', ');
                    if (items.length > 2) {
                      more = ` +${items.length - 2}`;
                    }
                  }
                } catch {}

                const branchLabel = BRANCHES.find(b => b.id === (order.branchId || 'all'));
                const bLabel = language === 'ar' ? branchLabel?.labelAr : branchLabel?.labelEn;

                const elapsed = Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000);
                const timeStr = elapsed < 1 ? t('just now') : elapsed < 60 ? `${elapsed}${t('m ago')}` : `${Math.round(elapsed / 60)}${t('h ago')}`;

                return (
                  <motion.div
                    key={order.id}
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
                        {(Number(order.totalAmount) * (1 + taxRate)).toFixed(2)} {currencyStr}
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
          <div className="bg-white p-4 md:p-6 rounded-2xl border border-gray-150 shadow-sm">
            <CustomersPage managerMode />
          </div>
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


    </div>
  );
}
