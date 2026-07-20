export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  image?: string;
  available: boolean;
  createdAt?: string;
  updatedAt?: string;
  branchId?: string;
  isSynced?: boolean;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  tableId: string;
  items: OrderItem[];
  status: 'New' | 'Preparing' | 'Ready' | 'Delivered' | 'Cancelled';
  paymentStatus: 'Unpaid' | 'Paid';
  paymentMethod?: 'Cash' | 'Card';
  totalAmount: number;
  createdAt: string;
  updatedAt?: string;
  paidAt?: string;
  customerPhone?: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  branchId?: string;
  isSynced?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  points: number;
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
}

export interface InventoryTransaction {
  id: string;
  itemId: string;
  itemName?: string;
  itemUnit?: string;
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
  costPerUnit?: number;
  quantity: number;
}

declare global {
  interface Window {
    electronAPI: {
      getMenu: () => Promise<MenuItem[]>;
      createMenuItem: (item: Omit<MenuItem, 'id'>) => Promise<MenuItem>;
      updateMenuItem: (id: string, data: Partial<Omit<MenuItem, 'id'>>) => Promise<MenuItem>;
      deleteMenuItem: (id: string) => Promise<void>;
      resetMenu: (defaults: Omit<MenuItem, 'id'>[]) => Promise<MenuItem[]>;
      
      getOrders: () => Promise<Order[]>;
      createOrder: (order: Omit<Order, 'id'>) => Promise<Order>;
      updateOrderStatus: (id: string, status: Order['status']) => Promise<Order>;
      completeOrderPayment: (id: string, method: 'Cash' | 'Card') => Promise<Order>;
      updateOrder: (id: string, data: Partial<Omit<Order, 'id'>>) => Promise<Order>;
      deleteOrder: (id: string) => Promise<void>;
      resetOrders: (defaults: Omit<Order, 'id'>[]) => Promise<Order[]>;

      getCustomers: () => Promise<Customer[]>;
      getCustomerByPhone: (phone: string) => Promise<Customer | null>;
      saveCustomer: (customer: Partial<Customer> & { phone: string }) => Promise<Customer>;
      deleteCustomer: (id: string) => Promise<void>;

      getSettings: () => Promise<Record<string, string>>;
      saveSetting: (key: string, value: string) => Promise<void>;
      deleteSetting: (key: string) => Promise<void>;

      // Inventory & Recipes APIs
      getInventory: (branchId?: string) => Promise<InventoryItem[]>;
      createInventoryItem: (item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<InventoryItem>;
      updateInventoryItem: (id: string, data: Partial<Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>>) => Promise<InventoryItem>;
      deleteInventoryItem: (id: string) => Promise<void>;
      getInventoryTransactions: (itemId?: string, branchId?: string) => Promise<InventoryTransaction[]>;
      createInventoryTransaction: (tx: Omit<InventoryTransaction, 'id' | 'createdAt'>) => Promise<InventoryTransaction>;
      getMenuRecipes: () => Promise<RecipeIngredient[]>;
      getMenuItemRecipe: (menuItemId: string) => Promise<RecipeIngredient[]>;
      saveMenuRecipe: (menuItemId: string, ingredients: RecipeIngredient[]) => Promise<RecipeIngredient[]>;
      getRecipeCost: (menuItemId: string) => Promise<number>;

      getSyncStatus: () => Promise<{
        state: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
        lastSyncAt: string | null;
        pendingCount: number;
        lastError: string | null;
      }>;
      triggerSync: () => Promise<{
        state: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
        lastSyncAt: string | null;
        pendingCount: number;
        lastError: string | null;
      }>;
      onSyncStatusUpdate: (callback: (status: {
        state: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
        lastSyncAt: string | null;
        pendingCount: number;
        lastError: string | null;
      }) => void) => () => void;
      
      getManagerOrders: () => Promise<any[]>;
      getManagerCustomers: () => Promise<any[]>;
    };
  }
}
