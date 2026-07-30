import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for the refund that came back from the dead.
 *
 * Scenario: a manager refunds a paid invoice. The Worker's last-writer-wins
 * freshness guard discards the write (the stored row's updatedAt was NULL, so
 * `excluded.updatedAt > orders.updatedAt` evaluated to NULL, never true) and
 * answers HTTP 200 with `stale: true`. The client read only `response.ok`/
 * `res.ok`, so it marked the queue row synced and let it be purged 24h later.
 * The refund lived only in IndexedDB — until the browser cache was cleared, at
 * which point hydration pulled the untouched `Paid` row back out of D1 and the
 * invoice reappeared with its revenue.
 *
 * Both push paths must now inspect the BODY, not just the status, and a
 * discarded order write must be rebased against the server row instead of
 * retried unchanged (an identical payload loses the same comparison again).
 *
 * These modules touch IndexedDB/network at import time, so the guards assert
 * the decision structure directly in the module source.
 */
const syncSrc = readFileSync(resolve(__dirname, './syncService.ts'), 'utf8');
const cloudSrc = readFileSync(resolve(__dirname, './cloudConfig.ts'), 'utf8');
const rebaseSrc = readFileSync(resolve(__dirname, './orderRebase.ts'), 'utf8');

describe('syncService stale-write handling', () => {
  it('inspects the 200 body instead of trusting response.ok alone', () => {
    expect(syncSrc).toContain('extractStaleFlag');
    const okBranch = syncSrc.match(/if \(response\.ok\) \{[\s\S]{0,2000}?record\.synced = 1;/);
    expect(okBranch).not.toBeNull();
    // The stale check must come BEFORE the record is marked synced.
    expect(okBranch![0]).toContain('extractStaleFlag');
  });

  it('never marks a stale-discarded write as synced', () => {
    const handler = syncSrc.match(/private async handleStaleWrite\([\s\S]*?\n {2}\}/);
    expect(handler).not.toBeNull();
    expect(handler![0]).not.toContain('record.synced = 1');
  });

  it('rebases a discarded order write instead of resending the same payload', () => {
    const handler = syncSrc.match(/private async handleStaleWrite\([\s\S]*?\n {2}\}/);
    expect(handler![0]).toContain('rebaseOrderAgainstRemote');
  });

  it('still bounds the retries so a permanently-losing record cannot spin forever', () => {
    const handler = syncSrc.match(/private async handleStaleWrite\([\s\S]*?\n {2}\}/);
    expect(handler![0]).toContain('MAX_ATTEMPTS');
    expect(handler![0]).toContain('record.attempts');
  });
});

describe('cloudUpsert stale-write handling', () => {
  it('treats a stale-discarded 200 as a failed write', () => {
    expect(cloudSrc).toContain('responseWasDiscardedAsStale');
  });

  it('does not ack the sync queue when the write was discarded', () => {
    // The stale check must sit between the res.ok check and ackSyncQueueForEntity,
    // otherwise the queue row is dropped for a write that never landed.
    const upsert = cloudSrc.match(/export async function cloudUpsert\([\s\S]*?\n\}/);
    expect(upsert).not.toBeNull();
    const staleAt = upsert![0].indexOf('responseWasDiscardedAsStale');
    const ackAt = upsert![0].indexOf('ackSyncQueueForEntity');
    expect(staleAt).toBeGreaterThan(-1);
    expect(ackAt).toBeGreaterThan(staleAt);
  });

  it('reads a clone so the caller can still consume the body', () => {
    expect(cloudSrc).toContain('res.clone().json()');
  });
});

describe('orderRebase', () => {
  it('merges through mergeOrderRecords so terminal states stay latched', () => {
    expect(rebaseSrc).toContain('mergeOrderRecords');
  });

  it('stamps a timestamp that beats the server row even under clock skew', () => {
    expect(rebaseSrc).toContain('Math.max(Date.now(), remoteMs + 1)');
  });
});
