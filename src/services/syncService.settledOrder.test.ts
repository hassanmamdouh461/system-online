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
    // The generic 403 path after the settled_order_immutable and role-mismatch
    // carve-outs still retires the record permanently.
    const generic = src.match(
      /settled_order_immutable[\s\S]{0,2000}?retirePermanently\(record, msg\);/,
    );
    expect(generic).not.toBeNull();
  });

  /**
   * A 403 is only a real denial if we were authenticated AS the role the
   * operator is signed in as. Cookies are per-domain, so a cashier login in a
   * sibling tab could make a MANAGER's queued write execute as a cashier: the
   * Worker answered "تعديل المنيو والوصفات غير مسموح لصلاحية الكاشير" and this
   * path retired the record forever, so the manager's menu delete never reached
   * D1 and no other device ever learned about it.
   */
  it('reconciles the session role before retiring a 403, and retries when it was a mismatch', () => {
    const branch = src.match(
      /reconcileSessionRole\(\)[\s\S]{0,600}?scheduleRetry\(record, msg\);/,
    );
    expect(branch).not.toBeNull();
    // The retry must be conditional on the role having ACTUALLY changed into the
    // declared one — otherwise a correct cashier denial would loop forever.
    expect(branch![0]).toContain('roleBefore !== intent');
    expect(branch![0]).toContain('getSessionRole() === intent');
  });

  it('sends the role intent header so the worker picks this role\'s session', () => {
    expect(src).toContain('roleIntentHeaders()');
  });
});
