import { authenticate, handleSessionRoutes } from "./auth.ts";

interface Env {
  DB: D1Database;
  /** Legacy shared key — optional now; still honored by auth.ts (⇒ manager) if set. */
  API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  /** HMAC secret that signs session cookies (see auth.ts). REQUIRED to mint. */
  SESSION_SECRET?: string;
  AUTH_TOKEN_SECRET?: string;
  /** Role-scoped keys for headless callers (see auth.ts / wrangler.toml). */
  MANAGER_API_KEY?: string;
  CASHIER_API_KEY?: string;
}

// Incremental-sync column per table (names are inconsistent across tables).
const UPDATED_AT_COLUMN: Record<string, string> = {
  menu_items: "updated_at",
  orders: "updatedAt",
  customers: "updated_at",
  companies: "updated_at",
  inventory: "updated_at",
  settings: "updated_at",
  recipes: "updated_at",
};

const ALLOWED_TABLE_MAP: Record<string, string> = {
  menu: "menu_items",
  menu_items: "menu_items",
  company: "companies",
  companies: "companies",
  customer: "customers",
  customers: "customers",
  order: "orders",
  orders: "orders",
  inventory: "inventory",
  setting: "settings",
  settings: "settings",
  recipe: "recipes",
  recipes: "recipes",
  inventory_transaction: "inventory_transactions",
  inventory_transactions: "inventory_transactions",
  snapshot: "snapshots",
  snapshots: "snapshots"
};

const ALLOWED_COLUMNS: Record<string, Set<string>> = {
  menu_items: new Set(["id", "name", "price", "category", "description", "image", "available", "branch_id", "created_at", "updated_at", "deleted_at"]),
  orders: new Set([
    "id", "orderNumber", "tableId", "items", "status", "paymentStatus", "paymentMethod",
    "totalAmount", "taxRate", "taxAmount", "grandTotal", "createdAt", "updatedAt", "paidAt",
    "customerPhone", "customerId", "customerName", "companyId", "companyName", "billedToType",
    "refundedAt", "refundReason", "deletedAt", "branch_id"
  ]),
  customers: new Set(["id", "name", "phone", "company_id", "tags", "notes", "createdAt", "updated_at", "branch_id", "deleted_at"]),
  companies: new Set(["id", "name", "tags", "phone", "notes", "createdAt", "updated_at", "branch_id", "deleted_at"]),
  inventory: new Set(["id", "name", "unit", "stock", "minStock", "costPerUnit", "branch_id", "created_at", "updated_at", "deleted_at"]),
  settings: new Set(["id", "key", "value", "branch_id", "updated_at"]),
  recipes: new Set(["id", "menu_item_id", "inventory_item_id", "quantity", "unit", "branch_id", "updated_at"]),
  inventory_transactions: new Set(["id", "item_id", "item_name", "type", "quantity", "unit", "reference_id", "notes", "branch_id", "created_at"]),
  snapshots: new Set(["id", "branch_id", "payload", "created_at", "kind"])
};

const MAX_SNAPSHOTS_PER_BRANCH = 10;

/* ─────────────────────────────────────────────────────────────────────────────
 * Money precision guard (mirror of src/utils/money.ts on the client)
 *
 * Defence in depth for issue B.1. The client now rounds every money value
 * before it is stored, but this Worker is the shared write boundary for ALL
 * branches — including any till still running an older bundle. Rounding here
 * means a drifted float like 112.49999999999999 can never land in D1 (on write)
 * and never leaves D1 unrounded (on read), whatever the client did.
 *
 * Arithmetic happens in minor units (piasters) where it is exact.
 * ──────────────────────────────────────────────────────────────────────────── */

const MONEY_MINOR_UNITS = 100;
const MONEY_DUST_SCALE = 1e6;

