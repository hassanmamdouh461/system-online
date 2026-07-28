/**
 * Unit tests for the cross-tab optimistic send lock in the automatic daily
 * Telegram report (issue: two due tabs could both send in the same minute).
 *
 * tryAcquireReportLock / releaseReportLock are pure localStorage helpers
 * exported from the hook module, so they run in the Node environment against
 * the same in-memory localStorage mock used by dailyTelegramReport.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { tryAcquireReportLock, releaseReportLock } from './useDailyTelegramReport';

// ─── Minimal in-memory localStorage for the Node test environment ────────────
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
};
(globalThis as any).localStorage = localStorageMock;

const LOCK_KEY = 'brewmaster_telegram_report_lock';
const T0 = 1_800_000_000_000; // fixed epoch-ms

beforeEach(() => {
  store.clear();
});

describe('tryAcquireReportLock', () => {
  it('grants the lock to the first tab and stamps a timestamp', () => {
    expect(tryAcquireReportLock(T0)).toBe(true);
    expect(store.get(LOCK_KEY)).toBe(String(T0));
  });

  it('denies a second tab while the first lock is still fresh (< 2 min)', () => {
    expect(tryAcquireReportLock(T0)).toBe(true); // tab A
    // 30s later tab B ticks → lock still live → skipped.
    expect(tryAcquireReportLock(T0 + 30_000)).toBe(false);
    // 119s later → still within TTL → skipped.
    expect(tryAcquireReportLock(T0 + 119_000)).toBe(false);
  });

  it('reclaims an expired lock (>= 2 min) so a crashed sender never blocks the day', () => {
    expect(tryAcquireReportLock(T0)).toBe(true);
    // 2 minutes and 1ms later → the original lock is considered abandoned.
    expect(tryAcquireReportLock(T0 + 120_001)).toBe(true);
    expect(store.get(LOCK_KEY)).toBe(String(T0 + 120_001));
  });

  it('releaseReportLock frees the lock so a retry is not blocked', () => {
    expect(tryAcquireReportLock(T0)).toBe(true);
    releaseReportLock();
    expect(store.has(LOCK_KEY)).toBe(false);
    // Immediately re-acquirable after a failure released it.
    expect(tryAcquireReportLock(T0 + 1_000)).toBe(true);
  });

  it('fails open when localStorage throws (private mode) so the report still sends', () => {
    const real = (globalThis as any).localStorage;
    (globalThis as any).localStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(tryAcquireReportLock(T0)).toBe(true);
    (globalThis as any).localStorage = real;
  });
});
