import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  performRefund,
  RefundRejectedError,
  type RefundFlowDeps,
  type RefundPushResult,
  type SessionRole,
} from './refundOrderFlow';
import type { Order } from '../types/order';

/**
 * Production incident (2026-08-03): a refund showed as "Refunded" on the till
 * while D1 still held "Paid" for the same order (ord_1785773449245_g46ym). The
 * console showed the cause — both the direct upsert and /api/sync answered 403
 * `refund_requires_escalation` — but the till had already written the refund
 * locally, so the two stores disagreed permanently and every other device kept
 * counting the sale as revenue.
 *
 * Two defects behind it, both covered here:
 *   1. local-first ordering: the refund was applied before the server agreed;
 *   2. authority read from this tab's memory, while the session cookie (shared
 *      by every tab in the browser) may have been re-minted as a cashier.
 */
const ORDER = {
  id: 'ord_1785773449245_g46ym',
  paymentStatus: 'Paid',
  status: 'New',
} as unknown as Order;

const REFUNDED = { ...ORDER, paymentStatus: 'Refunded', status: 'Cancelled' } as Order;

type Harness = {
  deps: RefundFlowDeps;
  applyLocal: ReturnType<typeof vi.fn>;
  restoreInventory: ReturnType<typeof vi.fn>;
  pushRefund: ReturnType<typeof vi.fn>;
  remintSession: ReturnType<typeof vi.fn>;
  triggerSync: ReturnType<typeof vi.fn>;
};

function harness(overrides: {
  cloudConfigured?: boolean;
  probed?: SessionRole | null;
  cached?: SessionRole | null;
  pin?: boolean;
  canRemint?: boolean;
  pushes?: RefundPushResult[];
  remintSucceeds?: boolean;
  probedAfterRemint?: SessionRole | null;
}): Harness {
  const pushes = overrides.pushes ?? [{ kind: 'ok' }];
  let pushCall = 0;
  const pushRefund = vi.fn(async () => pushes[Math.min(pushCall++, pushes.length - 1)]);
  const applyLocal = vi.fn(async () => REFUNDED);
  const restoreInventory = vi.fn(async () => {});
  const remintSession = vi.fn(async () => overrides.remintSucceeds ?? true);
  const triggerSync = vi.fn();

  const deps: RefundFlowDeps = {
    isCloudConfigured: () => overrides.cloudConfigured ?? true,
    ensureSession: async () => true,
    probeRole: async () => overrides.probed ?? null,
    cachedRole: () => overrides.cached ?? null,
    hasRefundPin: () => overrides.pin ?? false,
    canRemint: () => overrides.canRemint ?? false,
    remintSession,
    pushRefund,
    applyLocal,
    restoreInventory,
    triggerSync,
  };
  return { deps, applyLocal, restoreInventory, pushRefund, remintSession, triggerSync };
}

const run = (h: Harness) => performRefund(h.deps, () => REFUNDED);

describe('performRefund — the server decides before this device moves', () => {
  it('applies the refund locally only after the cloud accepted it', async () => {
    const h = harness({ probed: 'manager' });

    const result = await run(h);

    expect(result).toBe(REFUNDED);
    expect(h.pushRefund).toHaveBeenCalledTimes(1);
    expect(h.applyLocal).toHaveBeenCalledTimes(1);
    expect(h.restoreInventory).toHaveBeenCalledTimes(1);
    // Ordering is the whole fix: cloud push strictly before the local write.
    expect(h.pushRefund.mock.invocationCallOrder[0]).toBeLessThan(
      h.applyLocal.mock.invocationCallOrder[0]
    );
  });

  it('leaves this device untouched when the server refuses (the divergence bug)', async () => {
    const h = harness({
      probed: 'manager',
      pushes: [
        {
          kind: 'denied',
          code: 'refund_requires_escalation',
          message: 'الاسترجاع يحتاج رمز تصعيد صحيح أو صلاحية مدير.',
        },
      ],
    });

    await expect(run(h)).rejects.toBeInstanceOf(RefundRejectedError);

    // Nothing local happened: no "Refunded" on the till while D1 says "Paid".
    expect(h.applyLocal).not.toHaveBeenCalled();
    expect(h.restoreInventory).not.toHaveBeenCalled();
  });

  it('surfaces the server\'s own reason to the operator', async () => {
    const h = harness({
      probed: 'manager',
      pushes: [{ kind: 'denied', code: 'refund_requires_escalation', message: 'رسالة السيرفر' }],
    });

    await expect(run(h)).rejects.toMatchObject({
      code: 'refund_requires_escalation',
      message: 'رسالة السيرفر',
    });
  });
});

