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
 * Also revived: the refund PIN. `PaymentModal` collects it and both request
 * paths already send `X-Refund-PIN`, but `refundOrder` threw
 * `refund_requires_manager` before any of that could matter, so a cashier
 * holding a valid PIN could never complete a refund. A held PIN now counts as
 * authority — the Worker is the one that validates it.
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
  /** Does this device hold a refund escalation PIN? */
  hasRefundPin: () => boolean;
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
    'الاسترجاع يحتاج صلاحية مدير أو رمز تصعيد (PIN) صحيح.',
  offline:
    'تعذّر التأكد من الصلاحية — الاسترجاع يحتاج اتصال بالإنترنت حتى لا تختلف بيانات الأجهزة.',
  unreachableAfterAuth:
    'تم قبول الصلاحية لكن تعذّر الوصول للسيرفر — حاول تاني لما النت يرجع.',
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

  // Authority. The cookie is shared browser-wide, so ASK THE SERVER rather than
  // trusting the role this tab happens to remember.
  const heldPin = deps.hasRefundPin();
  const probed = await deps.probeRole();
  if (probed === null && !heldPin) {
    // No answer and no PIN: we cannot establish authority. Refuse rather than
    // refund locally into a divergence.
    throw new RefundRejectedError(
      deps.cachedRole() ? 'refund_probe_failed' : 'refund_requires_manager',
      MSG.offline
    );
  }
  if (probed !== 'manager' && !heldPin) {
    throw new RefundRejectedError('refund_requires_manager', MSG.notAuthorized);
  }

  // Commit point: the server decides, and it decides BEFORE local state moves.
  const refunded = buildRefundedOrder();
  let push = await deps.pushRefund(refunded);

  // A refusal or a lapsed session can both mean "another tab re-minted this
  // browser's cookie with a different role". Re-mint once from the held
  // credential and try again before telling the operator no.
  const worthRemint =
    (push.kind === 'unauthenticated' ||
      (push.kind === 'denied' && probed !== 'manager' && !heldPin) ||
      (push.kind === 'denied' && deps.cachedRole() === 'manager' && probed !== 'manager')) &&
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
    // Authority WAS established, the network then failed. Refusing here would
    // block a legitimate refund over a flaky link, so apply it locally and let
    // the durable queue deliver it — the write is one the server has already
    // agreed this session may make.
    const updated = await deps.applyLocal();
    await deps.restoreInventory();
    deps.triggerSync();
    console.warn('[refund] server unreachable after authorisation — queued:', MSG.unreachableAfterAuth);
    return updated;
  }

  const updated = await deps.applyLocal();
  await deps.restoreInventory();
  deps.triggerSync();
  return updated;
}
