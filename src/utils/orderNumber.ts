/**
 * Daily ticket numbers: 1, 2, 3... within the local calendar day.
 * Resets to 1 after local midnight.
 */

const MAX_REASONABLE_ORDER_NUM = 99_999;
/** Numbers above this are treated as legacy/junk (e.g. 1000-series counters). */
const DAILY_TICKET_SOFT_MAX = 500;

/** Local calendar day key YYYY-MM-DD */
export function localDayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dayKeyFromIso(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return localDayKey(d);
}

/** Parse a short sequential ticket number, or null if junk/timestamp. */
export function parseOrderSeq(orderNumber?: string | null): number | null {
  if (orderNumber === null || orderNumber === undefined) return null;
  const raw = String(orderNumber).trim();
  if (!raw || raw === '—' || raw === '-') return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits || digits.length > 5) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_REASONABLE_ORDER_NUM) return null;
  return n;
}

/** Next ticket number for *today* only (local midnight reset). */
export function nextOrderSeq(
  orders: { orderNumber?: string; createdAt?: string }[],
  now: Date = new Date()
): number {
  const today = localDayKey(now);
  let max = 0;
  for (const o of orders) {
    const day = dayKeyFromIso(o.createdAt);
    // Only count orders created today
    if (day !== today) continue;
    const n = parseOrderSeq(o.orderNumber);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}

/** Display label: short number only. Never show em-dash if we can avoid it. */
export function formatOrderNumber(
  order: { orderNumber?: string; id?: string; createdAt?: string },
  fallbackIndex?: number
): string {
  const n = parseOrderSeq(order.orderNumber);
  if (n !== null) return String(n);
  if (typeof fallbackIndex === 'number' && fallbackIndex > 0) return String(fallbackIndex);
  // Last resort: still avoid huge ids — show dash only when truly unknown
  return '—';
}

/**
 * Build a collision-free ticket label for `base`. If the plain number is already
 * taken, append a letter suffix (-A, -B, …). This lets a conflicting (unprinted)
 * order take a suffixed number INSTEAD of forcing a full-day renumber that would
 * shift already-printed tickets. `taken` holds display labels already assigned.
 */
export function suffixedTicket(base: number, taken: Set<string>): string {
  const plain = String(base);
  if (!taken.has(plain)) return plain;
  for (let i = 0; i < 26; i++) {
    const cand = `${base}-${String.fromCharCode(65 + i)}`; // 16-A … 16-Z
    if (!taken.has(cand)) return cand;
  }
  let k = 1;
  let cand = `${base}-${k}`;
  while (taken.has(cand)) cand = `${base}-${++k}`;
  return cand;
}

/** Sort key for ascending ticket order. */
export function orderSeqSortValue(order: { orderNumber?: string; createdAt?: string }): number {
  const n = parseOrderSeq(order.orderNumber);
  if (n !== null) return n;
  // Put unknown numbers after valid ones, still stable by time
  const t = order.createdAt ? new Date(order.createdAt).getTime() : 0;
  return 1_000_000 + (Number.isFinite(t) ? t % 1_000_000 : 0);
}

/**
 * Pick best short ticket when local (post-renumber) and remote (legacy cloud) disagree.
 * Prefer the smaller daily-style number over inflated legacy counters (1000+).
 */
export function preferTicketNumber(
  localNum?: string | null,
  remoteNum?: string | null
): string {
  const localSeq = parseOrderSeq(localNum);
  const remoteSeq = parseOrderSeq(remoteNum);

  if (localSeq !== null && remoteSeq !== null) {
    // After local renumber (1..N), cloud often still has 1000-series — keep local.
    if (
      remoteSeq > DAILY_TICKET_SOFT_MAX &&
      localSeq <= DAILY_TICKET_SOFT_MAX &&
      remoteSeq > localSeq
    ) {
      return String(localSeq);
    }
    // Both daily-sized: prefer local if it looks cleaned (smaller gap is fine either way)
    if (localSeq <= DAILY_TICKET_SOFT_MAX && remoteSeq <= DAILY_TICKET_SOFT_MAX) {
      // Prefer the smaller as more likely a renumbered daily ticket when they diverge a lot
      if (Math.abs(remoteSeq - localSeq) > 50) {
        return String(Math.min(localSeq, remoteSeq));
      }
      // Mild divergence: keep local so renumber sticks across refetch cycles
      return String(localSeq);
    }
    return String(Math.min(localSeq, remoteSeq));
  }
  if (localSeq !== null) return String(localSeq);
  if (remoteSeq !== null) return String(remoteSeq);
  return String(remoteNum || localNum || '');
}

/**
 * Prefer local good values over remote empty/junk when merging cloud → local.
 */
export function mergeOrderRecords(local: OrderLike | undefined, remote: OrderLike): OrderLike {
  if (!local) return remote;

  const orderNumber = preferTicketNumber(local.orderNumber, remote.orderNumber);

  // Resolve soft-delete tombstone: whichever side has a NEWER deletedAt wins.
  const localDeletedAt = local.deletedAt;
  const remoteDeletedAt = remote.deletedAt;
  const effectiveDeletedAt =
    !localDeletedAt
      ? remoteDeletedAt
      : !remoteDeletedAt
        ? localDeletedAt
        : new Date(localDeletedAt).getTime() >= new Date(remoteDeletedAt).getTime()
          ? localDeletedAt
          : remoteDeletedAt;

  // Prefer non-empty fields; local wins when remote is empty/placeholder
  const isEmpty = (v: unknown) =>
    v === undefined || v === null || v === '' || (typeof v === 'string' && !v.trim());

  const isPlaceholderName = (v: unknown) => {
    if (typeof v !== 'string') return false;
    const s = v.trim().toLowerCase();
    return s === 'عميل' || s === 'customer' || s === 'شركة' || s === 'company' || s === '—';
  };

  const pick = <T,>(r: T | undefined | null, l: T | undefined | null): T | undefined => {
    // Local real value beats remote empty/placeholder
    if (!isEmpty(l) && !isPlaceholderName(l) && (isEmpty(r) || isPlaceholderName(r))) {
      return l as T;
    }
    if (!isEmpty(r) && !isPlaceholderName(r)) return r as T;
    if (!isEmpty(l)) return l as T;
    if (!isEmpty(r)) return r as T;
    return (r ?? l) as T | undefined;
  };

  // Tie-breaker for payment state. Numeric comparison via getTime() is correct
  // (NaN-safe: an invalid timestamp yields NaN which fails every comparison
  // below, so the corresponding side simply loses instead of winning).
  const localPaid = local.paidAt ? new Date(local.paidAt).getTime() : 0;
  const remotePaid = remote.paidAt ? new Date(remote.paidAt).getTime() : 0;
  const localUpdated = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
  const remoteUpdated = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;

  // Local wins payment when it paid more recently (cashier flow on this device)
  // OR it has a more recent update carrying real payment data.
  const localWinsPayment =
    Number.isFinite(localPaid) && Number.isFinite(remotePaid) && localPaid > remotePaid ||
    (Number.isFinite(localUpdated) &&
      Number.isFinite(remoteUpdated) &&
      localUpdated > remoteUpdated &&
      local.paymentStatus);

  // Remote wins STATE when its updatedAt is clearly newer (>5s skew to avoid
  // trivial clock drift). We still keep local IDENTITY (account fields below).
  const REMOTE_NEWER_SKEW_MS = 5_000;
  const remoteWinsState =
    Number.isFinite(localUpdated) &&
    Number.isFinite(remoteUpdated) &&
    remoteUpdated - localUpdated > REMOTE_NEWER_SKEW_MS;

  // Resolve the refund following the same winner as the payment fields, always
  // preferring a non-empty value so a refund is never wiped by a stale copy.
  const mergedRefundedAt =
    localWinsPayment
      ? (local.refundedAt ?? remote.refundedAt)
      : remoteWinsState
        ? (remote.refundedAt ?? local.refundedAt)
        : (local.refundedAt ?? remote.refundedAt);

  // A refund is TERMINAL — there is no un-refund flow in this POS. Once either
  // side carries a refund (a resolved refundedAt, or an explicit 'Refunded'
  // status), the merged order must stay 'Refunded'. Preserving refundedAt alone
  // is not enough: paymentStatus below can still resolve to 'Paid' when a newer
  // UNRELATED remote edit wins state (offline-refund race), and the revenue
  // report (useAnalytics) filters on paymentStatus === 'Paid' while IGNORING
  // refundedAt — so a refunded order would be silently re-counted as revenue.
  const isRefunded =
    !!mergedRefundedAt ||
    local.paymentStatus === 'Refunded' ||
    remote.paymentStatus === 'Refunded';

  // A settled payment is a one-way latch, same as Refunded. Once ANY side has
  // genuinely recorded the order as Paid (status 'Paid' backed by a paidAt
  // timestamp), the merged order must never revert to 'Unpaid' — the merge is
  // otherwise decided by updatedAt from client device clocks, and a stale or
  // fast clock on a second device could resurrect a real collected payment
  // into 'Unpaid', silently re-counting settled revenue as a receivable.
  const latchedPaid =
    (local.paymentStatus === 'Paid' && !!local.paidAt) ||
    (remote.paymentStatus === 'Paid' && !!remote.paidAt);

  return {
    // Note: the spread below layers remote on top of local. The explicit keys
    // after it override the spread so local identity (company/customer) is
    // never wiped by an empty/placeholder remote copy.
    ...local,
    ...remote,
    id: remote.id || local.id,
    orderNumber,
    deletedAt: effectiveDeletedAt || undefined,
    // printedAt is a set-once latch: once ANY device has printed a receipt for
    // this order, keep it printed forever so its number stays frozen. Never let
    // a copy that lacks printedAt clear it.
    printedAt: local.printedAt || remote.printedAt,
    // Identity (always preserved — never let remote empty/placeholder win):
    customerPhone: pick(remote.customerPhone, local.customerPhone),
    customerId: pick(remote.customerId, local.customerId),
    customerName: pick(remote.customerName, local.customerName),
    companyId: pick(remote.companyId, local.companyId),
    companyName: pick(remote.companyName, local.companyName),
    billedToType: pick(remote.billedToType, local.billedToType) as any,
    taxRate: remote.taxRate ?? local.taxRate,
    taxAmount: remote.taxAmount ?? local.taxAmount,
    grandTotal: remote.grandTotal ?? local.grandTotal,
    // Refund metadata must follow the SAME winner as paymentStatus below.
    // Previously refundedAt/refundReason were not resolved here, so they fell
    // through the `...remote` spread: a stale remote copy (refund not uploaded
    // yet) overwrote a fresh local refund's date/reason with undefined while
    // paymentStatus still resolved to 'Refunded' — leaving an order shown as
    // refunded with no record of WHEN or WHY. Resolve them like the other
    // payment fields, preferring a non-empty value so a refund is never wiped.
    refundedAt: mergedRefundedAt,
    refundReason: localWinsPayment
      ? (local.refundReason ?? remote.refundReason)
      : remoteWinsState
        ? (remote.refundReason ?? local.refundReason)
        : (local.refundReason ?? remote.refundReason),
    // Payment state: local wins when it paid locally; otherwise prefer remote
    // when remote is clearly newer (e.g. a refund landed in D1 first). A
    // resolved refund is terminal and overrides this (see isRefunded above),
    // so an order that was refunded on any device can never revert to 'Paid'
    // and be re-counted as revenue. Likewise a genuinely settled payment is
    // latched (see latchedPaid): a real collection can never revert to
    // 'Unpaid' on a stale/second-device clock. Refund outranks Paid.
    paymentStatus: isRefunded
      ? 'Refunded'
      : latchedPaid
        ? 'Paid'
        : localWinsPayment
          ? (local.paymentStatus || remote.paymentStatus)
          : remoteWinsState
            ? (remote.paymentStatus || local.paymentStatus)
            : (local.paymentStatus || remote.paymentStatus),
    paymentMethod: localWinsPayment
      ? (local.paymentMethod || remote.paymentMethod)
      : remoteWinsState
        ? (remote.paymentMethod || local.paymentMethod)
        : (local.paymentMethod || remote.paymentMethod),
    paidAt: localWinsPayment
      ? (local.paidAt || remote.paidAt)
      : remoteWinsState
        ? (remote.paidAt || local.paidAt)
        : (local.paidAt || remote.paidAt),
    items: Array.isArray(remote.items) && remote.items.length > 0 ? remote.items : local.items,
  };
}

type OrderLike = {
  id?: string;
  orderNumber?: string;
  customerPhone?: string;
  customerId?: string;
  customerName?: string;
  companyId?: string;
  companyName?: string;
  billedToType?: string;
  taxRate?: number;
  taxAmount?: number;
  grandTotal?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  paidAt?: string;
  printedAt?: string;
  refundedAt?: string;
  refundReason?: string;
  updatedAt?: string;
  deletedAt?: string;
  items?: any[];
  [key: string]: any;
};
