import { calcGrandTotal, calcTax, isMoney, roundMoney, roundMoneyNonNegative } from '../utils/money';

export type OrderStatus = 'New' | 'Preparing' | 'Ready' | 'Completed' | 'Cancelled';
/**
 * Unpaid   = open bill (table/cashier)
 * OnAccount = charged to customer/company credit (receivable)
 * Paid     = cash/card settled (revenue)
 * Refunded = voided after pay
 */
export type PaymentStatus = 'Unpaid' | 'OnAccount' | 'Paid' | 'Refunded';
export type PaymentMethod = 'Cash' | 'Card' | 'OnAccount';
/** Who carries the receivable when paymentMethod is OnAccount */
export type BilledToType = 'customer' | 'company';

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  /** Optional link to menu item for COGS / recipe cost lookups */
  menuItemId?: string;
  status?: OrderStatus;
  category?: string;
}

export interface Order {
  id: string; // Database ID (for API calls)
  orderNumber: string; // Display ID (e.g., ORD-1025)
  tableId: string;
  status: OrderStatus;
  /** Financial status. Only set to 'Paid' from Payment.tsx — never from the kitchen/orders screen. */
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod;
  items: OrderItem[];
  /** Pre-tax subtotal (sum of line items). Historical source of truth for item totals. */
  totalAmount: number;
  /**
   * Tax snapshot frozen at create/pay time so later tax-rate changes
   * never rewrite historical invoices or reports.
   */
  taxRate?: number;
  taxAmount?: number;
  /** totalAmount + taxAmount. Prefer this for revenue when present. */
  grandTotal?: number;
  createdAt: string; // ISO string
  updatedAt?: string; // ISO string — last modification timestamp for sync conflict resolution
  paidAt?: string; // ISO string when payment was completed
  /**
   * ISO string set the first time a CUSTOMER receipt is printed for this order.
   * Once set, the order's ticket number is FROZEN: renumberIfNeeded must never
   * rewrite a printed order's number (a physical receipt with that number is in
   * the customer's hand). Acts as a set-once latch — never cleared.
   */
  printedAt?: string;
  customerPhone?: string;
  /** When billed to a registered customer account */
  customerId?: string;
  customerName?: string;
  /** When billed to a company account (may aggregate many customers) */
  companyId?: string;
  companyName?: string;
  billedToType?: BilledToType;
  /** Set when a paid order is voided/refunded */
  refundedAt?: string;
  refundReason?: string;
  /** Name of the staff member (cashier/waiter) who took this order — printed on
   *  the receipt so management can attribute sales to the right person. */
  cashierName?: string;
  /** Soft-delete tombstone — set when order is "deleted" via DataContext. */
  deletedAt?: string;
  /** Multi-branch sync fields */
  branchId?: string; // UUID identifying which branch created/owns this record
  isSynced?: boolean; // false = needs to be pushed to central server
}

/**
 * Is a stored `grandTotal` snapshot trustworthy?
 *
 * OT-007: the previous guard only rejected zero/negative values (the D1
 * NULL→0 bug). Any positive number was trusted, so a corrupt row carrying
 * subtotal 100 + tax 14 + grandTotal 50 was reported as 50 and the day's
 * revenue was silently understated. A grand total can never be LESS than the
 * subtotal it was computed from (tax is non-negative), so a value below the
 * subtotal is corruption, not a discount — it is rejected and recomputed, with
 * a warning so the bad rows can be found instead of swallowed.
 */
function isTrustworthyGrandTotal(
  order: Pick<Order, 'totalAmount' | 'grandTotal'>
): boolean {
  if (!isMoney(order.grandTotal) || order.grandTotal <= 0) return false;
  const subtotal = isMoney(order.totalAmount) ? roundMoney(order.totalAmount) : 0;
  // Piaster tolerance: legitimate float drift must not trip the guard.
  if (subtotal > 0 && roundMoney(order.grandTotal) < subtotal - 0.005) {
    console.warn(
      `[order] ignoring corrupt grandTotal ${order.grandTotal} — below subtotal ${subtotal}; recomputing`
    );
    return false;
  }
  return true;
}

/**
 * Resolve order grand total using frozen tax fields when available.
 *
 * All arithmetic routes through `utils/money` so historical orders whose stored
 * fields already carry float drift (e.g. a grandTotal of 112.49999999999999)
 * are normalised to the piaster on read. That keeps every consumer — receipts,
 * reports, statements, balances — agreeing on the same figure.
 */
export function getOrderGrandTotal(
  order: Pick<Order, 'totalAmount' | 'taxAmount' | 'grandTotal' | 'taxRate'>,
  fallbackTaxRate = 0
): number {
  // Only trust grandTotal when it's a real, self-consistent snapshot
  // (null from D1 used to become 0; corrupt rows can sit below the subtotal).
  if (isTrustworthyGrandTotal(order)) {
    return roundMoneyNonNegative(order.grandTotal as number);
  }
  const rate = isMoney(order.taxRate) ? order.taxRate : fallbackTaxRate;
  const tax = isMoney(order.taxAmount)
    ? roundMoney(order.taxAmount)
    : calcTax(order.totalAmount, rate);
  return calcGrandTotal(order.totalAmount, tax);
}

/**
 * Resolve the frozen money triple for an order in one pass, piaster-exact.
 * Prefer this over recomputing subtotal/tax/total separately at each call site —
 * that duplication is what let the four copies of this formula drift apart.
 */
export function getOrderMoney(
  order: Pick<Order, 'totalAmount' | 'taxAmount' | 'grandTotal' | 'taxRate'>,
  fallbackTaxRate = 0
): { subtotal: number; taxRate: number; taxAmount: number; grandTotal: number } {
  const subtotal = roundMoney(order.totalAmount);
  const taxRate = isMoney(order.taxRate) ? order.taxRate : fallbackTaxRate;
  const taxAmount = isMoney(order.taxAmount)
    ? roundMoney(order.taxAmount)
    : calcTax(subtotal, taxRate);
  const grandTotal = isTrustworthyGrandTotal(order)
    ? roundMoneyNonNegative(order.grandTotal as number)
    : calcGrandTotal(subtotal, taxAmount);
  return { subtotal, taxRate, taxAmount, grandTotal };
}

