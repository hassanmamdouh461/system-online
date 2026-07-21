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

const CLIENT_B_INITIAL_ORDERS: Order[] = [];

export const CLIENT_B_INITIAL_INVENTORY: InventoryItem[] = [
  { id: 'inv_b_1', name: 'بن إسبيريسو فاخر', unit: 'كجم', stock: 25, minStock: 5, costPerUnit: 450, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_2', name: 'حليب كامل الدسم', unit: 'لتر', stock: 48, minStock: 10, costPerUnit: 35, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_3', name: 'أكواب ورقية سفري', unit: 'كوب', stock: 490, minStock: 50, costPerUnit: 2, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_4', name: 'خبز توست وكايزر', unit: 'قطعة', stock: 200, minStock: 20, costPerUnit: 3, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_5', name: 'صوص شيكولاتة فاخر', unit: 'كجم', stock: 15, minStock: 2, costPerUnit: 120, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_6', name: 'صوص كراميل محلى', unit: 'لتر', stock: 10, minStock: 2, costPerUnit: 150, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_7', name: 'سيروب فانيليا', unit: 'لتر', stock: 10, minStock: 2, costPerUnit: 140, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_8', name: 'سيروب بستاشيو (فستق)', unit: 'لتر', stock: 8, minStock: 1, costPerUnit: 220, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_9', name: 'بسكويت أوريو', unit: 'قطعة', stock: 500, minStock: 50, costPerUnit: 3, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_10', name: 'آيس كريم فانيليا', unit: 'كجم', stock: 20, minStock: 3, costPerUnit: 90, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_11', name: 'شاي أسود وأخضر فاخر', unit: 'كجم', stock: 5, minStock: 1, costPerUnit: 200, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_12', name: 'سيروب خوخ وباشون فروت', unit: 'لتر', stock: 10, minStock: 2, costPerUnit: 160, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_13', name: 'ليمون ونعناع طازج', unit: 'كجم', stock: 15, minStock: 3, costPerUnit: 25, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_14', name: 'صودا ومياه غازية', unit: 'لتر', stock: 50, minStock: 10, costPerUnit: 15, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_15', name: 'صدور دجاج', unit: 'كجم', stock: 30, minStock: 5, costPerUnit: 160, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_16', name: 'لحم بقري صافي', unit: 'كجم', stock: 25, minStock: 5, costPerUnit: 320, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_17', name: 'جبنة شيدر وموزاريلا', unit: 'كجم', stock: 20, minStock: 3, costPerUnit: 180, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_18', name: 'شرائح ديك رومي (تركي)', unit: 'كجم', stock: 10, minStock: 2, costPerUnit: 210, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_19', name: 'بطاطس نصف مقلية', unit: 'كجم', stock: 40, minStock: 5, costPerUnit: 45, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_20', name: 'كرواسون وسمن طبيعي', unit: 'قطعة', stock: 100, minStock: 15, costPerUnit: 12, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_21', name: 'دقيق وخامات براونيز وكيك', unit: 'كجم', stock: 30, minStock: 5, costPerUnit: 40, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_22', name: 'خضراوات (خس وطماطم)', unit: 'كجم', stock: 20, minStock: 4, costPerUnit: 20, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_23', name: 'مايونيز وصوصات خاصة', unit: 'كجم', stock: 15, minStock: 3, costPerUnit: 80, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'inv_b_24', name: 'فراولة ومانجو طازجة', unit: 'كجم', stock: 25, minStock: 5, costPerUnit: 50, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

const CLIENT_B_INITIAL_CUSTOMERS: Customer[] = [];

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
      // Seed Client B initial data if empty or merge missing inventory
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
      } else {
        // Ensure all 24 inventory items exist in store
        const tx = db.transaction('inventory', 'readwrite');
        for (const item of CLIENT_B_INITIAL_INVENTORY) {
          const existing = await tx.objectStore('inventory').get(item.id);
          if (!existing) {
            await tx.objectStore('inventory').put(item);
          }
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
    return isPersisted;
  }
  return false;
}
