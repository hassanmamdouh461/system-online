/**
 * useDailyTelegramReport — the scheduler that makes `reportTime` real.
 *
 * TelegramConfigModal has always saved an `enabled` flag and a `reportTime`
 * ("HH:MM") into brewmaster_telegram_config, but NOTHING ever read them —
 * the "automatic daily report" feature existed only in the UI. This hook is
 * the missing consumer: while the manager's dashboard is open it checks the
 * clock once a minute and, at the configured time, sends exactly one daily
 * sales report through the shared telegramService.
 *
 * Design constraints honoured here:
 *   • DEVICE-LOCAL by design: the bot token is deliberately kept out of the
 *     cloud (see setTelegramConfig), so the report can only be sent from the
 *     manager device that holds the credentials — which is where this hook
 *     runs. No Worker cron change is required.
 *   • AT-MOST-ONCE PER DAY: a localStorage latch (brewmaster_telegram_last_auto_report)
 *     records the business-day key of the last successful send, so a page
 *     reload or a second dashboard tab never double-sends the same day.
 *   • SILENT: no alert()/toast spam on a timer. Success/failure is logged to
 *     the console; failures clear the latch so the next minute's tick retries.
 *   • ZERO-SALE DAYS still send: the manager asked for a daily report; a
 *     quiet day is information, not an error. (The manual button keeps its
 *     "nothing to send" guard — different surface, different intent.)
 */
import { useEffect, useRef } from 'react';
import { getTelegramConfig, getTaxRate, getBranchConfig } from '../utils/settingsConfig';
import { businessDate, getDayStartHour } from '../utils/businessDay';
import { telegramService } from '../services/telegramService';
import { computeDailyReportStats, buildDailyReportMessage } from '../utils/dailyTelegramReport';
import type { Order } from '../types/order';

/** localStorage latch: business-day key ('YYYY-MM-DD') of the last auto-send. */
const LS_LAST_AUTO_REPORT_KEY = 'brewmaster_telegram_last_auto_report';

/** How often the scheduler wakes up to compare the clock with reportTime. */
const TICK_MS = 60_000;

/**
 * Normalise a stored "HH:MM" reportTime. Returns { h, m } or null when the
 * stored value is unusable (legacy junk, empty string).
 */
export function parseReportTime(raw: string | undefined): { h: number; m: number } | null {
  if (!raw) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/**
 * Local-timezone business-day key ('YYYY-MM-DD') for a Date. businessDayKey()
 * only accepts strings, and routing a Date through toISOString() shifts it to
 * UTC first — which can move the key a whole day for non-UTC timezones. This
 * goes through the same businessDate() helper on the Date directly.
 */
export function localBusinessDayKey(now: Date, startHour: number = getDayStartHour()): string {
  const b = businessDate(now, startHour);
  const y = b.getFullYear();
  const m = String(b.getMonth() + 1).padStart(2, '0');
  const day = String(b.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Should the report fire on this tick?
 * True when local wall-clock time >= today's reportTime AND we have not
 * already sent for the current business day. Fires once per business day —
 * not in every minute between reportTime and midnight.
 */
export function isReportDue(now: Date, reportTime: { h: number; m: number }, lastSentKey: string | null): boolean {
  const startHour = getDayStartHour();
  const todayKey = localBusinessDayKey(now, startHour);
  if (!todayKey) return false;
  if (lastSentKey === todayKey) return false;
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesTarget = reportTime.h * 60 + reportTime.m;
  return minutesNow >= minutesTarget;
}

/**
 * Wire the scheduler. `orders` is the live order list already held by the
 * dashboard (DataContext), so the report reflects exactly what the manager
 * sees on screen — no second fetch, no drift.
 */
export function useDailyTelegramReport(orders: readonly Order[]): void {
  // Latest orders via ref: the interval stays mounted for the dashboard's
  // lifetime while every tick sees the freshest order list (the DataContext
  // array identity changes on every sync, which would otherwise churn the
  // interval).
  const ordersRef = useRef<readonly Order[]>(orders);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;

      const config = getTelegramConfig();
      if (!config.enabled) return;
      if (!config.botToken.trim() || !config.chatId.trim()) return;

      const reportTime = parseReportTime(config.reportTime) ?? { h: 23, m: 0 };
      let lastSentKey: string | null = null;
      try {
        lastSentKey = localStorage.getItem(LS_LAST_AUTO_REPORT_KEY);
      } catch {
        // Private-mode storage read failures: proceed as if never sent.
      }

      const now = new Date();
      if (!isReportDue(now, reportTime, lastSentKey)) return;

      const stats = computeDailyReportStats(ordersRef.current, getTaxRate(), now);
      const message = buildDailyReportMessage(stats, getBranchConfig().branchName, now);

      try {
        await telegramService.sendMessage(config.botToken, config.chatId, message, 'HTML');
        if (cancelled) return;
        try {
          localStorage.setItem(LS_LAST_AUTO_REPORT_KEY, localBusinessDayKey(now, getDayStartHour()));
        } catch {
          // Latch write failed — worst case a reload resends once today.
        }
        console.info('[DailyTelegramReport] Automatic daily report sent.');
      } catch (err) {
        // Leave the latch unset so the next minute retries; surface in console only.
        console.warn('[DailyTelegramReport] Automatic send failed:', err);
      }
    };

    // Fire once on mount so a manager who opens the dashboard AFTER reportTime
    // still gets today's report, then keep ticking.
    void tick();
    const interval = setInterval(() => {
      void tick();
    }, TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
}
