/**
 * Daily ticket numbers: 1, 2, 3... within the BUSINESS day.
 * Resets to 1 when the business day rolls over.
 *
 * BD-015 — ONE definition of "day" for the whole system.
 * -----------------------------------------------------
 * Ticket numbering used to key off the local CALENDAR day while every revenue
 * surface keyed off `businessDay.businessDayKey()`. With `dayStartHour = 6` (a
 * cafe that trades past midnight) a 01:00 order was booked into YESTERDAY's
 * revenue but handed a ticket from a FRESH counter that had just reset to 1 —
 * so a single shift printed duplicate ticket numbers and yesterday's report
 * contained a ticket "1" that the shift had never opened. The bug is fully
 * dormant at the default `dayStartHour = 0` and appears the moment a venue
 * configures a night shift.
 *
 * Both helpers below now delegate to businessDay, so numbering and reporting
 * can never disagree again.
 */
import { businessDate, businessDayKey, getDayStartHour } from './businessDay';

const MAX_REASONABLE_ORDER_NUM = 99_999;
/** Numbers above this are treated as legacy/junk (e.g. 1000-series counters). */
const DAILY_TICKET_SOFT_MAX = 500;

/**
 * Business-day key YYYY-MM-DD for a Date — the same bucket reports use.
 * Name kept for its many call sites; the semantics are now business-day.
 */
