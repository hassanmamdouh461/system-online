import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for cashier menu writes poisoning the sync queue.
 *
 * menu_items and recipes are in the Worker's CASHIER_READONLY_TABLES, so a
 * cashier write can only 403 on the server and leave a dead sync-queue row
 * ("failed" badge, stalled retries). The client must never enqueue/push menu
 * writes from a cashier session — mirroring canPushSettingKey for settings.
 * Local IndexedDB writes are unaffected; only the doomed cloud round-trip is
 * suppressed.
 *
 * An UNKNOWN role must be RESOLVED, not assumed either way. getSessionRole() is
 * in-memory and therefore null after every page reload: treating that as "not a
 * manager" made a manager's menu delete skip both the cloud push and the
 * sync-queue row, so the deletion lived only in this browser and clearing the
 * cache resurrected the item. The gate now probes the session (the 12h cookie
 * answers without a password) before deciding.
 *
 * The repository module touches IndexedDB at import time, so this guard
 * asserts the gate directly in the module source.
 */
const src = readFileSync(resolve(__dirname, './IndexedDbMenuRepository.ts'), 'utf8');

describe('cashier menu writes are gated off the cloud', () => {
  it('has a manager-only menu push gate driven by the session role', () => {
    expect(src).toContain('async function canPushMenuWrite()');
    expect(src).toContain("return role === 'manager'");
  });

  it('an unknown role is resolved against the Worker, never assumed', () => {
    const gate = src.match(
      /async function canPushMenuWrite\(\)[\s\S]{0,1200}?await refreshCloudSessionRole\(\);[\s\S]{0,80}?return resolved === 'manager';/,
    );
    expect(gate, 'canPushMenuWrite probes the session when the role is null').not.toBeNull();
  });

  it('pushMenuImmediate returns early for a cashier instead of enqueueing', () => {
    const gate = src.match(
      /async function pushMenuImmediate[\s\S]{0,200}?if \(!\(await canPushMenuWrite\(\)\)\) \{/,
    );
    expect(gate).not.toBeNull();
  });

  it('bootstrapPushAll is gated too (a cashier must not bulk-push the menu)', () => {
    const gate = src.match(
      /async bootstrapPushAll[\s\S]{0,250}?if \(!\(await canPushMenuWrite\(\)\)\) return 0;/,
    );
    expect(gate).not.toBeNull();
  });
});
