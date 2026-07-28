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
 *     reload or a second dashboard tab never double-sends the same day. An
 *     OPTIMISTIC send lock (brewmaster_telegram_report_lock) is taken BEFORE
 *     the await: the day-latch is only written after the send resolves, so
 *     without the lock two tabs due in the same minute both pass the latch
 *     check and both send. The lock expires after LOCK_TTL_MS so a crashed
 *     sender never blocks the report forever.
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

/** localStorage optimistic lock: epoch-ms timestamp of an in-flight send. */
const LS_REPORT_LOCK_KEY = 'brewmaster_telegram_report_lock';

/** A send lock older than this is considered abandoned (crashed tab) and may be reclaimed. */
const LOCK_TTL_MS = 2 * 60_000;

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
 * Try to take the cross-tab optimistic send lock. Returns true when this tab
 * now holds the lock (or storage is unusable, in which case we fail open and
 * rely on the post-send latch). A live lock younger than LOCK_TTL_MS means
 * another tab is mid-send — the caller must skip this tick. localStorage is
 * synchronous, so the read-check-write here is atomic against other tabs.
 */
export function tryAcquireReportLock(nowMs: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(LS_REPORT_LOCK_KEY);
    const ts = raw === null ? null : Number(raw);
    if (ts !== null && Number.isFinite(ts) && nowMs - ts < LOCK_TTL_MS) {
      return false; // another tab holds a live lock
    }
    localStorage.setItem(LS_REPORT_LOCK_KEY, String(nowMs));
    return true;
  } catch {
    // Private-mode storage failures: fail open so the report still sends once.
    return true;
  }
}

/** Release the send lock so a later retry (after a failure) is not blocked. */
export function releaseReportLock(): void {
  try {
    localStorage.removeItem(LS_REPORT_LOCK_KEY);
  } catch {
    // Ignore — a stale lock simply expires via LOCK_TTL_MS.
  }
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

      // Take the cross-tab lock BEFORE the await below. The day-latch is only
      // written after a successful send, so without this lock two due tabs both
      // pass the latch check in the same minute and both send. A second tab
      // that finds a live lock skips its tick entirely.
      if (!tryAcquireReportLock()) return;

      // Cross-DEVICE claim: the localStorage lock cannot coordinate two
      // different manager devices, so claim the business day on D1 first. Only
      // one manager device wins; the rest get claimed:false and skip (their
      // local lock is released so a legitimately-due retry still works). This
      // is fail-open — when offline/unconfigured it returns true and the local
      // lock above remains the only layer.
      const dayKey = localBusinessDayKey(now, getDayStartHour());
      try {
        const { claimDailyReportLock } = await import('../services/telegramCloudService');
        const claimed = await claimDailyReportLock(dayKey);
        if (!claimed) {
          releaseReportLock();
          return;
        }
      } catch {
        // Fail open: a claim error must not silence a single device's report.
      }

      const stats = computeDailyReportStats(ordersRef.current, getTaxRate(), now);
      const message = buildDailyReportMessage(stats, getBranchConfig().branchName, now);

      try {
        await telegramService.sendMessage(config.botToken, config.chatId, message, 'HTML');
        if (cancelled) {
          releaseReportLock();
          return;
        }
        try {
          localStorage.setItem(LS_LAST_AUTO_REPORT_KEY, dayKey);
        } catch {
          // Latch write failed — worst case a reload resends once today.
        }
        // Success: release the lock; the day-latch now owns dedup for today.
        releaseReportLock();
        console.info('[DailyTelegramReport] Automatic daily report sent.');
      } catch (err) {
        // Release so the next minute's tick (or another tab) may retry; the
        // day-latch was never written, so the report is still due.
        releaseReportLock();
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
