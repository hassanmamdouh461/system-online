import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for the paymentStatus default used when hydrating orders
 * from the cloud (D1 -> IndexedDB). A remote row with a missing/empty
 * paymentStatus must default to 'Unpaid' — matching the Worker and the D1
 * schema — never 'Paid'. Defaulting to 'Paid' counted those rows as collected
 * revenue (phantom income) and hid them from receivables.
 *
 * mapOrder / mapRemoteOrder are module-private and their modules touch
 * IndexedDB at import time, so this guard asserts the defaulting expression
 * directly in the source of both mappers (and the Worker-side twin).
 */
const readSrc = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

describe('cloud hydration paymentStatus default', () => {
  it('cloudHydrate mapOrder defaults a missing paymentStatus to Unpaid', () => {
    const src = readSrc('./cloudHydrate.ts');
    expect(src).toContain("paymentStatus: (doc.paymentStatus as Order['paymentStatus']) || 'Unpaid'");
    expect(src).not.toContain("|| 'Paid'");
  });

  it('IndexedDbOrderRepository mapRemoteOrder defaults a missing paymentStatus to Unpaid', () => {
    const src = readSrc('../repositories/indexeddb/IndexedDbOrderRepository.ts');
    expect(src).toContain("paymentStatus: doc.paymentStatus || 'Unpaid'");
  });

  it('matches the Worker-side default for the same field', () => {
    const worker = readFileSync(
      resolve(__dirname, '../../cloudflare-worker/src/index.ts'),
      'utf8',
    );
    expect(worker).toContain("doc.paymentStatus = row.paymentStatus || 'Unpaid'");
  });
});
