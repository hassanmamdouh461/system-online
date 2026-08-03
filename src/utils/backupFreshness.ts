/**
 * How the till decides whether backups are actually alive.
 *
 * There are two independent signals, and BOTH used to be routinely null:
 *   * `syncService.getHealth().lastSuccessAt` — the local sync queue's
 *     high-water mark. Empty on a device that has only ever read, and on any
 *     device that just loaded the page.
 *   * the newest write the CLOUD can see — which the Worker never returned at
 *     all, so the client read `undefined` from /api/health forever.
 *
 * With both null the "stale" branch in App.tsx was unreachable: the red banner
 * only appeared when the Worker was completely down, and the alarm built to
 * catch a SILENT backup failure was, in practice, dead. Settings said
 * "last successful backup: never" while D1 was healthy and writes were landing.
 */

/** Six hours without a single write is the operator's alarm threshold. */
export const BACKUP_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** The newer of two optional ISO timestamps, or null when both are unknown. */
export function newerTimestamp(a?: string | null, b?: string | null): string | null {
  if (!a) return b || null;
  if (!b) return a;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return ta >= tb ? a : b;
}

/**
 * Is the newest known write older than the threshold?
 *
 * An unknown timestamp is NOT stale — it is unknown. Claiming staleness from a
 * missing signal would fire the banner on every fresh page load; the honest
 * answer is to stay quiet until a real timestamp is in hand.
 */
export function isBackupStale(lastWriteAt: string | null, now: number = Date.now()): boolean {
  if (!lastWriteAt) return false;
  const t = new Date(lastWriteAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t > BACKUP_STALE_AFTER_MS;
}
