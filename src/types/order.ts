export type OrderStatus = 'New' | 'Preparing' | 'Ready' | 'Completed' | 'Cancelled';
export type PaymentStatus = 'Unpaid' | 'Paid';

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
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
  paymentMethod?: 'Cash' | 'Card';
  items: OrderItem[];
  totalAmount: number;
  createdAt: string; // ISO string
  updatedAt?: string; // ISO string — last modification timestamp for sync conflict resolution
  paidAt?: string; // ISO string when payment was completed
  customerPhone?: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  /** Multi-branch sync fields */
  branchId?: string; // UUID identifying which branch created/owns this record
  isSynced?: boolean; // false = needs to be pushed to central server
}

// Clean initial state for new client database (0 initial orders)
export const MOCK_ORDERS: Order[] = [];
