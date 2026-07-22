/**
 * IndexedDB connection manager — single source of truth for local POS storage.
 *
 * Fixes the production bug:
 *   "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing."
 *
 * Root causes that this layer eliminates:
 * 1. Cached connection invalidated by versionchange / upgrade
 * 2. Concurrent open + upgrade races
 * 3. Hydrate writes fighting order creates on a dying connection
 * 4. No retry after connection drop
 */
import { openDB, DBSchema, IDBPDatabase, IDBPTransaction } from 'idb';
import { MenuItem, INITIAL_MENU_ITEMS } from '../../types/menu';
import { Order } from '../../types/order';
import { Customer } from '../../types/customer';
import { Company } from '../../types/company';
import { InventoryItem } from '../../global';

export interface SyncRecord {
  id: string;
  type:
    | 'order'
    | 'menu'
    | 'customer'
    | 'inventory'
    | 'company'
    | 'settings'
    | 'recipes'
    | 'inventory_transactions'
    | 'snapshots';
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp: string;
  synced: number;
  attempts?: number;
  lastError?: string;
  nextRetryAt?: string;
  syncedAt?: string;
  dead?: boolean;
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
  companies: {
    key: string;
    value: Company;
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

export type StoreName =
  | 'menu_items'
  | 'orders'
  | 'customers'
  | 'companies'
  | 'inventory'
  | 'sync_queue';

const DB_NAME = 'system-online-v2-client-db';
/** v5: hardened connection lifecycle; customers phone index non-unique */
const DB_VERSION = 5;

const CLIENT_B_INITIAL_INVENTORY: InventoryItem[] = [
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
  { id: 'inv_b_24', name: 'فراولة ومانجو طازجة', unit: 'كجم', stock: 25, minStock: 5, costPerUnit: 50, branchId: 'main_branch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

// ─── Connection state ──────────────────────────────────────────────────────────
let dbInstance: IDBPDatabase<BrewMasterDBSchema> | null = null;
let openPromise: Promise<IDBPDatabase<BrewMasterDBSchema>> | null = null;
/** Serialize all write operations so hydrate never races create-order */
let writeChain: Promise<unknown> = Promise.resolve();

function isClosingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /connection is closing/i.test(msg) ||
    /database connection is closing/i.test(msg) ||
    /InvalidStateError/i.test(msg) ||
    /database has been closed/i.test(msg) ||
    /Connection to Indexed Database server lost/i.test(msg)
  );
}

function attachLifecycle(db: IDBPDatabase<BrewMasterDBSchema>) {
  // When another tab/version wants upgrade, close so upgrade can proceed
  db.addEventListener('versionchange', () => {
    console.warn('[IDB] versionchange — closing connection for upgrade');
    try {
      db.close();
    } catch {
      // ignore
    }
    if (dbInstance === db) {
      dbInstance = null;
      openPromise = null;
    }
  });

  db.addEventListener('close', () => {
    console.warn('[IDB] connection closed');
    if (dbInstance === db) {
      dbInstance = null;
      openPromise = null;
    }
  });
}

async function openDatabase(): Promise<IDBPDatabase<BrewMasterDBSchema>> {
  if (dbInstance) {
    // Quick health probe — dead connections throw on transaction()
    try {
      dbInstance.transaction('orders', 'readonly');
      return dbInstance;
    } catch {
      dbInstance = null;
      openPromise = null;
    }
  }

  if (openPromise) return openPromise;

  openPromise = (async () => {
    const db = await openDB<BrewMasterDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // ── stores ──
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
          customerStore.createIndex('by-phone', 'phone', { unique: false });
        } else if (oldVersion < 5 && transaction) {
          try {
            const customerStore = transaction.objectStore('customers');
            if (customerStore.indexNames.contains('by-phone')) {
              customerStore.deleteIndex('by-phone');
            }
            customerStore.createIndex('by-phone', 'phone', { unique: false });
          } catch (e) {
            console.warn('[IDB upgrade] customers index rebuild:', e);
          }
        }
        if (!db.objectStoreNames.contains('companies')) {
          db.createObjectStore('companies', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('inventory')) {
          db.createObjectStore('inventory', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
          syncStore.createIndex('by-synced', 'synced');
        }
      },
      blocked() {
        console.warn('[IDB] open blocked — another tab holds an older version. Close other tabs.');
      },
      blocking() {
        // We hold a connection that blocks someone else's upgrade — close ourselves
        console.warn('[IDB] blocking other connection — closing');
        try {
          dbInstance?.close();
        } catch {
          // ignore
        }
        dbInstance = null;
        openPromise = null;
      },
      terminated() {
        console.warn('[IDB] terminated unexpectedly');
        dbInstance = null;
        openPromise = null;
      },
    });

    attachLifecycle(db);

    // Seed defaults only when empty (after wipe). Never invent fake orders.
    try {
      const menuCount = await db.count('menu_items');
      if (menuCount === 0) {
        const tx = db.transaction('menu_items', 'readwrite');
        for (const menu of INITIAL_MENU_ITEMS) {
          await tx.store.put(menu);
        }
        await tx.done;
      }
      const invCount = await db.count('inventory');
      if (invCount === 0) {
        const tx = db.transaction('inventory', 'readwrite');
        for (const item of CLIENT_B_INITIAL_INVENTORY) {
          await tx.store.put(item);
        }
        await tx.done;
      }
    } catch (seedErr) {
      console.warn('[IDB] seed skipped:', seedErr);
    }

    dbInstance = db;
    return db;
  })().catch((err) => {
    openPromise = null;
    dbInstance = null;
    throw err;
  });

  return openPromise;
}

/**
 * Get a live DB connection. Always prefer this over caching the connection yourself.
 */
export async function getDB(): Promise<IDBPDatabase<BrewMasterDBSchema>> {
  return openDatabase();
}

/**
 * Run an async fn with a healthy DB. Retries once if connection is closing.
 */
export async function withDB<T>(fn: (db: IDBPDatabase<BrewMasterDBSchema>) => Promise<T>): Promise<T> {
  try {
    const db = await getDB();
    return await fn(db);
  } catch (err) {
    if (!isClosingError(err)) throw err;
    console.warn('[IDB] connection closing — reopening and retrying');
    dbInstance = null;
    openPromise = null;
    const db = await getDB();
    return await fn(db);
  }
}

/**
 * Serialize write work so hydrate and POS order-create never interleave badly.
 */
export function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  // Keep chain alive even if this task fails
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Put many rows into one store, one transaction, row-level skip on bad data.
 */
export async function putMany(
  storeName: StoreName,
  rows: any[]
): Promise<number> {
  if (!rows.length) return 0;
  return withDB(async (db) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    let n = 0;
    for (const row of rows) {
      try {
        await store.put(row);
        n++;
      } catch (e) {
        console.warn(`[IDB] skip bad row in ${String(storeName)}:`, e);
      }
    }
    await tx.done;
    return n;
  });
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // ignore
  }
  return false;
}

/** Force drop cached connection (tests / recovery). Next getDB() reopens. */
export function resetDBConnection() {
  try {
    dbInstance?.close();
  } catch {
    // ignore
  }
  dbInstance = null;
  openPromise = null;
}

// re-export inventory seed for any legacy imports
export { CLIENT_B_INITIAL_INVENTORY };
