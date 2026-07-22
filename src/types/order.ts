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
  /** totalAmount + taxAmount − pointsRedeemed (if any). Prefer this for revenue when present. */
  grandTotal?: number;
  createdAt: string; // ISO string
  updatedAt?: string; // ISO string — last modification timestamp for sync conflict resolution
  paidAt?: string; // ISO string when payment was completed
  customerPhone?: string;
  /** When billed to a registered customer account */
  customerId?: string;
  customerName?: string;
  /** When billed to a company account (may aggregate many customers) */
  companyId?: string;
  companyName?: string;
  billedToType?: BilledToType;
  pointsEarned?: number;
  pointsRedeemed?: number;
  /** Set when a paid order is voided/refunded */
  refundedAt?: string;
  refundReason?: string;
  /** Multi-branch sync fields */
  branchId?: string; // UUID identifying which branch created/owns this record
  isSynced?: boolean; // false = needs to be pushed to central server
}

/** Resolve order grand total using frozen tax fields when available. */
export function getOrderGrandTotal(order: Pick<Order, 'totalAmount' | 'taxAmount' | 'grandTotal' | 'taxRate' | 'pointsRedeemed'>, fallbackTaxRate = 0): number {
  // Only trust grandTotal when it's a real positive snapshot (null from D1 used to become 0)
  if (typeof order.grandTotal === 'number' && Number.isFinite(order.grandTotal) && order.grandTotal > 0) {
    return order.grandTotal;
  }
  const rate =
    typeof order.taxRate === 'number' && Number.isFinite(order.taxRate)
      ? order.taxRate
      : fallbackTaxRate;
  const tax =
    typeof order.taxAmount === 'number' && Number.isFinite(order.taxAmount)
      ? order.taxAmount
      : order.totalAmount * rate;
  const points = order.pointsRedeemed || 0;
  const total = order.totalAmount + tax - points;
  return Math.max(0, Number.isFinite(total) ? total : 0);
}

// Clean initial state for new client database (0 initial orders)
export const MOCK_ORDERS: Order[] = [];
