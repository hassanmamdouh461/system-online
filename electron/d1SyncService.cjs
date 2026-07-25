/**
 * Cloudflare D1 Sync API Service
 * Standard REST & Sync API requests to our Cloudflare Worker D1 Proxy.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const database = require('./database.cjs');

// 1. Resolve Worker URL & API Key from .env file or local database settings
let WORKER_URL = "";
let API_KEY = "";

try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const matchUrl =
      envContent.match(/VITE_CLOUDFLARE_WORKER_URL\s*=\s*(.*)/) ||
      envContent.match(/VITE_CF_WORKER_URL\s*=\s*(.*)/);
    if (matchUrl && matchUrl[1]) {
      WORKER_URL = matchUrl[1].trim().replace(/^["']|["']$/g, '');
    }

    // SECURITY: read CLOUDFLARE_API_KEY (non-VITE name). Keep the legacy
    // VITE_ name as a fallback so older .env files keep working, but the
    // canonical key must NOT be bundled into the web client.
    const matchKey =
      envContent.match(/CLOUDFLARE_API_KEY\s*=\s*(.*)/) ||
      envContent.match(/VITE_CLOUDFLARE_API_KEY\s*=\s*(.*)/);
    if (matchKey && matchKey[1]) {
      API_KEY = matchKey[1].trim().replace(/^["']|["']$/g, '');
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

// No placeholder fallback: an unconfigured sync layer should say so plainly
// rather than logging a fake endpoint that looks configured.
if (WORKER_URL) {
  console.log('[D1 Sync API] Configured Worker URL:', WORKER_URL);
} else {
  console.warn('[D1 Sync API] No Worker URL configured — cloud sync is disabled. Set VITE_CLOUDFLARE_WORKER_URL in .env or brewmaster_d1_worker_url in settings.');
}

/**
 * Custom fetch implementation using standard Node.js https module
 */
function fetchWorker(urlPath, payload = null, method = 'POST') {
  return new Promise((resolve, reject) => {
    if (!WORKER_URL) {
      return reject(new Error('Cloudflare Worker URL is not properly configured'));
    }

    const baseUrl = WORKER_URL.endsWith('/') ? WORKER_URL.slice(0, -1) : WORKER_URL;
    const targetUrl = new URL(baseUrl + urlPath);
    const bodyStr = payload ? JSON.stringify(payload) : null;

    const headers = {};
    if (bodyStr) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    if (API_KEY) {
      headers['Authorization'] = `Bearer ${API_KEY}`;
      headers['X-API-Key'] = API_KEY;
    }
    // Prefer branch_id from settings; fallback main_branch
    let branchHeader = 'main_branch';
    try {
      const settings = database.getSettings();
      if (settings['branch_id']) branchHeader = settings['branch_id'];
      else if (settings['brewmaster_branch_config']) {
        try {
          const bc = JSON.parse(settings['brewmaster_branch_config']);
          if (bc.branchId) branchHeader = bc.branchId;
        } catch (_) {}
      }
    } catch (_) {}
    headers['X-Branch-ID'] = branchHeader;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || 443,
      path: targetUrl.pathname + targetUrl.search,
      method: method,
      headers: headers,
      timeout: 15000
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

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ─── API Sync Methods ──────────────────────────────────────────────────────────

async function pushMenuItems(items) {
  if (items.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${items.length} menu items...`);

  for (const item of items) {
    await fetchWorker('/api/sync', {
      type: 'menu',
      action: 'create',
      data: item
    }, 'POST');
  }
  return { success: true };
}

async function pushOrders(orders) {
  if (orders.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${orders.length} orders...`);

  for (const order of orders) {
    await fetchWorker('/api/sync', {
      type: 'order',
      action: 'create',
      data: order
    }, 'POST');
  }
  return { success: true };
}

async function pushCustomers(customers) {
  if (customers.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${customers.length} customers...`);

  for (const c of customers) {
    await fetchWorker('/api/sync', {
      type: 'customer',
      action: 'create',
      data: c
    }, 'POST');
  }
  return { success: true };
}

async function pushInventory(items) {
  if (items.length === 0) return { success: true };
  console.log(`[D1 Sync API] Pushing ${items.length} inventory items...`);

  for (const item of items) {
    await fetchWorker('/api/sync', {
      type: 'inventory',
      action: 'create',
      data: item
    }, 'POST');
  }
  return { success: true };
}

async function pullOrders() {
  console.log('[D1 Sync API] Pulling orders from D1...');
  const res = await fetchWorker('/v1/databases/default/collections/orders/documents', null, 'GET');
  const documents = res.documents || [];

  return documents.map(doc => ({
    $id: doc.$id || doc.id,
    $createdAt: doc.$createdAt || doc.createdAt,
    $updatedAt: doc.$updatedAt || doc.createdAt,
    total_amount: Number(doc.totalAmount || doc.total_amount || 0),
    payment_method: doc.paymentMethod || doc.payment_method || 'Cash',
    items: doc.items,
    branch_id: doc.branch_id || doc.branchId
  }));
}

async function deleteMenuItem(id) {
  console.log(`[D1 Sync API] Deleting menu item ${id}...`);
  try {
    await fetchWorker('/api/sync', {
      type: 'menu',
      action: 'delete',
      data: { id }
    }, 'POST');
  } catch (err) {
    console.error(`[D1 Sync API] Failed to delete menu item ${id}:`, err.message);
  }
}

async function getManagerOrders() {
  console.log('[D1 Sync API] Manager fetching all orders...');
  const res = await fetchWorker('/v1/databases/default/collections/orders/documents', null, 'GET');
  const documents = res.documents || [];

  return documents.map(doc => ({
    $id: doc.$id || doc.id,
    $createdAt: doc.$createdAt || doc.createdAt,
    $updatedAt: doc.$updatedAt || doc.createdAt,
    total_amount: Number(doc.totalAmount || doc.total_amount || 0),
    payment_method: doc.paymentMethod || doc.payment_method || 'Cash',
    items: doc.items,
    branch_id: doc.branch_id || doc.branchId
  }));
}

async function getManagerCustomers() {
  console.log('[D1 Sync API] Manager fetching all customers...');
  const res = await fetchWorker('/v1/databases/default/collections/customers/documents', null, 'GET');
  const documents = res.documents || [];

  return documents.map(doc => ({
    $id: doc.$id || doc.id,
    $createdAt: doc.$createdAt || doc.createdAt,
    $updatedAt: doc.$updatedAt || doc.createdAt,
    name: doc.name,
    phone: doc.phone,
    points: Number(doc.points || 0),
    branchId: doc.branch_id || doc.branchId
  }));
}

async function getManagerInventory() {
  console.log('[D1 Sync API] Manager fetching all inventory...');
  const res = await fetchWorker('/v1/databases/default/collections/inventory/documents', null, 'GET');
  const documents = res.documents || [];

  return documents.map(doc => ({
    $id: doc.$id || doc.id,
    name: doc.name,
    unit: doc.unit,
    stock: Number(doc.stock || 0),
    minStock: Number(doc.minStock || 0),
    costPerUnit: Number(doc.costPerUnit || 0),
    branch_id: doc.branch_id || doc.branchId
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
