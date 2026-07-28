import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for the settled_order_immutable conflict path.
 *
 * Scenario: a cashier edits an order offline on device A while device B
 * settles (pays) the same order. When A's queued write reaches the Worker it
 * gets 403 settled_order_immutable. The sync service must NOT retire that
 * record as dead — it is a merge conflict, not a permission denial. The
 * record stays retryable so that, after hydration pulls the settled remote
 * row, mergeOrderRecords can latch the Paid/Refunded state.
 *
 * SyncService touches IndexedDB/network at import time, so this guard asserts
 * the decision structure directly in the module source.
 */
const src = readFileSync(resolve(__dirname, './syncService.ts'), 'utf8');

describe('syncService 403 handling', () => {
  it('parses the worker machine-readable error code', () => {
    expect(src).toContain('extractServerCode');
  });

  it('keeps settled_order_immutable records retryable instead of retiring them dead', () => {
    // The settled_order_immutable branch must schedule a retry, not retire.
    const branch = src.match(
      /settled_order_immutable'[\s\S]{0,200}?scheduleRetry\(record, msg\);/,
    );
    expect(branch).not.toBeNull();
    // ...and within that branch it must never mark the record dead.
    expect(branch![0]).not.toContain('retirePermanently');
  });

  it('still retires other (genuine) 403 permission denials', () => {
    // The generic 403 path after the settled_order_immutable carve-out still
    // retires the record permanently.
    const generic = src.match(
      /settled_order_immutable[\s\S]{0,400}?retirePermanently\(record, msg\);/,
    );
    expect(generic).not.toBeNull();
  });
});
