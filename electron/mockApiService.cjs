/**
 * Cloudflare D1 Sync API Service
 * Replaces the Appwrite REST API with standard HTTP requests to our Cloudflare Worker Proxy.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const database = require('./database.cjs');

// 1. Resolve Worker URL from .env file or local database settings
let WORKER_URL = "";
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/VITE_CF_WORKER_URL\s*=\s*(.*)/);
    if (match && match[1]) {
      WORKER_URL = match[1].trim();
    }
  }
} catch (e) {
  console.error('[D1 Sync API] Failed to load .env file:', e.message);
}

if (!WORKER_URL) {
  try {
    const settings = database.getSettings();
    if (settings['brewmaster_d1_worker_url']) {
      WORKER_URL = settings['brewmaster_d1_worker_url'];
    }
  } catch (e) {}
}

if (!WORKER_URL) {
  WORKER_URL = "https://your-worker.your-username.workers.dev"; // default placeholder
}

console.log('[D1 Sync API] Configured Worker URL:', WORKER_URL);

/**
 * Custom fetch implementation using standard Node.js https module
 */
function fetchWorker(payload) {
  return new Promise((resolve, reject) => {
    if (!WORKER_URL || WORKER_URL.includes('your-username')) {
      return reject(new Error('Cloudflare Worker URL is not configured'));
    }

    const parsedUrl = new URL(WORKER_URL);
    const bodyStr = JSON.stringify(payload);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      },
      timeout: 15000 // 15 seconds
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse json response: ${data}`));
          }
        } else {
          reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timed out'));
    });

    req.write(bodyStr);
    req.end();
  });
}

// ─── API Sync Methods ──────────────────────────────────────────────────────────

async function pushMenuItems(items) {
  if (items.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${items.length} menu items...`);

  const batch = items.map(item => ({
    sql: `INSERT OR REPLACE INTO menu_items (id, name, description, price, category, image, available, branch_id) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      item.id,
      item.name,
      item.description || "",
      Number(item.price),
      item.category,
      item.image || "",
      item.available ? 1 : 0,
      item.branchId || item.branch_id || "branch_1"
    ]
  }));

  const res = await fetchWorker({ batch });
  if (!res.success) {
    throw new Error(res.error || 'Failed to push menu items to D1');
  }
  return { success: true };
}

async function pushOrders(orders) {
  if (orders.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${orders.length} orders...`);

  const batch = orders.map(order => ({
    sql: `INSERT OR REPLACE INTO orders (id, orderNumber, tableId, items, status, paymentStatus, paymentMethod, totalAmount, createdAt, paidAt, branch_id) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      order.id,
      order.orderNumber,
      order.tableId,
      typeof order.items === 'string' ? order.items : JSON.stringify(order.items),
      order.status,
      order.paymentStatus || 'Unpaid',
      order.paymentMethod || null,
      Number(order.totalAmount),
      order.createdAt,
      order.paidAt || null,
      order.branchId || order.branch_id || "branch_1"
    ]
  }));

  const res = await fetchWorker({ batch });
  if (!res.success) {
    throw new Error(res.error || 'Failed to push orders to D1');
  }
  return { success: true };
}

async function pushCustomers(customers) {
  if (customers.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${customers.length} customers...`);

  const batch = customers.map(c => ({
    sql: `INSERT OR REPLACE INTO customers (id, name, phone, points, createdAt, branch_id) 
          VALUES (?, ?, ?, ?, ?, ?)`,
    params: [
      c.id,
      c.name,
      c.phone,
      Number(c.points) || 0,
      c.createdAt,
      c.branchId || c.branch_id || "branch_1"
    ]
  }));

  const res = await fetchWorker({ batch });
  if (!res.success) {
    throw new Error(res.error || 'Failed to push customers to D1');
  }
  return { success: true };
}

async function pushInventory(items) {
  if (items.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${items.length} inventory items...`);

  const batch = items.map(item => ({
    sql: `INSERT OR REPLACE INTO inventory (id, name, unit, stock, minStock, costPerUnit, branch_id, created_at, updated_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      item.id,
      item.name,
      item.unit,
      Number(item.stock) || 0,
      Number(item.minStock) || 0,
      Number(item.costPerUnit) || 0,
      item.branchId || item.branch_id || "branch_1",
      item.createdAt || new Date().toISOString(),
      item.updatedAt || new Date().toISOString()
    ]
  }));

  const res = await fetchWorker({ batch });
  if (!res.success) {
    throw new Error(res.error || 'Failed to push inventory to D1');
  }
  return { success: true };
}

async function pullOrders() {
  console.log('[D1 Sync API] Pulling orders from D1...');
  const res = await fetchWorker({
    sql: "SELECT * FROM orders ORDER BY createdAt DESC LIMIT 1000"
  });

  if (!res.success) {
    throw new Error(res.error || 'Failed to pull orders from D1');
  }

  // D1 query response: results is under res.result[0].results
  const rows = res.result[0]?.results || [];
  
  // Map back to Appwrite document structure format expected by upsertPulledOrders
  return rows.map(row => ({
    $id: row.id,
    $createdAt: row.createdAt,
    $updatedAt: row.createdAt, // fallback to createdAt since D1 orders doesn't have updated_at
    total_amount: Number(row.totalAmount),
    payment_method: row.paymentMethod || 'Cash',
    items: row.items, // JSON string
    branch_id: row.branch_id
  }));
}

async function deleteMenuItem(id) {
  console.log(`[D1 Sync API] Deleting menu item ${id}...`);
  const res = await fetchWorker({
    sql: "DELETE FROM menu_items WHERE id = ?",
    params: [id]
  });
  if (!res.success) {
    console.error(`[D1 Sync API] Failed to delete menu item ${id}:`, res.error);
  }
}

async function getManagerOrders() {
  console.log('[D1 Sync API] Manager fetching all orders...');
  const res = await fetchWorker({
    sql: "SELECT * FROM orders ORDER BY createdAt DESC LIMIT 1000"
  });
  if (!res.success) {
    throw new Error(res.error || 'Failed to fetch manager orders');
  }
  const rows = res.result[0]?.results || [];
  return rows.map(row => ({
    $id: row.id,
    $createdAt: row.createdAt,
    $updatedAt: row.createdAt,
    total_amount: Number(row.totalAmount),
    payment_method: row.paymentMethod || 'Cash',
    items: row.items,
    branch_id: row.branch_id
  }));
}

async function getManagerCustomers() {
  console.log('[D1 Sync API] Manager fetching all customers...');
  const res = await fetchWorker({
    sql: "SELECT * FROM customers ORDER BY createdAt DESC LIMIT 1000"
  });
  if (!res.success) {
    throw new Error(res.error || 'Failed to fetch manager customers');
  }
  const rows = res.result[0]?.results || [];
  return rows.map(row => ({
    $id: row.id,
    $createdAt: row.createdAt,
    $updatedAt: row.createdAt,
    name: row.name,
    phone: row.phone,
    points: Number(row.points),
    branchId: row.branch_id
  }));
}

async function getManagerInventory() {
  console.log('[D1 Sync API] Manager fetching all inventory...');
  const res = await fetchWorker({
    sql: "SELECT * FROM inventory ORDER BY name ASC LIMIT 1000"
  });
  if (!res.success) {
    throw new Error(res.error || 'Failed to fetch manager inventory');
  }
  const rows = res.result[0]?.results || [];
  return rows.map(row => ({
    $id: row.id,
    name: row.name,
    unit: row.unit,
    stock: Number(row.stock),
    minStock: Number(row.minStock),
    costPerUnit: Number(row.costPerUnit),
    branch_id: row.branch_id
  }));
}

module.exports = {
  pushMenuItems,
  pushOrders,
  pushCustomers,
  pushInventory,
  pullOrders,
  deleteMenuItem,
  getManagerOrders,
  getManagerCustomers,
  getManagerInventory
};
