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

  // Migration: Update existing mock/legacy orders to Dine-in/Takeaway and reset them as new orders today
  try {
    const legacyCount = db.prepare("SELECT COUNT(*) as count FROM orders WHERE tableId LIKE 'Table %'").get().count;
    if (legacyCount > 0) {
      console.log('[database] Migrating legacy orders to Dine-in/Takeaway and resetting status...');
      const rows = db.prepare("SELECT * FROM orders ORDER BY createdAt ASC").all();
      
      const updateStmt = db.prepare(`
        UPDATE orders 
        SET orderNumber = ?, tableId = ?, status = 'New', paymentStatus = 'Unpaid', paymentMethod = NULL, paidAt = NULL, createdAt = ? 
        WHERE id = ?
      `);
      
      const runTx = db.transaction(() => {
        let i = 1;
        const now = new Date();
        for (const row of rows) {
          const tableId = (i % 2 === 1) ? 'Dine-in' : 'Takeaway';
          const orderTime = new Date(now.getTime() - 1000 * 60 * (rows.length - i) * 3).toISOString();
          updateStmt.run(String(i), tableId, orderTime, row.id);
          i++;
        }
      });
      runTx();
    }
  } catch (e) {
    console.error('[database] Failed to run legacy orders migration:', e);
  }

  // Migration: Smart re-categorize all menu items to MenuCategory|PrepDestination format
  // This uses item names to determine the correct menu category for QR menu display
  try {
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
    
    console.log('[database] Successfully migrated menu categories to MenuCategory|PrepDestination format');
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
    return {
      pendingMenu: menuCount,
      pendingOrders: ordersCount,
      pendingCustomers: customersCount,
      pendingInventory: inventoryCount,
      totalPending: menuCount + ordersCount + customersCount + inventoryCount
    };
  } catch (e) {
    console.error('[database] Failed to get sync stats:', e);
    return { pendingMenu: 0, pendingOrders: 0, pendingCustomers: 0, pendingInventory: 0, totalPending: 0 };
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
