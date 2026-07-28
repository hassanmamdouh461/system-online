/**
 * dailyTelegramReport — builds the AUTOMATIC daily sales report message.
 *
 * Until now the Telegram "daily report" only existed as a manual button in
 * ManagerDashboard; the `reportTime` field saved by TelegramConfigModal was
 * never read anywhere, so the scheduled send silently did nothing.
 *
 * This module is the single builder for the automatic report. It intentionally
 * lives OUTSIDE the dashboard component so it is unit-testable and can be
 * driven by a scheduler hook (useDailyTelegramReport) without depending on
 * which tab the manager happens to be looking at.
 *
 * Parity notes vs the manual dashboard report (activeTab === 'analytics'):
 *   • Revenue / paid orders  → paymentStatus 'Paid' & not Cancelled, bucketed
 *     by revenueTimestamp (paidAt || createdAt) through inBusinessPeriod —
 *     identical to useAnalytics.completedPeriod for 'Today'.
 *   • Total order count      → ALL non-cancelled orders created today
 *     (countTimestamp = createdAt) — identical to analytics' periodOrders count.
 *   • Cash/Card split        → frozen grand totals via getOrderMoney, same
 *     piaster-exact money helpers (sumMoneyBy / moneyPercent) as the dashboard.
 *   • Top items              → quantity-sorted top 5 across today's paid
 *     orders — same shape as analytics.topItems.
 */
import type { Order } from '../types/order';
import { getOrderMoney } from '../types/order';
import { inBusinessPeriod, revenueTimestamp, countTimestamp, getDayStartHour } from './businessDay';
import {
  addMoney,
  sumMoneyBy,
  moneyPercent,
  formatMoney,
} from './money';
import { escapeTelegramHtml } from '../services/telegramService';

export interface DailyReportStats {
  /** Sum of frozen grand totals across today's PAID orders (piaster-exact). */
  totalRevenue: number;
  /** All non-cancelled orders created today (Paid + Unpaid + OnAccount). */
  totalOrdersCount: number;
  /** Number of paid orders (the revenue-producing subset). */
  paidOrdersCount: number;
  cashAmount: number;
  cardAmount: number;
  cashPercentage: number;
  cardPercentage: number;
  takeawayCount: number;
  dineInCount: number;
  /** Outstanding (Unpaid / OnAccount, non-cancelled) grand total. */
  unpaidAmount: number;
  unpaidCount: number;
  topItems: { name: string; count: number }[];
}

/**
 * Compute today's figures from the full order list.
 * `now` and `startHour` are injectable for deterministic tests.
 */
export function computeDailyReportStats(
  orders: readonly Order[],
  taxRate: number,
  now: Date = new Date(),
  startHour: number = getDayStartHour(),
): DailyReportStats {
  const dayOrders = orders.filter(
    o => o.status !== 'Cancelled' && inBusinessPeriod(countTimestamp(o), 'Today', startHour, now),
  );

  const paid = orders.filter(
    o =>
      o.paymentStatus === 'Paid' &&
      o.status !== 'Cancelled' &&
      inBusinessPeriod(revenueTimestamp(o), 'Today', startHour, now),
  );

  const orderTotal = (o: Order) => getOrderMoney(o, taxRate).grandTotal;

  const totalRevenue = sumMoneyBy(paid, orderTotal);
  const cashAmount = sumMoneyBy(
    paid.filter(o => o.paymentMethod === 'Cash'),
    orderTotal,
  );
  const cardAmount = sumMoneyBy(
    paid.filter(o => o.paymentMethod === 'Card'),
    orderTotal,
  );
  const cashCardTotal = addMoney(cashAmount, cardAmount);

  const unpaid = dayOrders.filter(
    o => o.paymentStatus === 'Unpaid' || o.paymentStatus === 'OnAccount',
  );

  const itemCounts = new Map<string, number>();
  paid.forEach(order => {
    (order.items || []).forEach(item => {
      if (!item || typeof item.name !== 'string') return;
      itemCounts.set(item.name, (itemCounts.get(item.name) || 0) + (Number(item.quantity) || 0));
    });
  });
  const topItems = Array.from(itemCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalRevenue,
    totalOrdersCount: dayOrders.length,
    paidOrdersCount: paid.length,
    cashAmount,
    cardAmount,
    cashPercentage: moneyPercent(cashAmount, cashCardTotal),
    cardPercentage: moneyPercent(cardAmount, cashCardTotal),
    takeawayCount: paid.filter(o => o.tableId === 'Takeaway').length,
    dineInCount: paid.filter(o => o.tableId !== 'Takeaway').length,
    unpaidAmount: sumMoneyBy(unpaid, orderTotal),
    unpaidCount: unpaid.length,
    topItems,
  };
}

/**
 * Render the Telegram HTML message for the daily report.
 * All dynamic, user-controlled values (branch name, item names) are escaped
 * for Telegram's HTML parser at the boundary.
 */
export function buildDailyReportMessage(
  stats: DailyReportStats,
  branchName: string,
  now: Date = new Date(),
): string {
  const safeBranch = escapeTelegramHtml(branchName);
  const todayStr = now.toLocaleDateString('en-CA');

  let message = `📊 <b>التقرير اليومي التلقائي: ${safeBranch}</b>\n`;
  message += `⏱️ بتاريخ: <code>${todayStr}</code>\n\n`;

  message += `💰 <b>الملخص المالي لليوم:</b>\n`;
  message += `• إجمالي المبيعات (المحصلة): <b>${formatMoney(stats.totalRevenue)}</b> ج.م\n`;
  message += `• عدد الطلبات الكلي: <b>${stats.totalOrdersCount}</b> طلب\n`;
  message += `• إجمالي الآجل: <b>${formatMoney(stats.unpaidAmount)}</b> ج.م\n\n`;

  message += `💳 <b>تفاصيل طرق الدفع (المحصلة):</b>\n`;
  message += `• نقدي (Cash): <b>${formatMoney(stats.cashAmount)}</b> ج.م (${stats.cashPercentage}%)\n`;
  message += `• شبكة/بطاقة (Card): <b>${formatMoney(stats.cardAmount)}</b> ج.م (${stats.cardPercentage}%)\n\n`;

  message += `🍽️ <b>أنواع الطلبات (المحصلة):</b>\n`;
  message += `• سفري (Takeaway): <b>${stats.takeawayCount}</b> طلب\n`;
  message += `• صالة (Dine-in): <b>${stats.dineInCount}</b> طلب\n\n`;

  if (stats.topItems.length > 0) {
    message += `☕ <b>أكثر الأصناف مبيعاً اليوم:</b>\n`;
    stats.topItems.forEach(item => {
      message += `• ${escapeTelegramHtml(item.name)}: عدد <b>${item.count}</b>\n`;
    });
    message += `\n`;
  }

  message += `🤖 تم إرسال هذا التقرير تلقائياً في الموعد المحدد من إعدادات التليجرام`;
  return message;
}