/** Round a money value to the piaster. Returns null for null/blank/non-finite. */
function roundMoneyOrNull(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 0;
  const scaled = n * MONEY_MINOR_UNITS;
  const dedusted = Math.round(scaled * MONEY_DUST_SCALE) / MONEY_DUST_SCALE;
  const minor = dedusted < 0 ? -Math.round(-dedusted) : Math.round(dedusted);
  return minor / MONEY_MINOR_UNITS;
}

/** Round a money value to the piaster, treating missing/invalid input as 0. */
function roundMoneyOrZero(value: any): number {
  return roundMoneyOrNull(value) ?? 0;
}

/**
 * Round the money columns of a row in place.
 * `nullableFields` keep null (a missing tax snapshot must stay missing —
 * coercing it to 0 is what used to break revenue after a restore).
 */
function roundMoneyFields(row: any, fields: string[], nullableFields: string[] = []) {
  for (const f of fields) {
    if (f in row) row[f] = roundMoneyOrZero(row[f]);
  }
  for (const f of nullableFields) {
    if (f in row) row[f] = roundMoneyOrNull(row[f]);
  }
  return row;
}



export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = getCorsHeaders(request, env);

    // 1. Handle CORS Preflight request
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // 2. Session lifecycle routes (mint / clear / probe). Handled BEFORE the
    //    auth gate: minting a session is exactly what an unauthenticated client
    //    does first. Minting REQUIRES a credential (the operator's POS password,
    //    or a role-scoped API key) and bakes the resolved role into an HMAC-
    //    signed HttpOnly cookie — there is no anonymous session anymore, and the
    //    Worker fails closed (503) when SESSION_SECRET is unset. See auth.ts.
    const sessionResponse = await handleSessionRoutes(request, env, corsHeaders);
    if (sessionResponse) return sessionResponse;

    // 2b. PUBLIC, UNAUTHENTICATED read path for the customer-facing QR menu.
    //
    // /public-menu is served OUTSIDE ProtectedRoute, so a guest who scans the QR
    // code has no API key in localStorage. Routing their request through the
    // authenticated /v1/.../collections path returned 401 and the guest saw an
    // empty menu. This endpoint returns ONLY live, available menu items — no other
    // collections, no customer data, no tombstoned/unavailable rows — so a guest
    // can read the menu without a key. Deliberately handled before the token check.
    if (request.method === "GET") {
      const publicPath = new URL(request.url).pathname.replace(/\/+$/, "");
      if (publicPath === "/public/menu" || publicPath === "/public/menu_items") {
        try {
          const { results } = await env.DB
            .prepare(
              "SELECT * FROM menu_items WHERE (deleted_at IS NULL OR deleted_at = '') AND available = 1"
            )
            .all();
          const documents = (results || []).map((row) => denormalizeData("menu_items", row));
          return new Response(JSON.stringify({ documents }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              // Brief edge cache so a burst of QR scans doesn't hammer D1.
              "Cache-Control": "public, max-age=30",
              ...corsHeaders
            }
          });
        } catch (err: any) {
          console.error("[worker] public menu read failed:", err?.message || err);
          return new Response(
            JSON.stringify({ error: "Internal Error", message: "Failed to load public menu" }),
            { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
      }
    }

    // 3. Auth gate — a valid role-bearing session cookie is required (fail-
    //    closed). Missing/expired/tampered ⇒ 401. A legacy shared API_KEY is
    //    still accepted here (⇒ manager) only while that secret is set on the
    //    Worker, so un-migrated tills keep syncing during rollout. See auth.ts.
    const auth = await authenticate(request, env);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized", message: "Missing or invalid session" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    try {
      const url = new URL(request.url);
      const pathParts = url.pathname.split("/").filter(Boolean);

      // Single-branch system: X-Branch-ID is accepted from legacy clients but
      // intentionally ignored — reads are not scoped and writes always use
      // MAIN_BRANCH_ID.

      // 3. Handle /api/sync endpoint for SyncService background sync
      if (pathParts[0] === "api" && pathParts[1] === "sync" && request.method === "POST") {
        try {
          const body: any = await request.json();
          const { type, action, data } = body || {};

          if (!type || !data) {
            return new Response(JSON.stringify({ error: "Bad Request", message: "Missing type or data" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }

          const table = ALLOWED_TABLE_MAP[type];
          if (!table) {
            return new Response(JSON.stringify({ error: "Bad Request", message: `Invalid resource type: ${type}` }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }

          const docId = data.id || data.documentId;
          if (!docId) {
            return new Response(JSON.stringify({ error: "Bad Request", message: "Missing record id" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }

          if (action === "delete") {
            await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(docId).run();
          } else {
            const normalized = sanitizeAndNormalize(table, data);
            normalized.id = docId;
            // Single-branch system: always stamp the one branch id.
            normalized.branch_id = MAIN_BRANCH_ID;

            const keys = Object.keys(normalized);
            if (keys.length === 0) {
              return new Response(JSON.stringify({ error: "Bad Request", message: "No valid columns provided" }), {
                status: 400,
                headers: { "Content-Type": "application/json", ...corsHeaders }
              });
            }

            const columns = keys.join(", ");
            const placeholders = keys.map((_, i) => `?${i + 1}`).join(", ");
            const updates = keys.filter(k => k !== "id" && k !== "createdAt" && k !== "created_at")
                                .map(k => `${k} = excluded.${k}`)
                                .join(", ");

            const sql = `
              INSERT INTO ${table} (${columns})
              VALUES (${placeholders})
              ON CONFLICT(id) DO UPDATE SET
                ${updates}
            `;

            const values = keys.map(k => normalized[k]);
            await env.DB.prepare(sql).bind(...values).run();

            if (table === "snapshots") {
              await pruneSnapshots(env.DB, MAIN_BRANCH_ID);
            }
          }

          return new Response(JSON.stringify({ success: true, message: "Synced successfully to D1" }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (syncErr: any) {
          console.error('[Worker /api/sync Error]:', syncErr);
          return new Response(JSON.stringify({ error: "Sync Error", message: syncErr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 4. Handle /v1 REST routes
      if (pathParts[0] !== "v1") {
        return new Response(JSON.stringify({ error: "Not Found", message: "Route not supported" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const dbIndex = pathParts.indexOf("databases");
      const collectionIndex = pathParts.indexOf("collections");

      if (dbIndex === -1 || collectionIndex === -1 || collectionIndex <= dbIndex) {
        return new Response(JSON.stringify({ error: "Bad Request", message: "Invalid API routing" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const collectionId = pathParts[collectionIndex + 1];
      const docId = pathParts[collectionIndex + 3];

      const table = ALLOWED_TABLE_MAP[collectionId];
      if (!table) {
        return new Response(JSON.stringify({ error: "Bad Request", message: `Invalid collection: ${collectionId}` }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const method = request.method;

      if (method === "GET") {
        // Single-branch system: no branch filtering, every row belongs here.
        if (docId) {
          const sql = `SELECT * FROM ${table} WHERE id = ?`;
          const params: any[] = [docId];
          const row = await env.DB.prepare(sql).bind(...params).first();

          if (!row) {
            return new Response(JSON.stringify({ message: "Document not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }

          return new Response(JSON.stringify(denormalizeData(table, row)), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } else {
          // OPT-IN pagination. Deliberately no default limit: silently
          // returning the first N rows would under-report revenue in the
          // manager dashboard, which is far worse than a slow query. Clients
          // that want to page must ask for it explicitly via ?limit=.
          let sql = `SELECT * FROM ${table}`;
          const params: any[] = [];

          const sinceParam = url.searchParams.get("since");
          if (sinceParam) {
            const updatedCol = UPDATED_AT_COLUMN[table];
            if (updatedCol) {
              sql += ` WHERE ${updatedCol} > ?`;
              params.push(sinceParam);
            }
          }

          const limitParam = url.searchParams.get("limit");
          if (limitParam) {
            const limit = Number(limitParam);
            if (Number.isFinite(limit) && limit > 0) {
              sql += ` LIMIT ${Math.min(Math.floor(limit), 5000)}`;
              const offsetParam = Number(url.searchParams.get("offset"));
              if (Number.isFinite(offsetParam) && offsetParam > 0) {
                sql += ` OFFSET ${Math.floor(offsetParam)}`;
              }
            }
          }

          const stmt = params.length > 0 ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
          const { results } = await stmt.all();
          const documents = (results || []).map(row => denormalizeData(table, row));

          return new Response(JSON.stringify({ documents }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      if (method === "POST") {
        const body: any = await request.json();
        const documentId = body.documentId;
        const rawData = body.data || {};

        const data = sanitizeAndNormalize(table, rawData);
        data.id = documentId;
        // Single-branch system: always stamp the one branch id.
        data.branch_id = MAIN_BRANCH_ID;

        const keys = Object.keys(data);
        if (keys.length === 0) {
          return new Response(JSON.stringify({ error: "Bad Request", message: "No valid attributes provided" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const columns = keys.join(", ");
        const placeholders = keys.map((_, i) => `?${i + 1}`).join(", ");
        const updates = keys.filter(k => k !== "id" && k !== "createdAt" && k !== "created_at")
                            .map(k => `${k} = excluded.${k}`)
                            .join(", ");

        const sql = `
          INSERT INTO ${table} (${columns})
          VALUES (${placeholders})
          ON CONFLICT(id) DO UPDATE SET
            ${updates}
        `;

        const values = keys.map(k => data[k]);
        await env.DB.prepare(sql).bind(...values).run();

        if (table === "snapshots") {
          await pruneSnapshots(env.DB, MAIN_BRANCH_ID);
        }

        const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(documentId).first();
        return new Response(JSON.stringify(denormalizeData(table, row)), {
          status: 201,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      if (method === "PATCH") {
        if (!docId) {
          return new Response(JSON.stringify({ error: "Bad Request", message: "Document ID missing" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const body: any = await request.json();
        const rawData = body.data || {};
        const data = sanitizeAndNormalize(table, rawData);

        const keys = Object.keys(data);
        if (keys.length === 0) {
          const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(docId).first();
          return new Response(JSON.stringify(denormalizeData(table, row)), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const sets = keys.map((k, i) => `${k} = ?${i + 2}`).join(", ");
        const sql = `UPDATE ${table} SET ${sets} WHERE id = ?1`;
        const values = keys.map(k => data[k]);

        await env.DB.prepare(sql).bind(docId, ...values).run();

        const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(docId).first();
        if (!row) {
          return new Response(JSON.stringify({ message: "Document not found after patch" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        return new Response(JSON.stringify(denormalizeData(table, row)), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      if (method === "DELETE") {
        if (!docId) {
          return new Response(JSON.stringify({ error: "Bad Request", message: "Document ID missing" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(docId).run();
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });

    } catch (err: any) {
      // Log internally; never return raw D1/SQLite messages to the client —
      // they disclose table names, column names and constraints.
      console.error("[worker]", err);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};

/**
 * Single-branch POS.
 *
 * This deployment serves exactly one branch, so there is no branch filtering
 * to apply: every row in the database belongs to that branch. The X-Branch-ID
 * header is still accepted for backwards compatibility with older clients, but
 * it no longer narrows reads — a client that sends a stale id ('default',
 * 'branch_1', 'manager', ...) sees the same single dataset as everyone else.
 *
 * MAIN_BRANCH_ID is what every write is stamped with, so the column converges
 * on one value over time without needing a destructive schema migration.
 */
const MAIN_BRANCH_ID = "main_branch";

function getCorsHeaders(request: Request, env: Env) {
  // Fail-closed: if ALLOWED_ORIGINS is unset, return NO permissive CORS headers.
  // Browsers will block cross-origin requests, which is safer than reflecting "*".
  const allowedRaw = env.ALLOWED_ORIGINS;
  if (!allowedRaw || !allowedRaw.trim()) {
    return {
      "Access-Control-Allow-Origin": "",
      // The session cookie rides on credentials:'include', so the browser only
      // stores the Set-Cookie and replays it when this is present AND the origin
      // is a specific (non-"*") allowlisted value.
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-ID, X-Device-ID, X-API-Key",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
  }

  const allowedList = allowedRaw.split(",").map(s => s.trim()).filter(Boolean);
  const reqOrigin = request.headers.get("Origin");
  // Strict match: only reflect the request Origin if it is explicitly allowlisted.
  const origin = reqOrigin && allowedList.includes(reqOrigin) ? reqOrigin : "";

  return {
    "Access-Control-Allow-Origin": origin,
    // See note above: mandatory for the cookie to be stored + replayed.
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-ID, X-Device-ID, X-API-Key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function sanitizeAndNormalize(table: string, data: any) {
  const normalized = normalizeData(table, data);
  const allowed = ALLOWED_COLUMNS[table];
  if (!allowed) return normalized;

  const sanitized: any = {};
  for (const key of Object.keys(normalized)) {
    if (allowed.has(key)) {
      sanitized[key] = normalized[key];
    }
  }
  return sanitized;
}

function normalizeData(table: string, data: any) {
  const normalized: any = { ...data };
  
  if (table === 'orders') {
    // Money precision guard — never persist a drifted float (see roundMoneyFields).
    roundMoneyFields(normalized, ['totalAmount', 'total_amount'], ['taxAmount', 'tax_amount', 'grandTotal', 'grand_total']);
    if ('total_amount' in normalized) normalized.totalAmount = normalized.total_amount;
    if ('payment_method' in normalized) normalized.paymentMethod = normalized.payment_method;
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    if ('customer_id' in normalized) normalized.customerId = normalized.customer_id;
    if ('customer_name' in normalized) normalized.customerName = normalized.customer_name;
    if ('company_id' in normalized) normalized.companyId = normalized.company_id;
    if ('company_name' in normalized) normalized.companyName = normalized.company_name;
    if ('billed_to_type' in normalized) normalized.billedToType = normalized.billed_to_type;
    if ('refunded_at' in normalized) normalized.refundedAt = normalized.refunded_at;
    if ('refund_reason' in normalized) normalized.refundReason = normalized.refund_reason;
    if ('updated_at' in normalized) normalized.updatedAt = normalized.updated_at;
    if ('items' in normalized && typeof normalized.items !== 'string') {
      normalized.items = JSON.stringify(normalized.items);
    }

    delete normalized.total_amount;
    delete normalized.payment_method;
    delete normalized.branchId;
    delete normalized.customer_id;
    delete normalized.customer_name;
    delete normalized.company_id;
    delete normalized.company_name;
    delete normalized.billed_to_type;
    delete normalized.refunded_at;
    delete normalized.refund_reason;
    delete normalized.updated_at;
    delete normalized.isSynced;
  }
  
  if (table === 'menu_items') {
    // Money precision guard — item prices feed every line total.
    roundMoneyFields(normalized, ['price']);
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    delete normalized.branchId;
    if ('available' in normalized) {
      normalized.available = normalized.available ? 1 : 0;
    }
    // Soft-delete tombstone: store as deleted_at so every device learns the item
    // was removed and stops resurrecting it on hydrate/sync.
    if ('deletedAt' in normalized) {
      normalized.deleted_at = normalized.deletedAt || null;
      delete normalized.deletedAt;
    }
    if ('createdAt' in normalized) {
      normalized.created_at = normalized.createdAt;
      delete normalized.createdAt;
    }
    if ('updatedAt' in normalized) {
      normalized.updated_at = normalized.updatedAt;
      delete normalized.updatedAt;
    }
  }
  
  if (table === 'customers') {
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    if ('companyId' in normalized) normalized.company_id = normalized.companyId;
    if ('tags' in normalized && typeof normalized.tags !== 'string') {
      normalized.tags = JSON.stringify(normalized.tags || []);
    }
    if ('updatedAt' in normalized) {
      normalized.updated_at = normalized.updatedAt;
      delete normalized.updatedAt;
    }
    // Soft-delete tombstone (matches menu_items/inventory).
    if ('deletedAt' in normalized) {
      normalized.deleted_at = normalized.deletedAt || null;
      delete normalized.deletedAt;
    }
    delete normalized.branchId;
    delete normalized.companyId;
    delete normalized.isSynced;
  }

  if (table === 'companies') {
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    if ('tags' in normalized && typeof normalized.tags !== 'string') {
      normalized.tags = JSON.stringify(normalized.tags || []);
    }
    if ('updatedAt' in normalized) {
      normalized.updated_at = normalized.updatedAt;
      delete normalized.updatedAt;
    }
    // Soft-delete tombstone (matches menu_items/inventory).
    if ('deletedAt' in normalized) {
      normalized.deleted_at = normalized.deletedAt || null;
      delete normalized.deletedAt;
    }
    delete normalized.branchId;
    delete normalized.isSynced;
  }

  if (table === 'inventory') {
    // Money precision guard — costPerUnit feeds COGS and valuation.
    roundMoneyFields(normalized, ['costPerUnit']);
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    if ('createdAt' in normalized) {
      normalized.created_at = normalized.createdAt;
      delete normalized.createdAt;
    }
    if ('updatedAt' in normalized) {
      normalized.updated_at = normalized.updatedAt;
      delete normalized.updatedAt;
    }
    // Soft-delete tombstone (matches menu_items). Without this the column
    // stayed NULL and deleted items got resurrected by any later device UPDATE.
    if ('deletedAt' in normalized) {
      normalized.deleted_at = normalized.deletedAt || null;
      delete normalized.deletedAt;
    }
    delete normalized.branchId;
    delete normalized.isSynced;
  }

  if (table === 'settings') {
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    if ('updatedAt' in normalized) {
      normalized.updated_at = normalized.updatedAt;
      delete normalized.updatedAt;
    }
    if (!normalized.updated_at) normalized.updated_at = new Date().toISOString();
    if (typeof normalized.value !== 'string') {
      normalized.value = JSON.stringify(normalized.value ?? '');
    }
    delete normalized.branchId;
  }

  if (table === 'recipes') {
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    if ('menuItemId' in normalized) normalized.menu_item_id = normalized.menuItemId;
    if ('inventoryItemId' in normalized) normalized.inventory_item_id = normalized.inventoryItemId;
    if ('updatedAt' in normalized) {
      normalized.updated_at = normalized.updatedAt;
      delete normalized.updatedAt;
    }
    if (!normalized.updated_at) normalized.updated_at = new Date().toISOString();
    delete normalized.branchId;
    delete normalized.menuItemId;
    delete normalized.inventoryItemId;
  }

  if (table === 'inventory_transactions') {
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    if ('itemId' in normalized) normalized.item_id = normalized.itemId;
    if ('itemName' in normalized) normalized.item_name = normalized.itemName;
    if ('referenceId' in normalized) normalized.reference_id = normalized.referenceId;
    if ('createdAt' in normalized) {
      normalized.created_at = normalized.createdAt;
      delete normalized.createdAt;
    }
    if (!normalized.created_at) normalized.created_at = new Date().toISOString();
    delete normalized.branchId;
    delete normalized.itemId;
    delete normalized.itemName;
    delete normalized.referenceId;
    delete normalized.isSynced;
  }

  if (table === 'snapshots') {
    if ('branchId' in normalized) normalized.branch_id = normalized.branchId;
    normalized.branch_id = MAIN_BRANCH_ID;
    if ('createdAt' in normalized) {
      normalized.created_at = normalized.createdAt;
      delete normalized.createdAt;
    }
    if (!normalized.created_at) normalized.created_at = new Date().toISOString();
    if (typeof normalized.payload !== 'string') {
      normalized.payload = JSON.stringify(normalized.payload ?? {});
    }
    if (!normalized.kind) normalized.kind = 'auto';
    delete normalized.branchId;
  }

  return normalized;
}

function denormalizeData(table: string, row: any) {
  const doc: any = { ...row };
  doc.$id = row.id;
  
  const created = row.createdAt || row.created_at || new Date().toISOString();
  const updated = row.updatedAt || row.updated_at || created;
  doc.$createdAt = created;
  doc.$updatedAt = updated;

  if (table === 'orders') {
    // Money precision guard — legacy rows written before the money.ts fix may
    // still hold drifted floats, so round on read too.
    doc.totalAmount = roundMoneyOrZero(row.totalAmount ?? row.total_amount);
    doc.total_amount = doc.totalAmount;
    doc.paymentMethod = row.paymentMethod || row.payment_method || 'Cash';
    doc.payment_method = doc.paymentMethod;
    // Unpaid is the safe default and matches the schema (DEFAULT 'Unpaid').
    // Defaulting to 'Paid' counted any row with a missing/empty payment status
    // as collected revenue, inflating sales reports.
    doc.paymentStatus = row.paymentStatus || 'Unpaid';
    // Keep nullish tax fields as null — never Number(null) => 0 (breaks revenue after restore)
    const n = (v: any) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    doc.taxRate = n(row.taxRate ?? row.tax_rate); // a rate, not money — not rounded
    doc.taxAmount = roundMoneyOrNull(row.taxAmount ?? row.tax_amount);
    doc.grandTotal = roundMoneyOrNull(row.grandTotal ?? row.grand_total);
    doc.branch_id = MAIN_BRANCH_ID;
    doc.branchId = MAIN_BRANCH_ID;
    doc.customerPhone = row.customerPhone || row.customer_phone || undefined;
    doc.customerId = row.customerId || row.customer_id || undefined;
    doc.customerName = row.customerName || row.customer_name || undefined;
    doc.companyId = row.companyId || row.company_id || undefined;
    doc.companyName = row.companyName || row.company_name || undefined;
    doc.billedToType = row.billedToType || row.billed_to_type || undefined;
    doc.refundedAt = row.refundedAt || row.refunded_at || undefined;
    doc.refundReason = row.refundReason || row.refund_reason || undefined;
    doc.updatedAt = row.updatedAt || row.updated_at || undefined;
    if (typeof row.items === 'string') {
      try { doc.items = JSON.parse(row.items); } catch { doc.items = []; }
    }
  }

  
  if (table === 'menu_items') {
    // Money precision guard — round legacy drifted prices on read.
    doc.price = roundMoneyOrZero(row.price);
    doc.available = Boolean(row.available);
    doc.branchId = MAIN_BRANCH_ID;
    doc.branch_id = MAIN_BRANCH_ID;
    // Echo the soft-delete tombstone back to clients.
    doc.deleted_at = row.deleted_at || null;
    doc.deletedAt = doc.deleted_at;
    doc.created_at = row.created_at || row.createdAt || created;
    doc.createdAt = doc.created_at;
    doc.updated_at = row.updated_at || row.updatedAt || updated;
    doc.updatedAt = doc.updated_at;
  }
  
  if (table === 'customers') {
    doc.branchId = MAIN_BRANCH_ID;
    doc.branch_id = MAIN_BRANCH_ID;
    // Loyalty points feature removed: never surface a points balance to clients,
    // even if a legacy D1 row still carries the dormant column.
    delete doc.points;
    doc.companyId = row.company_id;
    doc.company_id = row.company_id;
    if (typeof row.tags === 'string') {
      try { doc.tags = JSON.parse(row.tags); } catch { doc.tags = []; }
    } else {
      doc.tags = row.tags || [];
    }
    doc.notes = row.notes;
    doc.updatedAt = row.updated_at || row.updatedAt;
    // Echo the soft-delete tombstone back to clients.
    doc.deleted_at = row.deleted_at || null;
    doc.deletedAt = doc.deleted_at;
  }

  if (table === 'companies') {
    doc.branchId = MAIN_BRANCH_ID;
    doc.branch_id = MAIN_BRANCH_ID;
    if (typeof row.tags === 'string') {
      try { doc.tags = JSON.parse(row.tags); } catch { doc.tags = []; }
    } else {
      doc.tags = row.tags || [];
    }
    doc.notes = row.notes;
    doc.phone = row.phone;
    doc.updatedAt = row.updated_at || row.updatedAt;
    // Echo the soft-delete tombstone back to clients.
    doc.deleted_at = row.deleted_at || null;
    doc.deletedAt = doc.deleted_at;
  }
  
  if (table === 'inventory') {
    doc.branchId = MAIN_BRANCH_ID;
    doc.branch_id = MAIN_BRANCH_ID;
    doc.stock = Number(row.stock) || 0;
    doc.minStock = Number(row.minStock) || 0;
    doc.costPerUnit = roundMoneyOrZero(row.costPerUnit); // money — rounded; stock/minStock are quantities
    doc.createdAt = row.created_at || row.createdAt || created;
    doc.updatedAt = row.updated_at || row.updatedAt || updated;
    // Echo the soft-delete tombstone back to clients (matches menu_items).
    doc.deleted_at = row.deleted_at || null;
    doc.deletedAt = doc.deleted_at;
  }

  if (table === 'settings') {
    doc.branchId = MAIN_BRANCH_ID;
    doc.branch_id = MAIN_BRANCH_ID;
    doc.key = row.key;
    doc.value = row.value;
    doc.updatedAt = row.updated_at || row.updatedAt || updated;
  }

  if (table === 'recipes') {
    doc.branchId = MAIN_BRANCH_ID;
    doc.branch_id = MAIN_BRANCH_ID;
    doc.menuItemId = row.menu_item_id || row.menuItemId;
    doc.menu_item_id = doc.menuItemId;
    doc.inventoryItemId = row.inventory_item_id || row.inventoryItemId;
    doc.inventory_item_id = doc.inventoryItemId;
    doc.quantity = Number(row.quantity) || 0;
    doc.unit = row.unit;
    doc.updatedAt = row.updated_at || row.updatedAt || updated;
  }

  if (table === 'inventory_transactions') {
    doc.branchId = MAIN_BRANCH_ID;
    doc.branch_id = MAIN_BRANCH_ID;
    doc.itemId = row.item_id || row.itemId;
    doc.item_id = doc.itemId;
    doc.itemName = row.item_name || row.itemName;
    doc.item_name = doc.itemName;
    doc.referenceId = row.reference_id || row.referenceId;
    doc.reference_id = doc.referenceId;
    doc.type = row.type;
    doc.quantity = Number(row.quantity) || 0;
    doc.unit = row.unit;
    doc.notes = row.notes;
    doc.createdAt = row.created_at || row.createdAt || created;
  }

  if (table === 'snapshots') {
    doc.branchId = MAIN_BRANCH_ID;
    doc.branch_id = MAIN_BRANCH_ID;
    doc.kind = row.kind || 'auto';
    doc.createdAt = row.created_at || row.createdAt || created;
    if (typeof row.payload === 'string') {
      try { doc.payload = JSON.parse(row.payload); } catch { doc.payload = row.payload; }
    } else {
      doc.payload = row.payload;
    }
  }
  
  return doc;
}

async function pruneSnapshots(db: D1Database, branchId: string) {
  try {
    const { results } = await db
      .prepare(
        `SELECT id FROM snapshots WHERE branch_id = ? ORDER BY created_at DESC`
      )
      .bind(branchId)
      .all();
    const rows = results || [];
    if (rows.length <= MAX_SNAPSHOTS_PER_BRANCH) return;
    const toDelete = rows.slice(MAX_SNAPSHOTS_PER_BRANCH);
    // Single statement instead of one round-trip per row (N+1).
    const ids = toDelete.map((row: any) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    await db
      .prepare(`DELETE FROM snapshots WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run();
  } catch (e) {
    console.warn('[pruneSnapshots]', e);
  }
}