export function localDayKey(date: Date = new Date(), startHour: number = getDayStartHour()): string {
  const b = businessDate(date, startHour);
  const y = b.getFullYear();
  const m = String(b.getMonth() + 1).padStart(2, '0');
  const d = String(b.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dayKeyFromIso(iso?: string, startHour: number = getDayStartHour()): string | null {
  if (!iso) return null;
  return businessDayKey(iso, startHour);
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

/**
 * Next ticket number for the CURRENT BUSINESS DAY (resets at `dayStartHour`).
 *
 * ON-005: the counter is clamped to MAX_REASONABLE_ORDER_NUM. `parseOrderSeq`
 * refuses anything above that as junk, so emitting 100000 produced a ticket the
 * system itself could not read back — the counter then silently fell to 1 with
 * no warning. Tickets reset daily so the ceiling is unreachable in practice;
 * should it ever be hit, wrapping explicitly (and loudly) beats emitting an
 * unreadable number.
 */
export function nextOrderSeq(
  orders: { orderNumber?: string; createdAt?: string }[],
  now: Date = new Date()
): number {
  const startHour = getDayStartHour();
  const today = localDayKey(now, startHour);
  let max = 0;
  for (const o of orders) {
    const day = dayKeyFromIso(o.createdAt, startHour);
    // Only count orders created within the current business day
    if (day !== today) continue;
    const n = parseOrderSeq(o.orderNumber);
    if (n !== null && n > max) max = n;
  }
  if (max >= MAX_REASONABLE_ORDER_NUM) {
    console.warn(
      `[orderNumber] daily ticket counter hit its ceiling (${MAX_REASONABLE_ORDER_NUM}) — wrapping to 1`
    );
    return 1;
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
 * Smallest positive ticket number not already claimed in `takenBase`.
 *
 * Replaces the old `suffixedTicket` letter scheme (16-A, 16-B …). That scheme
 * never reached the customer: `formatOrderNumber` below strips non-digits, so
 * "16" and "16-A" both PRINTED as 16 — the suffix separated the two orders
 * inside IndexedDB while the two receipts stayed identical, which is the only
 * place the collision actually mattered. Tickets are plain integers now; a
 * conflict is resolved by MOVING a number, not by decorating it.
 */
export function nextFreeTicket(takenBase: Set<number>, from = 1): number {
  let n = Math.max(1, Math.floor(from));
  while (takenBase.has(n)) n++;
  return n;
}

type TicketOrder = { id?: string; orderNumber?: string; createdAt?: string };

/**
 * Do two orders in this set print the SAME ticket number?
 *
 * Compared on the parsed base rather than the raw label, because the base is
 * what the customer's receipt shows: `formatOrderNumber` strips non-digits, so
 * "7" and a legacy "7-A" are one and the same ticket on paper.
 */
export function hasDuplicateTickets(orders: TicketOrder[]): boolean {
  const seen = new Set<number>();
  for (const o of orders) {
    const n = parseOrderSeq(o.orderNumber);
    if (n === null) continue;
    if (seen.has(n)) return true;
    seen.add(n);
  }
  return false;
}

/** Issue order: creation time, with id as a stable tie-break. */
export function byIssueTime(a: TicketOrder, b: TicketOrder): number {
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : NaN;
  const tb = b.createdAt ? new Date(b.createdAt).getTime() : NaN;
  const va = Number.isFinite(ta) ? ta : 0;
  const vb = Number.isFinite(tb) ? tb : 0;
  if (va !== vb) return va - vb;
  // Same millisecond: fall back to id so every device computes the SAME
  // sequence from the same set of orders. Convergence depends on this.
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

/**
 * Lay a day's tickets back down as 1..N in issue order.
 *
 * Used to repair the offline collision: two tills with no network each number
 * from their own local max + 1, so both hand out #5. On reconnect the merged
 * day is renumbered by issue time — the earlier sale keeps the lower number.
 *
 * Deliberately a PURE function of the day's orders so two devices that have
 * merged the same set produce identical numbering and converge, instead of
 * each pushing its own answer at the other.
 *
 * Returns only the orders whose number actually changes.
 */
export function planIssueOrderTickets(
  dayOrders: TicketOrder[]
): Array<{ id: string; orderNumber: string }> {
  const changes: Array<{ id: string; orderNumber: string }> = [];
  const sorted = [...dayOrders].sort(byIssueTime);
  let ticket = 1;
  for (const o of sorted) {
    const target = String(ticket++);
    if (String(o.orderNumber ?? '') !== target) {
      changes.push({ id: String(o.id ?? ''), orderNumber: target });
    }
  }
  return changes;
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
  remoteNum?: string | null,
  stamps?: { localUpdatedAt?: string; remoteUpdatedAt?: string }
): string {
  const localSeq = parseOrderSeq(localNum);
  const remoteSeq = parseOrderSeq(remoteNum);

  // Outage reconciliation must be able to PROPAGATE.
  //
  // When two tills issue the same ticket offline, the reconnect pass renumbers
  // the day by issue time and stamps a fresh updatedAt. Without this branch the
  // "both daily-sized → keep local" rule below reverted that on the other
  // device, which pushed its old number back and undid the fix — the two
  // devices then ping-ponged the same order between two numbers forever.
  // A renumber is a deliberate, newer decision: let the newer updatedAt win.
  if (localSeq !== null && remoteSeq !== null && localSeq !== remoteSeq) {
    const l = stamps?.localUpdatedAt ? new Date(stamps.localUpdatedAt).getTime() : NaN;
    const r = stamps?.remoteUpdatedAt ? new Date(stamps.remoteUpdatedAt).getTime() : NaN;
    if (Number.isFinite(l) && Number.isFinite(r) && l !== r) {
      // Still refuse an inflated legacy counter, however fresh it claims to be.
      const winner = r > l ? remoteSeq : localSeq;
      const loser = r > l ? localSeq : remoteSeq;
      if (!(winner > DAILY_TICKET_SOFT_MAX && loser <= DAILY_TICKET_SOFT_MAX)) {
        return String(winner);
      }
    }
  }

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

  const orderNumber = preferTicketNumber(local.orderNumber, remote.orderNumber, {
    localUpdatedAt: local.updatedAt,
    remoteUpdatedAt: remote.updatedAt,
  });

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
    cashierName: pick(remote.cashierName, local.cashierName),
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
  cashierName?: string;
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
