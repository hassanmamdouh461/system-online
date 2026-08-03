/**
 * The refund decision flow, separated from React so it can be tested honestly.
 *
 * TWO BUGS THIS REPLACES
 * ----------------------
 * 1. LOCAL/CLOUD DIVERGENCE. `refundOrder` checked the role, then wrote the
 *    refund to IndexedDB, then let the sync queue push it. When the Worker
 *    refused that push (403), the queue row was retired as dead and the till
 *    showed "Refunded" forever while D1 still said "Paid" — inflating revenue
 *    on every other device. Observed in production on 2026-08-03: order
 *    ord_1785773449245_g46ym read Refunded on the till and Paid in D1.
 *
 *    Fix: the CLOUD write is the commit point. Nothing is mutated locally
 *    until the server has accepted the refund (or has been reached and the
 *    write merely needs queuing after an authorised attempt).
 *
 * 2. AUTHORITY READ FROM A STALE CACHE. The guard trusted `getSessionRole()`,
 *    an in-memory value, but authority actually lives in the session COOKIE —
 *    which is shared by every tab of the browser profile. A till with the
 *    manager dashboard open in one tab and a cashier POS in another has one
 *    cookie: whichever tab minted last wins. The manager tab still believed
 *    "manager", passed its own guard, and the Worker (reading the cashier
 *    cookie) answered `refund_requires_escalation`.
 *
 *    Fix: authority is re-probed against the server at refund time, and a
 *    refusal that looks like a clobbered session triggers ONE re-mint with the
 *    operator's held credential before giving up.
 *
 * WHO MAY REFUND (2026-08-03 policy)
 * ----------------------------------
 * Refunding an invoice is a CASHIER duty, performed at the till from the
 * payment screen. Any authenticated session (cashier or manager) may refund —
 * there is no escalation PIN and no manager password prompt. Deleting an
 * invoice is not offered to anyone; a refund is the only way to void a sale.
 *
 * What is still enforced: a session must exist and the SERVER must accept the
 * refund write before local state moves, so the till and D1 can never tell
 * different stories.
 */
import type { Order } from '../types/order';

export type SessionRole = 'manager' | 'cashier';

/** Why a refund was rejected — the UI prints `message` verbatim. */
export class RefundRejectedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RefundRejectedError';
    this.code = code;
  }
}

/** Result of pushing the refund to the cloud. */
export type RefundPushResult =
  | { kind: 'ok' }
  | { kind: 'denied'; code: string | null; message: string | null }
  /** Session problem (401 / stale CSRF / clobbered cookie) — a re-mint may fix it. */
  | { kind: 'unauthenticated' }
  /**
   * The server's freshness guard discarded the write. `serverHasRefund` says
   * whether the row D1 returned is nevertheless already refunded — the only case
   * in which a discarded write is still a correct outcome.
   */
  | { kind: 'stale'; serverHasRefund: boolean }
  | { kind: 'unreachable' };

export type RefundFlowDeps = {
  /** Is a Worker configured at all? A local-only install refunds offline. */
  isCloudConfigured: () => boolean;
  /** Make sure a session exists (no-op when one already does). */
  ensureSession: () => Promise<boolean>;
  /** Ask the SERVER for this session's role (reads the cookie). */
  probeRole: () => Promise<SessionRole | null>;
  /** In-memory role from the last mint — a hint only, never authority. */
  cachedRole: () => SessionRole | null;
  /** Do we still hold the operator's password, i.e. can we re-mint silently? */
  canRemint: () => boolean;
  /** Drop the current session and mint a fresh one from the held credential. */
  remintSession: () => Promise<boolean>;
  /** Push the refunded order to D1. */
  pushRefund: (order: Order) => Promise<RefundPushResult>;
  /** Apply the refund to local storage. Runs ONLY after the cloud accepted it. */
  applyLocal: () => Promise<Order>;
  /** Put the sold stock back. Runs only after the refund is real. */
  restoreInventory: () => Promise<void>;
  /** Kick the sync queue (for the queued-after-authorised-attempt case). */
  triggerSync: () => void;
};

