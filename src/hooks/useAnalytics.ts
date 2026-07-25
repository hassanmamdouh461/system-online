/**
 * useAnalytics — Unified Analytics Hook
 *
 * Single source of truth for all analytical data used by Dashboard and Reports.
 *
 * Dual-mode formula:
 *   • 'Today'               → 100 % real data only. Revenue, orders, and top items
 *                             are derived exclusively from live database records.
 *                             Dashboard starts at $0.00 / 0 orders each morning.
 *   • 'This Week/Month/Year'→ historical baseline  +  real completed orders.
 *                             Keeps realistic aggregate numbers for portfolio demos.
 *
 * When Reports is on "Today", every number matches Dashboard exactly.
 */
import { useMemo } from 'react';
import { getTaxRate } from '../utils/settingsConfig';
import { useOrders } from './useOrders';
import { useMenu } from './useMenu';
import { Order, OrderStatus } from '../types/order';
import { MenuItem } from '../types/menu';

// ─── Period type ──────────────────────────────────────────────────────────────
export type AnalyticsPeriod = 'Today' | 'This Week' | 'This Month' | 'This Year';

// ─── Historical Baseline ──────────────────────────────────────────────────────
// Pure live data mode: zero baseline so all metrics come 100% from real orders
const BASELINE: Record<AnalyticsPeriod, {
  orders: number;
  completedOrders: number;
  revenue: number;
}> = {
  'Today':      { orders: 0, completedOrders: 0, revenue: 0 },
  'This Week':  { orders: 0, completedOrders: 0, revenue: 0 },
  'This Month': { orders: 0, completedOrders: 0, revenue: 0 },
  'This Year':  { orders: 0, completedOrders: 0, revenue: 0 },
};

// ─── Chart Baseline ───────────────────────────────────────────────────────────
// All base values are 0 so chart bars represent 100% real completed revenue
const CHART_CONFIG: Record<AnalyticsPeriod, {
  labels: string[];
  base: number[];
  getBucket: (d: Date) => number;
}> = {
  'Today': {
    labels: ['12am', '2am', '4am', '6am', '8am', '10am', '12pm', '2pm', '4pm', '6pm', '8pm', '10pm'],
    base:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    getBucket: (d) => Math.floor(d.getHours() / 2),
  },
  'This Week': {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    base:   [0, 0, 0, 0, 0, 0, 0],
    getBucket: (d) => (d.getDay() + 6) % 7,
  },
  'This Month': {
    labels: ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4'],
    base:   [0, 0, 0, 0],
    getBucket: (d) => Math.min(Math.floor((d.getDate() - 1) / 7), 3),
  },
  'This Year': {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    base:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    getBucket: (d) => d.getMonth(),
  },
};

// ─── Top Items ───────────────────────────────────────────────────────────────
const TOP_ITEMS_BOOST: Record<AnalyticsPeriod, TopItem[]> = {
  'Today': [],
  'This Week': [],
  'This Month': [],
  'This Year': [],
};

