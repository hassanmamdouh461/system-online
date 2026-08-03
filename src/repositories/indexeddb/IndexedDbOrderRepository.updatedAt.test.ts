import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard: a new order MUST carry updatedAt.
 *
 * The Worker's last-writer-wins guard gates the conflict update on
 * `excluded.updatedAt > orders.updatedAt`. create() stamped createdAt but NOT
 * updatedAt, so every order landed in D1 with updatedAt = NULL — and in SQL a
 * comparison against NULL is NULL, never TRUE. The conflict update was therefore
 * dropped for the lifetime of the row: the Worker answered
 * `200 { success: true, stale: true }`, the client read `success` and moved on,
 * and D1 kept the original Unpaid copy forever.
 *
 * Observed damage: a cash invoice settled at the till showed Paid locally while
 * the cloud still said Unpaid, so it reappeared in "pending invoices" on the next
 * hydrate and got collected a SECOND time from the customer; a refund returned
 * cash to the customer while the cloud kept counting the sale as revenue; and the
 * manager's dashboard reported materially less revenue than was actually taken.
 *
 * The repository module touches IndexedDB at import time, so — following the same
 * convention as IndexedDbMenuRepository.cashier.test.ts — this guard asserts the
 * stamp directly in the module source.
 */
const src = readFileSync(resolve(__dirname, './IndexedDbOrderRepository.ts'), 'utf8');

/** Body of `async create(...)` up to the start of the next method. */
function createBody(): string {
  const match = src.match(/async create\([\s\S]*?\n  async /);
  expect(match, 'create() method found in the repository source').not.toBeNull();
  return match![0];
}

describe('order creation stamps updatedAt', () => {
  it('the newOrder literal in create() sets updatedAt', () => {
    expect(createBody()).toMatch(/updatedAt:\s*orderData\.updatedAt\s*\|\|\s*now/);
  });

  it('stamps updatedAt alongside createdAt, not only on update()', () => {
    const body = createBody();
    // Both timestamps must be present in the created row. createdAt alone was
    // exactly the bug: it satisfied the schema while leaving the freshness
    // column NULL.
    expect(body).toContain('createdAt: orderData.createdAt || now');
    expect(body).toContain('updatedAt:');
  });

  it('update() still refreshes updatedAt on every write', () => {
    expect(src).toMatch(/updatedAt:\s*new Date\(\)\.toISOString\(\)/);
  });
});