const MSG = {
  notAuthorized:
    'تم رفض الاسترجاع من السيرفر — سجّل الدخول تاني وحاول مرة أخرى.',
  offline:
    'تعذّر التأكد من الصلاحية — الاسترجاع يحتاج اتصال بالإنترنت حتى لا تختلف بيانات الأجهزة.',
  unreachableAfterAuth:
    'لم يتم تسجيل الاسترجاع على السيرفر — الاتصال انقطع قبل التأكيد. الفاتورة لسه مدفوعة، حاول تاني لما النت يرجع.',
  notConfirmed:
    'لم يتم تأكيد الاسترجاع على السيرفر — الفاتورة لسه مدفوعة. حاول تاني.',
};

/**
 * Run a refund end to end.
 *
 * Order of operations is the whole point: verify -> push to cloud -> only then
 * touch local state. Anything that fails before the cloud accepts leaves this
 * device exactly as it was, so the till and D1 can never tell different stories.
 */
export async function performRefund(
  deps: RefundFlowDeps,
  buildRefundedOrder: () => Order
): Promise<Order> {
  // A local-only install (no Worker) has no second source of truth to diverge
  // from — refund locally and be done.
  if (!deps.isCloudConfigured()) {
    const updated = await deps.applyLocal();
    await deps.restoreInventory();
    return updated;
  }

  await deps.ensureSession();

  // A session must exist. Any authenticated role may refund (cashier included),
  // so the probe is about "is there a live session?", not "is this a manager?".
  // Asking the server still matters: the cookie is shared browser-wide, and a
  // dead session must fail here rather than half-apply the refund locally.
  const probed = await deps.probeRole();
  if (probed === null) {
    throw new RefundRejectedError(
      deps.cachedRole() ? 'refund_probe_failed' : 'refund_session_missing',
      MSG.offline
    );
  }

  // Commit point: the server decides, and it decides BEFORE local state moves.
  const refunded = buildRefundedOrder();
  let push = await deps.pushRefund(refunded);

  // A refusal or a lapsed session can both mean "another tab re-minted this
  // browser's cookie with a different role". Re-mint once from the held
  // credential and try again before telling the operator no.
  const worthRemint =
    (push.kind === 'unauthenticated' ||
      (push.kind === 'denied' && deps.cachedRole() !== probed)) &&
    deps.canRemint();

  if (worthRemint) {
    if (await deps.remintSession()) {
      push = await deps.pushRefund(refunded);
    }
  }

  if (push.kind === 'denied') {
    // Deterministic refusal. Local state is untouched — no divergence.
    throw new RefundRejectedError(
      push.code || 'refund_denied',
      push.message || MSG.notAuthorized
    );
  }
  if (push.kind === 'unauthenticated') {
    throw new RefundRejectedError('refund_session_expired', MSG.notAuthorized);
  }
  if (push.kind === 'unreachable') {
    // The network failed before D1 confirmed the refund.
    //
    // This used to apply the refund locally and hand it to the retry queue,
    // reporting full success to the operator. That is what actually lost the
    // refunds reported on 2026-08-04: the queue lives in IndexedDB, so
    // "clear browsing data" — or 15 failed attempts, which dead-letters the row
    // — destroys the only copy of the refund that ever existed, while D1 still
    // says Paid. The till showed Refunded until the cache was cleared, then the
    // invoice came back as paid and the money was unaccounted for.
    //
    // Terminal money state is never recorded optimistically: refuse, leave the
    // invoice exactly as it was on BOTH sides, and tell the operator to retry.
    // A refund the operator must repeat is recoverable; one that silently
    // vanishes is not.
    throw new RefundRejectedError('refund_not_confirmed', MSG.unreachableAfterAuth);
  }

  // A freshness-guard rejection is only acceptable when D1 ALREADY holds the
  // refund (a duplicate/retried submission). If the stored row is not refunded,
  // our write was discarded and the refund did NOT happen — never mask that.
  if (push.kind === 'stale' && !push.serverHasRefund) {
    throw new RefundRejectedError('refund_discarded_by_server', MSG.notConfirmed);
  }

  const updated = await deps.applyLocal();
  await deps.restoreInventory();
  deps.triggerSync();
  return updated;
}
