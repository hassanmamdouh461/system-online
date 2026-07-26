export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;
  available: boolean;
  createdAt?: string;
  updatedAt?: string;
  branchId?: string;
  isSynced?: boolean;
}

export interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  menuItemId?: string;
  status?: 'New' | 'Preparing' | 'Ready' | 'Completed' | 'Cancelled';
  category?: string;
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  tableId: string;
  items: OrderItem[];
  status: 'New' | 'Preparing' | 'Ready' | 'Completed' | 'Cancelled';
  paymentStatus: 'Unpaid' | 'OnAccount' | 'Paid' | 'Refunded';
  paymentMethod?: 'Cash' | 'Card' | 'OnAccount';
  totalAmount: number;
  taxRate?: number;
  taxAmount?: number;
  grandTotal?: number;
  createdAt: string;
  updatedAt?: string;
  paidAt?: string;
  refundedAt?: string;
  refundReason?: string;
  customerPhone?: string;
  customerId?: string;
  customerName?: string;
  companyId?: string;
  companyName?: string;
  billedToType?: 'customer' | 'company';
  branchId?: string;
  isSynced?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  points: number;
  companyId?: string;
  tags?: string[];
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  branchId?: string;
  isSynced?: boolean;
}

export interface Company {
  id: string;
  name: string;
  tags: string[];
  phone?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  branchId?: string;
  isSynced?: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  costPerUnit: number;
  branchId?: string;
  isSynced?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface InventoryTransaction {
  id: string;
  itemId: string;
  itemName?: string;
  itemUnit?: string;
  unit?: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  referenceId?: string;
  createdAt: string;
  branchId?: string;
  isSynced?: boolean;
  notes?: string;
}

export interface RecipeIngredient {
  menuItemId?: string;
  inventoryItemId: string;
  itemName?: string;
  itemUnit?: string;
  unit?: string;
  costPerUnit?: number;
  quantity: number;
}
