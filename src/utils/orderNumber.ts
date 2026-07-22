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

  // Prefer newer updatedAt/paidAt for payment state, but never wipe account identity
  const localPaid = local.paidAt ? new Date(local.paidAt).getTime() : 0;
  const remotePaid = remote.paidAt ? new Date(remote.paidAt).getTime() : 0;
  const localUpdated = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
  const remoteUpdated = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
  const localWinsPayment =
    (localPaid > 0 && localPaid > remotePaid) ||
    (localUpdated > 0 && localUpdated > remoteUpdated && local.paymentStatus);

  return {
    ...local,
    ...remote,
    id: remote.id || local.id,
    orderNumber,
    customerPhone: pick(remote.customerPhone, local.customerPhone),
    customerId: pick(remote.customerId, local.customerId),
    customerName: pick(remote.customerName, local.customerName),
    companyId: pick(remote.companyId, local.companyId),
    companyName: pick(remote.companyName, local.companyName),
    billedToType: pick(remote.billedToType, local.billedToType) as any,
    taxRate: remote.taxRate ?? local.taxRate,
    taxAmount: remote.taxAmount ?? local.taxAmount,
    grandTotal: remote.grandTotal ?? local.grandTotal,
    paymentStatus: localWinsPayment
      ? local.paymentStatus || remote.paymentStatus
      : remote.paymentStatus || local.paymentStatus,
    paymentMethod: localWinsPayment
      ? local.paymentMethod || remote.paymentMethod
      : remote.paymentMethod || local.paymentMethod,
    paidAt: localWinsPayment
      ? local.paidAt || remote.paidAt
      : remote.paidAt || local.paidAt,
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
  updatedAt?: string;
  items?: any[];
  [key: string]: any;
};
