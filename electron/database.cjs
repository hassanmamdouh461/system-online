const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db;

// ─── Single-branch POS ───────────────────────────────────────────────────────
// This installation serves exactly one branch. Previously this returned
// 'default' while the web layer used 'main_branch' and the inventory layer used
// 'branch_1'; rows written under one id failed filters expecting another, so
// records intermittently disappeared from views. One constant, everywhere.
const MAIN_BRANCH_ID = 'main_branch';

function getBranchId() {
  return MAIN_BRANCH_ID;
}

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'brewmaster.db');
  console.log('[database] Initializing SQLite database at:', dbPath);
  
  db = new Database(dbPath);
  
  // Enable WAL mode for better concurrency/performance
  db.pragma('journal_mode = WAL');

  // Create menu table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS menu (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      image TEXT,
      available INTEGER NOT NULL DEFAULT 1
    )
  `).run();

  // No auto-seeding: the menu starts empty and is populated from the app / cloud sync.

  // Create orders table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      orderNumber TEXT NOT NULL,
      tableId TEXT NOT NULL,
      items TEXT NOT NULL, -- JSON string
      status TEXT NOT NULL,
      paymentStatus TEXT NOT NULL DEFAULT 'Unpaid',
      paymentMethod TEXT,
      totalAmount REAL NOT NULL,
      createdAt TEXT NOT NULL,
      paidAt TEXT
    )
  `).run();
  
  // Create customers table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      points REAL NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    )
  `).run();

  // Create companies table — mirrors the D1 schema so company profiles and
  // their OnAccount ledgers round-trip through Electron. Previously Electron
  // had no companies table at all, so company-billed orders lost their link.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tags TEXT,
      phone TEXT,
      notes TEXT,
      createdAt TEXT NOT NULL,
      branch_id TEXT DEFAULT NULL,
      is_synced INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    )
  `).run();

  // Create settings table for persistence of localStorage settings
  db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run();

  // Create inventory tables
  db.prepare(`
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      stock REAL NOT NULL DEFAULT 0,
      minStock REAL NOT NULL DEFAULT 0,
      costPerUnit REAL NOT NULL DEFAULT 0,
      branch_id TEXT DEFAULT NULL,
      is_synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS menu_recipes (
      menuItemId TEXT NOT NULL,
      inventoryItemId TEXT NOT NULL,
      quantity REAL NOT NULL,
      PRIMARY KEY (menuItemId, inventoryItemId)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id TEXT PRIMARY KEY,
      itemId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      referenceId TEXT,
      createdAt TEXT NOT NULL,
      branch_id TEXT DEFAULT NULL,
      is_synced INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    )
  `).run();

  // No auto-seeding: inventory starts empty and is populated from the app / cloud sync.

  // No auto-seeding: recipes are managed from the app and synced from the cloud.



  // Migration: Add paidAt column if table already existed without it
  try {
    db.prepare('ALTER TABLE orders ADD COLUMN paidAt TEXT').run();
  } catch (e) {
    // Column already exists or table didn't exist yet
  }

  // Migration: Add customer columns to orders
  try {
    db.prepare('ALTER TABLE orders ADD COLUMN customerPhone TEXT').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE orders ADD COLUMN pointsEarned REAL DEFAULT 0').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE orders ADD COLUMN pointsRedeemed REAL DEFAULT 0').run();
  } catch (e) {}

  // ─── Order financial + billing snapshot columns ─────────────────────────────
  // These mirror the D1 schema (schema.sql / schema-migrate-v2.sql + v4) so the
  // Electron local DB can store the same data the web client and worker already
  // persist. Without them, pulled orders lose tax/grandTotal and OnAccount
  // company/customer billing, which understates or mis-states revenue in reports.
  try { db.prepare('ALTER TABLE orders ADD COLUMN taxRate REAL').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE orders ADD COLUMN taxAmount REAL').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE orders ADD COLUMN grandTotal REAL').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE orders ADD COLUMN customerId TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE orders ADD COLUMN customerName TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE orders ADD COLUMN companyId TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE orders ADD COLUMN companyName TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE orders ADD COLUMN billedToType TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE orders ADD COLUMN refundedAt TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE orders ADD COLUMN refundReason TEXT').run(); } catch (e) {}
  // Soft-delete tombstone so cloud-deleted orders are not resurrected on pull.
  try { db.prepare('ALTER TABLE orders ADD COLUMN deletedAt TEXT').run(); } catch (e) {}

  // ─── Customer company/tags/notes columns ───────────────────────────────────
  // Mirror D1 schema so customer affiliation and tags survive sync.
  try { db.prepare('ALTER TABLE customers ADD COLUMN company_id TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE customers ADD COLUMN tags TEXT').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE customers ADD COLUMN notes TEXT').run(); } catch (e) {}

  // ─── Menu soft-delete tombstone ────────────────────────────────────────────
  // Lets a cloud-deleted menu item stay hidden instead of being re-pulled as live.
  try { db.prepare('ALTER TABLE menu ADD COLUMN deleted_at TEXT').run(); } catch (e) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1 Migration: Add branch_id, is_synced, created_at, updated_at
  // columns to menu, orders, and customers tables for multi-branch sync.
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Menu table: add sync columns ---
  try { db.prepare("ALTER TABLE menu ADD COLUMN branch_id TEXT DEFAULT NULL").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE menu ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE menu ADD COLUMN created_at TEXT").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE menu ADD COLUMN updated_at TEXT").run(); } catch (e) {}

  // --- Orders table: add sync columns (createdAt already exists) ---
  try { db.prepare("ALTER TABLE orders ADD COLUMN branch_id TEXT DEFAULT NULL").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE orders ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE orders ADD COLUMN updated_at TEXT").run(); } catch (e) {}

  // --- Customers table: add sync columns (createdAt already exists) ---
  try { db.prepare("ALTER TABLE customers ADD COLUMN branch_id TEXT DEFAULT NULL").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE customers ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE customers ADD COLUMN updated_at TEXT").run(); } catch (e) {}

  // Backfill: set timestamps on existing rows that have NULL created_at/updated_at
  try {
    const now = new Date().toISOString();
    db.prepare("UPDATE menu SET created_at = ? WHERE created_at IS NULL").run(now);
    db.prepare("UPDATE menu SET updated_at = ? WHERE updated_at IS NULL").run(now);
    db.prepare("UPDATE orders SET updated_at = ? WHERE updated_at IS NULL").run(now);
    db.prepare("UPDATE customers SET updated_at = ? WHERE updated_at IS NULL").run(now);
    console.log('[database] Phase 1 sync columns migration complete.');
  } catch (e) {
    console.error('[database] Failed to backfill sync timestamps:', e);
  }

  // Migration: convert legacy mock orders ("Table N") to Dine-in/Takeaway.
  //
  // This migration is DESTRUCTIVE and previously ran on every single boot with
  // no version guard. Worse, it selected ALL orders rather than the legacy ones,
  // so a single order named e.g. "Table 5" caused every order in the database —
  // including real paid ones — to be reset to New/Unpaid with paidAt and
  // paymentMethod wiped. It is now (a) guarded by a one-time flag in settings
  // and (b) scoped to only the legacy rows it is meant to touch.
  try {
    const alreadyRun = db
      .prepare("SELECT value FROM settings WHERE key = 'migration_legacy_orders_done'")
      .get();

    if (!alreadyRun) {
      const rows = db
        .prepare("SELECT * FROM orders WHERE tableId LIKE 'Table %' ORDER BY createdAt ASC")
        .all();

      if (rows.length > 0) {
        console.log(`[database] Migrating ${rows.length} legacy order(s) to Dine-in/Takeaway...`);

        // Only the table label is rewritten. Payment state is real financial
        // data and is never touched by a migration.
        const updateStmt = db.prepare('UPDATE orders SET tableId = ? WHERE id = ?');

        const runTx = db.transaction(() => {
          let i = 1;
          for (const row of rows) {
            updateStmt.run(i % 2 === 1 ? 'Dine-in' : 'Takeaway', row.id);
            i++;
          }
        });
        runTx();
      }

      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run('migration_legacy_orders_done', new Date().toISOString());
    }
  } catch (e) {
    console.error('[database] Failed to run legacy orders migration:', e);
  }

  // Migration: re-categorize menu items to MenuCategory|PrepDestination format.
  //
  // Guarded by a one-time flag: this infers categories from item names, so
  // running it on every boot silently reverted any category the owner had
  // corrected by hand.
  try {
    const menuMigrationDone = db
      .prepare("SELECT value FROM settings WHERE key = 'migration_menu_categories_done'")
      .get();

    if (!menuMigrationDone) {
    const allItems = db.prepare('SELECT id, name, category FROM menu').all();
    const updateStmt = db.prepare('UPDATE menu SET category = ? WHERE id = ?');
    
    db.transaction(() => {
      for (const item of allItems) {
        const nameLower = (item.name || '').toLowerCase();
        const currentCat = item.category || '';
        
        // Skip items already in correct new format with proper menu category (not just Hot Coffee|Bar for everything)
        // We re-run this to fix items that were incorrectly all set to Hot Coffee|Bar
        
        let menuCategory = '';
        let prepDest = '';
        
        // Determine preparation destination
        // If already has a pipe, extract existing prep destination
        if (currentCat.includes('|')) {
          prepDest = currentCat.split('|')[1] || 'Bar';
        } else if (currentCat === 'Kitchen' || currentCat === 'Food' || currentCat === 'Chicken Meals') {
          prepDest = 'Kitchen';
        } else {
          prepDest = 'Bar';
        }
        
        // If prep destination is Kitchen, map to specific menu sub-categories
        if (prepDest === 'Kitchen') {
          const friesKeywords = ['fries', 'بطاطس', 'مقبلات', 'سناكس'];
          const dessertKeywords = ['cake', 'brownie', 'كيك', 'براوني', 'حلويات', 'fudge', 'فادج'];
          
          if (dessertKeywords.some(k => nameLower.includes(k))) {
            menuCategory = 'حلويات';
          } else if (friesKeywords.some(k => nameLower.includes(k))) {
            menuCategory = 'مقبلات';
          } else {
            menuCategory = 'ساندوتشات';
          }
        } else {
          // Determine menu category from item name for bar items
          const icedKeywords = ['iced', 'cold brew', 'cold', 'mint lemonade', 'peach iced', 'passion fruit', 'mojito', 'lemonade', 'بارد', 'مثلج', 'نعناع', 'خوخ', 'موهيتو', 'ليمون', 'عصير', 'أيس', 'ايس'];
          const frappeKeywords = ['frappe', 'frappé', 'فرابيه'];
          const milkshakeKeywords = ['milkshake', 'milk shake', 'ميلك شيك', 'شيك'];
          
          if (frappeKeywords.some(k => nameLower.includes(k))) {
            menuCategory = 'Frappe';
          } else if (milkshakeKeywords.some(k => nameLower.includes(k))) {
            menuCategory = 'Milkshakes';
          } else if (icedKeywords.some(k => nameLower.includes(k))) {
            menuCategory = 'Iced Coffee';
          } else {
            menuCategory = 'Hot Coffee';
          }
        }
        
        const newCategory = `${menuCategory}|${prepDest}`;
        if (newCategory !== currentCat) {
          updateStmt.run(newCategory, item.id);
        }
      }
    })();
    
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('migration_menu_categories_done', new Date().toISOString());

    console.log('[database] Successfully migrated menu categories to MenuCategory|PrepDestination format');
    }
  } catch (e) {
    console.error('[database] Failed to run menu categories migration:', e);
  }
}

// Ensure database is initialized
function getDb() {
  if (!db) {
    initDatabase();
  }
  return db;
}

// --- Settings & Metadata Persistence ---

function getSettings() {
  const sqlite = getDb();
  try {
    const rows = sqlite.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  } catch (e) {
    console.error('[database] Failed to get settings:', e);
    return {};
  }
}

function saveSetting(key, value) {
  const sqlite = getDb();
  try {
    sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  } catch (e) {
    console.error('[database] Failed to save setting:', e);
  }
}

function deleteSetting(key) {
  const sqlite = getDb();
  try {
    sqlite.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } catch (e) {
    console.error('[database] Failed to delete setting:', e);
  }
}

function getSyncStats() {
  const sqlite = getDb();
  try {
    const menuCount = sqlite.prepare('SELECT COUNT(*) as count FROM menu WHERE is_synced = 0').get().count;
    const ordersCount = sqlite.prepare('SELECT COUNT(*) as count FROM orders WHERE is_synced = 0').get().count;
    const customersCount = sqlite.prepare('SELECT COUNT(*) as count FROM customers WHERE is_synced = 0').get().count;
    const inventoryCount = sqlite.prepare('SELECT COUNT(*) as count FROM inventory WHERE is_synced = 0').get().count;
    // Companies + inventory transactions now participate in sync (previously
    // they were invisible to the pending counter, so the SyncStatus badge lied).
    let companiesCount = 0;
    let txCount = 0;
    try { companiesCount = sqlite.prepare('SELECT COUNT(*) as count FROM companies WHERE is_synced = 0').get().count; } catch (_) {}
    try { txCount = sqlite.prepare('SELECT COUNT(*) as count FROM inventory_transactions WHERE is_synced = 0').get().count; } catch (_) {}
    return {
      pendingMenu: menuCount,
      pendingOrders: ordersCount,
      pendingCustomers: customersCount,
      pendingInventory: inventoryCount,
      pendingCompanies: companiesCount,
      pendingTransactions: txCount,
      totalPending: menuCount + ordersCount + customersCount + inventoryCount + companiesCount + txCount
    };
  } catch (e) {
    console.error('[database] Failed to get sync stats:', e);
    return { pendingMenu: 0, pendingOrders: 0, pendingCustomers: 0, pendingInventory: 0, pendingCompanies: 0, pendingTransactions: 0, totalPending: 0 };
  }
}

module.exports = {
  initDatabase,
  getDb,
  getBranchId,
  getSettings,
  saveSetting,
  deleteSetting,
  getSyncStats
};