// ─── Period filter ────────────────────────────────────────────────────────────
function inPeriod(dateStr: string | undefined, period: AnalyticsPeriod): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();

  switch (period) {
    case 'Today':
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
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

// ─── Exported types ───────────────────────────────────────────────────────────
export interface ChartPoint {
  label: string;
  value: number;        // baseline + real (what the bar renders)
  realRevenue: number;  // real portion only (for color + badge)
  orders: number;       // real order count in this bucket (for tooltip)
}

export interface TopItem {
  name: string;
  count: number;
  revenue: number;
}

export interface AnalyticsResult {
  loading: boolean;
  error: Error | null;

  // ── Aggregated stats (baseline + real) ──────────────────────────────────────
  // ⚠ When period = 'Today', these values are IDENTICAL to what Dashboard shows.
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  openOrders: number;           // live count only — no baseline (always current)
  totalTax: number;
  totalPreTax: number;

  // ── Menu ────────────────────────────────────────────────────────────────────
  menuItemsCount: number;
  availableMenuItemsCount: number;
  menuItems: MenuItem[];        // raw array (for NewOrderModal etc.)

  // ── Real-only deltas (for "live" / "new" badges) ─────────────────────────────
  realRevenue: number;
  realOrders: number;           // count of real orders in the period

  // ── Chart ───────────────────────────────────────────────────────────────────
  chartData: ChartPoint[];

  // ── Rankings ────────────────────────────────────────────────────────────────
  topItems: TopItem[];

  // ── Status breakdown (real only — it's a live metric) ───────────────────────
  statusBreakdown: Array<{ status: OrderStatus; count: number }>;
  allOrdersTotal: number;       // total ALL real orders (for % denominator in status section)
  // ── Activity / transaction feeds ────────────────────────────────────────────
  recentOrders: Order[];        // newest 5 all-time (Dashboard activity feed)
  recentTransactions: Order[];  // newest 5 completed in period (Reports page)

  // ── Raw period arrays (for components needing full access) ───────────────────
  periodOrders: Order[];
  completedPeriod: Order[];
  period: AnalyticsPeriod;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAnalytics(period: AnalyticsPeriod): AnalyticsResult {
  const { orders, loading: ordersLoading, error: ordersError } = useOrders();
  const { items: menuItems, loading: menuLoading, error: menuError } = useMenu();

  const loading = ordersLoading || menuLoading;
  const error   = ordersError ?? menuError ?? null;

  // All orders that fall inside the requested period
  // Do NOT blank out while loading if we already have orders (prevents flash-to-zero after hydrate)
  const periodOrders = useMemo(
    () => orders.filter(o => inPeriod(o.createdAt, period)),
    [orders, period],
  );

  // Realized Sales: Include strictly paid orders (Cash + Card) based on creation date.
  // OnAccount / Unpaid orders are tracked as receivables (outstanding amounts), not realized drawer revenue.
  const completedPeriod = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.paymentStatus === 'Paid' &&
          o.status !== 'Cancelled' &&
          inPeriod(o.paidAt || o.createdAt, period)
      ),
    [orders, period],
  );


  // Sum of real completed-order revenue in the period (including frozen tax when present)
  // CRITICAL: NaN / non-finite grandTotal/tax fields must be ignored (D1 nulls used to become 0/NaN)
  // We compute both the tax-inclusive total AND the actual frozen tax, so net-profit
  // can subtract the real collected tax instead of re-guessing revenue * rate.
  const { realRevenue, realTax, realPreTax } = useMemo(() => {
    let rev = 0;
    let tax = 0;
    let preTax = 0;
    for (const o of completedPeriod) {
      let lineTax = 0;
      let lineTotal = 0;
      if (typeof o.taxAmount === 'number' && Number.isFinite(o.taxAmount)) {
        lineTax = o.taxAmount;
      } else {
        const rate =
          typeof o.taxRate === 'number' && Number.isFinite(o.taxRate) ? o.taxRate : getTaxRate();
        lineTax = o.totalAmount * rate;
      }
      if (typeof o.grandTotal === 'number' && Number.isFinite(o.grandTotal) && o.grandTotal > 0) {
        lineTotal = o.grandTotal;
      } else {
        lineTotal = o.totalAmount + lineTax;
      }
      lineTax = Number.isFinite(lineTax) ? lineTax : 0;
      lineTotal = Number.isFinite(lineTotal) ? lineTotal : 0;
      rev += lineTotal;
      tax += lineTax;
      preTax += Number.isFinite(o.totalAmount) ? o.totalAmount : 0;
    }
    return { realRevenue: rev, realTax: tax, realPreTax: preTax };
  }, [completedPeriod]);

  // ── Combined stats ──────────────────────────────────────────────────────────
  const bl             = BASELINE[period];
  const totalRevenue   = bl.revenue        + realRevenue;
  const totalTax       = realTax;       // baseline has no tax component
  const totalPreTax    = bl.revenue      + realPreTax;
  const totalOrders    = bl.orders         + completedPeriod.length;
  const completedTotal = bl.completedOrders + completedPeriod.length;
  const avgOrderValue  = completedTotal > 0 ? totalRevenue / completedTotal : 0;
  const openOrders = useMemo(
    () => orders.filter(o => ['New', 'Preparing', 'Ready'].includes(o.status)).length,
    [orders],
  );

  // ── Chart: baseline per bucket + real completed revenue per bucket ──────────
  const chartData = useMemo<ChartPoint[]>(() => {
    const cfg       = CHART_CONFIG[period];
    const realRev   = new Array(cfg.labels.length).fill(0);
    const realCount = new Array(cfg.labels.length).fill(0);

    completedPeriod.forEach(o => {
      const idx = cfg.getBucket(new Date(o.paidAt || o.createdAt));
      if (idx >= 0 && idx < cfg.labels.length) {
        let total = 0;
        if (typeof o.grandTotal === 'number' && Number.isFinite(o.grandTotal) && o.grandTotal > 0) {
          total = o.grandTotal;
        } else {
          const rate =
            typeof o.taxRate === 'number' && Number.isFinite(o.taxRate) ? o.taxRate : getTaxRate();
          const tax =
            typeof o.taxAmount === 'number' && Number.isFinite(o.taxAmount)
              ? o.taxAmount
              : o.totalAmount * rate;
          total = o.totalAmount + tax;
        }
        if (Number.isFinite(total)) {
          realRev[idx] += total;
          realCount[idx] += 1;
        }
      }
    });

    return cfg.labels.map((label, i) => ({
      label,
      value:       cfg.base[i] + realRev[i],
      realRevenue: realRev[i],
      orders:      realCount[i],
    }));
  }, [completedPeriod, period]);

  // ── Top items ──────────────────────────────────────────────────────────────
  // 'Today'  → pure real data: aggregate items ONLY from today's paid orders.
  //            An item appears here only if it was actually sold and paid for today.
  // Others   → baseline boost + real period orders merged on top so that
  //            'This Year' always shows thousands of sales, not just a handful.
  const topItems = useMemo<TopItem[]>(() => {
    const map: Record<string, TopItem> = {};

    completedPeriod.forEach(order => {
      // Resolve the order's actual grand total from the frozen snapshot so the
      // per-item revenue allocation matches what the dashboard / reports show.
      const rate =
        typeof order.taxRate === 'number' && Number.isFinite(order.taxRate)
          ? order.taxRate
          : getTaxRate();
      const orderTax =
        typeof order.taxAmount === 'number' && Number.isFinite(order.taxAmount)
          ? order.taxAmount
          : order.totalAmount * rate;
      const orderTotal =
        typeof order.grandTotal === 'number' && Number.isFinite(order.grandTotal) && order.grandTotal > 0
          ? order.grandTotal
          : Math.max(0, order.totalAmount + orderTax);

      // Allocate the order's real grand total proportionally by line subtotal.
      const lineSubtotal = order.items.reduce(
        (s, i) => s + i.price * i.quantity, 0
      ) || 1;
      order.items.forEach(item => {
        if (!map[item.name]) map[item.name] = { name: item.name, count: 0, revenue: 0 };
        const fraction = (item.price * item.quantity) / lineSubtotal;
        map[item.name].count += item.quantity;
        map[item.name].revenue += orderTotal * fraction;
      });
    });

    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [completedPeriod]);

  // ── Status breakdown: uses ALL real orders (live kitchen board view) ────────
  // Not period-filtered — represents the current operational state of the kitchen.
  // Percentages are calculated against orders.length, not a baseline total,
  // so they reflect the true split of work happening right now.
  const statusBreakdown = useMemo(
    () =>
      (['New', 'Preparing', 'Ready', 'Completed', 'Cancelled'] as OrderStatus[])
        .map(status => ({ status, count: orders.filter(o => o.status === status).length }))
        .filter(x => x.count > 0),
    [orders],
  );
  const allOrdersTotal = orders.length;

  // ── Activity feed: newest 5 of ALL orders (Dashboard live feed) ────────────
  const recentOrders = useMemo(
    () =>
      [...orders]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5),
    [orders],
  );

  // ── Transactions: newest 5 completed in period (Reports page) ─────────────
  const recentTransactions = useMemo(
    () =>
      [...completedPeriod]
        .sort((a, b) => new Date(b.paidAt || b.createdAt).getTime() - new Date(a.paidAt || a.createdAt).getTime())
        .slice(0, 5),
    [completedPeriod],
  );

  return {
    loading,
    error,
    totalRevenue,
    totalTax,
    totalPreTax,
    totalOrders,
    avgOrderValue,
    openOrders,
    menuItemsCount:          menuItems.length,
    availableMenuItemsCount: menuItems.filter(i => i.available).length,
    menuItems,
    realRevenue,
    realOrders: completedPeriod.length,
    chartData,
    topItems,
    statusBreakdown,
    allOrdersTotal,
    recentOrders,
    recentTransactions,
    periodOrders,
    completedPeriod,
    period,
  };
}
