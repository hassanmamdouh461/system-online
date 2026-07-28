import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for the manual Telegram report order count.
 *
 * The automatic daily report (utils/dailyTelegramReport) counts ALL
 * non-Cancelled orders via totalOrdersCount. The manual dashboard report
 * used processedData.totalCount — the paid-only completedPeriod count — so
 * the two surfaces disagreed on "عدد الطلبات الكلي". The manual report must
 * use processedData.totalOrdersCount (analytics.totalOrders), the true
 * order volume.
 *
 * The page module mounts React/DOM at import time, so this guard asserts the
 * rendered message field directly in the page source.
 */
const src = readFileSync(resolve(__dirname, './ManagerDashboard.tsx'), 'utf8');

describe('manual Telegram report order count', () => {
  it('reports the true total order volume, not the paid-only count', () => {
    expect(src).toContain('عدد الطلبات الكلي: <b>${processedData.totalOrdersCount}</b>');
    expect(src).not.toContain('عدد الطلبات الكلي: <b>${processedData.totalCount}</b>');
  });

  it('totalOrdersCount is sourced from analytics.totalOrders (all non-Cancelled orders)', () => {
    expect(src).toContain('totalOrdersCount: analytics.totalOrders');
  });
});
