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
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { MenuItem } from '../../types/menu';
import { Order } from '../../types/order';
import { Customer } from '../../types/customer';
import { Company } from '../../types/company';
import { InventoryItem } from '../../types/inventory';

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
    /Connection to Indexed Database server lost/i.test(msg) ||
    /terminated/i.test(msg) ||
    /closed/i.test(msg) ||
    /UnknownError/i.test(msg) ||
    /TransactionInactiveError/i.test(msg) ||
    /aborted/i.test(msg)
  );
}

function attachLifecycle(db: IDBPDatabase<BrewMasterDBSchema>) {
  // When another tab/version wants upgrade, close so upgrade can proceed
  db.addEventListener('versionchange', () => {
    console.debug('[IDB] versionchange — closing connection so the upgrade can run');
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

  // Logged at debug, not warn. A connection closing is ordinary lifecycle —
  // a reload, a second tab upgrading, the browser reclaiming an idle handle —
  // and `withDB` reopens transparently on the next call. Shouting about it in
  // production only trained operators to ignore the console, which is where the
  // errors that DO matter live.
  db.addEventListener('close', () => {
    console.debug('[IDB] connection closed — will reopen on next use');
    if (dbInstance === db) {
      dbInstance = null;
      openPromise = null;
    }
  });
}

async function openDatabase(): Promise<IDBPDatabase<BrewMasterDBSchema>> {
  if (dbInstance) {
    // Quick health probe — dead connections throw on transaction(). The probe
    // transaction is aborted immediately: leaving it to be garbage-collected
    // left an idle read transaction open on every getDB() call, which is enough
    // to make a browser hold the connection longer than it needs to.
    try {
      const probe = dbInstance.transaction('orders', 'readonly');
      // `idb` builds tx.done eagerly and rejects it with an AbortError the
      // moment we abort. Nobody awaits this probe, so that rejection surfaced
      // as "Uncaught (in promise) AbortError" on EVERY getDB() call — hundreds
      // of console errors per session. Claim the rejection before aborting.
      probe.done.catch(() => {
        // expected: we abort the probe on purpose
      });
      try {
        probe.abort();
      } catch {
        // already settled — nothing to release
      }
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
        console.debug('[IDB] blocking another tab’s upgrade — closing this connection');
        try {
          dbInstance?.close();
        } catch {
          // ignore
        }
        dbInstance = null;
        openPromise = null;
      },
      terminated() {
        // Same reasoning as the 'close' listener: the browser dropping the
        // handle is recoverable and recovered from. Kept at debug so it is
        // still there when someone is actually debugging storage.
        console.debug('[IDB] connection terminated by the browser — will reopen');
        dbInstance = null;
        openPromise = null;
      },
    });

    attachLifecycle(db);

    // We no longer automatically seed INITIAL_MENU_ITEMS or CLIENT_B_INITIAL_INVENTORY.
    // An empty menu/inventory is considered valid. If the user deletes all items,
    // they should remain deleted, rather than re-appearing on next app load.

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
    console.debug('[IDB] connection closing — reopening and retrying');
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

// Force drop cached connection (tests / recovery). Next getDB() reopens.
export function resetDBConnection() {
  try {
    dbInstance?.close();
  } catch {
    // ignore
  }
  dbInstance = null;
  openPromise = null;
}


