import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { MenuItem, INITIAL_MENU_ITEMS } from '../../types/menu';
import { Order } from '../../types/order';
import { Customer } from '../../types/customer';
import { InventoryItem } from '../../global';

export interface SyncRecord {
  id: string;
  type: 'order' | 'menu' | 'customer' | 'inventory';
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp: string;
  synced: number; // 0 = pending, 1 = synced
  // Retry/backoff fields (optional so existing records remain valid without a DB migration)
  attempts?: number;      // number of failed upload attempts
  lastError?: string;     // last error message captured
  nextRetryAt?: string;   // ISO time before which we should NOT retry (exponential backoff)
  syncedAt?: string;      // ISO time when sync succeeded (used for cleanup of old records)
}

export interface BrewMasterDBSchema extends DBSchema {
  menu_items: {
    key: string;
    value: MenuItem;
    indexes: { 'by-category': string };
  };
  orders: {
    key: string;
    value: Order;
    indexes: { 'by-status': string; 'by-created': string };
  };
  customers: {
    key: string;
    value: Customer;
    indexes: { 'by-phone': string };
  };
  inventory: {
    key: string;
    value: InventoryItem;
  };
  sync_queue: {
    key: string;
    value: SyncRecord;
    indexes: { 'by-synced': number };
  };
}

const DB_NAME = 'system-online-v2-client-db';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<BrewMasterDBSchema>> | null = null;

const CLIENT_B_INITIAL_ORDERS: Order[] = [
  {
    id: 'ord_b_101',
    orderNumber: '101',
    tableId: 'طاولة 1',
    status: 'Completed',
    paymentStatus: 'Paid',
    paymentMethod: 'Cash',
    items: [
      { id: '1', name: 'إسبيريسو دبل', quantity: 2, price: 45.00 },
      { id: '2', name: 'كرواسون زبدة', quantity: 1, price: 25.00 },
    ],
    totalAmount: 115.00,
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    paidAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
    branchId: 'main_branch'
  },
  {
    id: 'ord_b_102',
    orderNumber: '102',
    tableId: 'تيك أواي',
    status: 'Completed',
    paymentStatus: 'Paid',
    paymentMethod: 'Card',
    items: [
      { id: '3', name: 'لاتيه', quantity: 1, price: 60.00 },
      { id: '4', name: 'كابوتشينو', quantity: 1, price: 60.00 },
    ],
    totalAmount: 120.00,
    createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    paidAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    branchId: 'main_branch'
  },
  {
    id: 'ord_b_103',
    orderNumber: '103',
    tableId: 'طاولة 3',
    status: 'Preparing',
    paymentStatus: 'Unpaid',
    items: [
      { id: '5', name: 'سبانيش لاتيه', quantity: 1, price: 65.00 },
    ],
    totalAmount: 65.00,
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    branchId: 'main_branch'
  }
];

const CLIENT_B_INITIAL_INVENTORY: InventoryItem[] = [
  {
    id: 'inv_b_1',
    name: 'بن إسبيريسو فاخر',
    unit: 'كجم',
    stock: 25,
    minStock: 5,
    costPerUnit: 450,
    branchId: 'main_branch',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'inv_b_2',
    name: 'حليب كامل الدسم',
    unit: 'لتر',
    stock: 48,
    minStock: 10,
    costPerUnit: 35,
    branchId: 'main_branch',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'inv_b_3',
    name: 'أكواب ورقية سفري',
    unit: 'كوب',
    stock: 490,
    minStock: 50,
    costPerUnit: 2,
    branchId: 'main_branch',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const CLIENT_B_INITIAL_CUSTOMERS: Customer[] = [
  {
    id: 'cust_b_1',
    name: 'أحمد محمود',
    phone: '01012345678',
    points: 25,
    createdAt: new Date().toISOString(),
    branchId: 'main_branch'
  }
];

export function getDB(): Promise<IDBPDatabase<BrewMasterDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<BrewMasterDBSchema>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('menu_items')) {
          const menuStore = db.createObjectStore('menu_items', { keyPath: 'id' });
          menuStore.createIndex('by-category', 'category');
        }
        if (!db.objectStoreNames.contains('orders')) {
          const orderStore = db.createObjectStore('orders', { keyPath: 'id' });
          orderStore.createIndex('by-status', 'status');
          orderStore.createIndex('by-created', 'createdAt');
        }
        if (!db.objectStoreNames.contains('customers')) {
          const customerStore = db.createObjectStore('customers', { keyPath: 'id' });
          customerStore.createIndex('by-phone', 'phone', { unique: true });
        }
        if (!db.objectStoreNames.contains('inventory')) {
          db.createObjectStore('inventory', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
          syncStore.createIndex('by-synced', 'synced');
        }
      },
    }).then(async db => {
      // Seed Client B initial data if empty
      const orderCount = await db.count('orders');
      if (orderCount === 0) {
        const tx = db.transaction(['orders', 'inventory', 'customers', 'menu_items'], 'readwrite');
        for (const order of CLIENT_B_INITIAL_ORDERS) {
          await tx.objectStore('orders').put(order);
        }
        for (const item of CLIENT_B_INITIAL_INVENTORY) {
          await tx.objectStore('inventory').put(item);
        }
        for (const cust of CLIENT_B_INITIAL_CUSTOMERS) {
          await tx.objectStore('customers').put(cust);
        }
        for (const menu of INITIAL_MENU_ITEMS) {
          await tx.objectStore('menu_items').put(menu);
        }
        await tx.done;
      }
      return db;
    });
  }
  return dbPromise;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    console.log(`[Storage] Persistent storage granted: ${isPersisted}`);
    return isPersisted;
  }
  return false;
}
