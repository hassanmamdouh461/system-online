import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BACKUP_STALE_AFTER_MS, isBackupStale, newerTimestamp } from './backupFreshness';

/**
 * Regression guard: the backup-staleness alarm was dead.
 *
 * Settings read "last successful backup: never" while D1 was healthy and writes
 * were landing, because the Worker returned no last-write marker at all and the
 * client's only other signal — the LOCAL sync queue high-water mark — is empty
 * on a device that has only ever read.
 *
 * The real damage was in App.tsx: `lastGood = sync?.lastSuccessAt || health.lastWriteAt`
 * was null on both sides, so the "stale" branch could never be taken. The red
 * banner only appeared on a total worker outage — exactly the failure it was
 * NOT built for.
 */

const HOUR = 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('backup freshness', () => {
  it('flags a write older than six hours as stale (this branch was unreachable)', () => {
    expect(isBackupStale(iso(7 * HOUR))).toBe(true);
  });

  it('leaves a recent write alone', () => {
    expect(isBackupStale(iso(1 * HOUR))).toBe(false);
    expect(BACKUP_STALE_AFTER_MS).toBe(6 * HOUR);
  });

  it('treats an unknown timestamp as unknown, never as stale', () => {
    // Otherwise every fresh page load would cry wolf.
    expect(isBackupStale(null)).toBe(false);
    expect(isBackupStale('not-a-date')).toBe(false);
  });

  it('takes the newer of the local queue mark and the cloud marker', () => {
    const older = iso(9 * HOUR);
    const newer = iso(1 * HOUR);
    expect(newerTimestamp(older, newer)).toBe(newer);
    expect(newerTimestamp(newer, older)).toBe(newer);
  });

  it('a read-only device (empty local queue) still learns the cloud write time', () => {
    const cloud = iso(2 * HOUR);
    const lastGood = newerTimestamp(null, cloud);
    expect(lastGood).toBe(cloud);
    expect(isBackupStale(lastGood)).toBe(false);
  });

  it('a read-only device sees the alarm when the CLOUD has been quiet for 7h', () => {
    // The exact scenario the alarm exists for, and the one it used to miss.
    const lastGood = newerTimestamp(null, iso(7 * HOUR));
    expect(isBackupStale(lastGood)).toBe(true);
  });
});

describe('wiring', () => {
  const cloudConfig = readFileSync(resolve(__dirname, '../services/cloudConfig.ts'), 'utf8');
  const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
  const badge = readFileSync(resolve(__dirname, '../components/ui/DatabaseStatus.tsx'), 'utf8');

  it('the client reads the marker from the session-protected route', () => {
    expect(cloudConfig).toContain('export async function fetchCloudLastWrite');
    expect(cloudConfig).toContain("cloudFetch('/api/status'");
  });

  it('the public health probe is never asked for a timestamp again', () => {
    // /api/health must stay public AND clean — reading a timestamp from it is
    // what pressured the endpoint to leak operational detail in the first place.
    expect(cloudConfig).not.toContain('lastWriteAt: body.lastWriteAt');
  });

  it('the red banner and the settings badge both consume the cloud marker', () => {
    expect(app).toContain('fetchCloudLastWrite()');
    expect(app).toContain('isBackupStale(');
    expect(badge).toContain('fetchCloudLastWrite()');
    expect(badge).toContain('isBackupStale(');
  });

  it('neither surface still falls back to health.lastWriteAt', () => {
    expect(app).not.toContain('health.lastWriteAt');
    expect(badge).not.toContain('result.lastWriteAt');
  });
});