describe('performRefund — authority comes from the server, not this tab', () => {
  it('re-probes the role instead of trusting the cached one', async () => {
    // The tab remembers "manager" (it logged in as one), but another tab has
    // since re-minted the shared cookie as a cashier. Server wins.
    const h = harness({ cached: 'manager', probed: 'cashier' });

    await expect(run(h)).rejects.toMatchObject({ code: 'refund_requires_manager' });
    expect(h.pushRefund).not.toHaveBeenCalled();
    expect(h.applyLocal).not.toHaveBeenCalled();
  });

  it('re-mints once and retries when a manager tab finds its cookie downgraded', async () => {
    const h = harness({
      cached: 'manager',
      probed: 'cashier',
      pin: true, // held PIN gets us past the pre-check; the server still refuses
      canRemint: true,
      pushes: [
        { kind: 'denied', code: 'refund_requires_escalation', message: 'no' },
        { kind: 'ok' },
      ],
    });

    const result = await run(h);

    expect(h.remintSession).toHaveBeenCalledTimes(1);
    expect(h.pushRefund).toHaveBeenCalledTimes(2);
    expect(result).toBe(REFUNDED);
    expect(h.applyLocal).toHaveBeenCalledTimes(1);
  });

  it('re-mints on a lapsed session (401) and retries', async () => {
    const h = harness({
      probed: 'manager',
      canRemint: true,
      pushes: [{ kind: 'unauthenticated' }, { kind: 'ok' }],
    });

    await run(h);

    expect(h.remintSession).toHaveBeenCalledTimes(1);
    expect(h.applyLocal).toHaveBeenCalledTimes(1);
  });

  it('does not retry forever — one re-mint, then it reports the refusal', async () => {
    const h = harness({
      cached: 'manager',
      probed: 'cashier',
      pin: true,
      canRemint: true,
      pushes: [
        { kind: 'denied', code: 'refund_requires_escalation', message: 'no' },
        { kind: 'denied', code: 'refund_requires_escalation', message: 'no' },
      ],
    });

    await expect(run(h)).rejects.toBeInstanceOf(RefundRejectedError);
    expect(h.remintSession).toHaveBeenCalledTimes(1);
    expect(h.pushRefund).toHaveBeenCalledTimes(2);
    expect(h.applyLocal).not.toHaveBeenCalled();
  });
});

describe('performRefund — the escalation PIN is alive again', () => {
  it('lets a cashier holding the PIN complete a refund', async () => {
    // Before the fix this threw refund_requires_manager before any request, so
    // the PIN field in PaymentModal (and X-Refund-PIN in both request paths)
    // could never be exercised.
    const h = harness({ probed: 'cashier', pin: true });

    const result = await run(h);

    expect(result).toBe(REFUNDED);
    expect(h.pushRefund).toHaveBeenCalledTimes(1);
  });

  it('still refuses a cashier with no PIN, without touching the network', async () => {
    const h = harness({ probed: 'cashier', pin: false });

    await expect(run(h)).rejects.toMatchObject({ code: 'refund_requires_manager' });
    expect(h.pushRefund).not.toHaveBeenCalled();
  });

  it('lets the server reject a WRONG pin — the client does not validate it', async () => {
    const h = harness({
      probed: 'cashier',
      pin: true,
      pushes: [{ kind: 'denied', code: 'refund_requires_escalation', message: 'رمز غير صحيح' }],
    });

    await expect(run(h)).rejects.toMatchObject({ message: 'رمز غير صحيح' });
    expect(h.applyLocal).not.toHaveBeenCalled();
  });
});

describe('performRefund — connectivity', () => {
  it('refuses when authority cannot be established at all', async () => {
    const h = harness({ probed: null, pin: false });

    await expect(run(h)).rejects.toBeInstanceOf(RefundRejectedError);
    expect(h.pushRefund).not.toHaveBeenCalled();
    expect(h.applyLocal).not.toHaveBeenCalled();
  });

  it('queues the refund when the server was authorised but then unreachable', async () => {
    const h = harness({ probed: 'manager', pushes: [{ kind: 'unreachable' }] });

    const result = await run(h);

    expect(result).toBe(REFUNDED);
    expect(h.applyLocal).toHaveBeenCalledTimes(1);
    expect(h.triggerSync).toHaveBeenCalledTimes(1);
  });

  it('refunds locally with no cloud configured at all', async () => {
    const h = harness({ cloudConfigured: false });

    const result = await run(h);

    expect(result).toBe(REFUNDED);
    expect(h.pushRefund).not.toHaveBeenCalled();
    expect(h.applyLocal).toHaveBeenCalledTimes(1);
  });
});

describe('DataContext wires the refund through the guarded flow', () => {
  const src = readFileSync(resolve(__dirname, '../context/DataContext.tsx'), 'utf8');
  const refundFn = src.slice(
    src.indexOf('const refundOrder = useCallback'),
    src.indexOf('const updateOrder = useCallback')
  );

  it('never writes the refund locally on its own', () => {
    expect(refundFn).toContain('performRefund(');
    // The old shape — mutate first, then hope the sync lands — is gone.
    expect(refundFn).not.toMatch(/await\s+orderRepository\.update\(/);
    expect(refundFn).not.toContain("throw new Error('refund_requires_manager')");
  });

  it('treats a held PIN as authority and re-probes the role', () => {
    expect(refundFn).toContain('hasRefundPin');
    expect(refundFn).toContain('refreshCloudSessionRole');
  });
});
