import { authenticate, handleSessionRoutes, verifyCsrf, timingSafeEqual } from "./auth.ts";
import { can, canReadSettingKey, canReadTable, settingKeyFrom } from "./permissions.ts";
import type { HttpMethod } from "./permissions.ts";

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
  /** Server-side refund PIN. Lets a cashier escalate a refund via X-Refund-PIN. */
  REFUND_PIN?: string;
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
    "refundedAt", "refundReason", "cashierName", "deletedAt", "branch_id"
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Refund is TERMINAL — one-way latch at the D1 write boundary.
 *
 * The client merge (src/utils/orderNumber.ts → mergeOrderRecords) already treats
 * Refunded as terminal, but that only protects the LOCAL merge. The Worker is the
 * shared write boundary for every device, and none of its three write paths had
 * an equivalent guard:
 *
 *   1. /api/sync + REST upserts rely on a freshness clause
 *      (`WHERE excluded.updatedAt > orders.updatedAt`). An incoming row whose
 *      updatedAt is NULL/missing — e.g. a stale copy uploaded by a device that
 *      hydrated before the refund landed, or whose payload dropped the key
 *      through JSON.stringify — makes the comparison NULL (not false), so the
 *      stale Unpaid copy OVERWRITES the Refunded row. From then on every device
 *      (including the manager's, after he clears his browser cache and
 *      re-hydrates) sees the order as "not paid" again.
 *   2. The REST PATCH path has no freshness guard at all — any stale tab
 *      PATCHing an old copy regressed the row unconditionally.
 *
 * `applyRefundLatch` rewrites an incoming orders payload against the row stored
 * in D1 BEFORE it reaches SQL: when the stored row is refunded (paymentStatus
 * 'Refunded' or a refundedAt marker), any write that does not itself carry a
 * refund marker is forced to keep the Refunded state (status, refundedAt,
 * refundReason). Legit new data in the same write (customer name, notes…) still
 * lands. There is no un-refund flow in this POS, so refund always outranks.
 * ──────────────────────────────────────────────────────────────────────────── */

/** True when a stored row / payload carries a resolved refund. */
function hasRefundMarker(row: any): boolean {
  if (!row) return false;
  const status = row.paymentStatus ?? row.payment_status;
  const refundedAt = row.refundedAt ?? row.refunded_at;
  return status === "Refunded" || (refundedAt !== null && refundedAt !== undefined && refundedAt !== "");
}

/**
 * Rewrite `incoming` so it can never resurrect a refunded order. No-op for any
 * other case (including when the incoming write IS the refund itself).
 * Column names here are the D1/canonical camelCase ones (post-normalizeData).
 */
export function applyRefundLatch(incoming: any, current: any): any {
  if (!current || !incoming) return incoming;
  if (!hasRefundMarker(current)) return incoming; // nothing to protect
  if (hasRefundMarker(incoming)) return incoming; // refund re-send / richer refund data

  const latched = { ...incoming };
  latched.paymentStatus = "Refunded";
  // Keep the ORIGINAL refund timestamp/reason — the story of WHEN and WHY the
  // order was refunded must never be rewritten by a stale writer.
  latched.refundedAt = current.refundedAt ?? current.refunded_at;
  latched.refundReason = current.refundReason ?? current.refund_reason;
  // A refunded order is voided on the client too (status 'Cancelled'); never
  // let a stale writer resurrect it onto the kitchen board as New/Completed.
  if (current.status === "Cancelled") latched.status = "Cancelled";
  return latched;
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

    // 1a. LIVENESS PROBE — GET /api/health (public, no auth).
    //
    // Handled BEFORE the auth gate so the client can tell three states apart:
    //   * worker unreachable          -> fetch() rejects / times out client-side
    //   * worker up but misconfigured -> { ok: false, db: "unconfigured" }
    //   * worker up, D1 broken        -> { ok: false, db: "error" }
    // Behind the auth gate a bad/missing session would be indistinguishable from
    // a dead database and the "backups are working" badge could not be honest.
    // Exposes no data: a liveness flag, a row count, and a timestamp.
    if (request.method === "GET") {
      const healthPath = new URL(request.url).pathname.replace(/\/+$/, "");
      if (healthPath === "/api/health") {
        const base = {
          "Content-Type": "application/json",
          // Never cache: a cached 200 would keep the badge green after an outage.
          "Cache-Control": "no-store, no-cache, must-revalidate",
          ...corsHeaders
        };

        if (!env.DB) {
          return new Response(
            JSON.stringify({ ok: false, db: "unconfigured", checkedAt: new Date().toISOString() }),
            { status: 503, headers: base }
          );
        }

        try {
          // A real round-trip to D1. `SELECT 1` proves the binding answers — that
          // is the whole liveness signal. Business telemetry (row counts, last-
          // write timestamps) was previously returned here and leaked operational
          // detail to anyone who could reach the endpoint; it is now gathered
          // nowhere and returned nowhere.
          await env.DB.prepare("SELECT 1").first();

          return new Response(
            JSON.stringify({
              ok: true,
              db: "ok",
              checkedAt: new Date().toISOString()
            }),
            { status: 200, headers: base }
          );
        } catch (err: any) {
          console.error("[worker] health check failed:", err?.message || err);
          return new Response(
            JSON.stringify({
              ok: false,
              db: "error",
              message: String(err?.message || err).slice(0, 200),
              checkedAt: new Date().toISOString()
            }),
            { status: 503, headers: base }
          );
        }
      }
    }

    // 1b. CSRF defense (1 of 2): reject any state-changing request that carries a
    //     browser Origin which is not allowlisted. The cookie is SameSite=None, so
    //     it rides cross-site requests; CORS only stops the attacker from READING
    //     the response — the write still executes without this check. A missing
    //     Origin (server-to-server / curl) is allowed through and is covered by the
    //     credential requirement and the double-submit token below.
    if (request.method !== "GET") {
      const originHeader = request.headers.get("Origin");
      if (originHeader && !isOriginAllowed(originHeader, env)) {
        return new Response(
          JSON.stringify({ error: "Forbidden", message: "Origin not allowed", code: "csrf_origin" }),
          { status: 403, headers: { "Content-Type": "application/json", "X-CSRF-Failed": "1", ...corsHeaders } }
        );
      }
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
              "SELECT id, name, price, category, description, image FROM menu_items WHERE (deleted_at IS NULL OR deleted_at = '') AND available = 1"
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
    // The role comes from the signed cookie (or a role-scoped key) — never from
    // the request body. This is what makes permissions.ts real instead of dead:
    // a cashier and a manager are now different on the server, not just in React.
    const role = auth.role;

    // CSRF defense (2 of 2): a cookie-authenticated write must carry a valid
    // double-submit token (X-CSRF-Token matching the session's sid). Header-key
    // callers (no cookie) are exempt — a browser cannot be made to attach a
    // secret header cross-origin. Reads (GET) are exempt.
    if (request.method !== "GET" && auth.viaCookie) {
      if (!(await verifyCsrf(request, env))) {
        return new Response(
          JSON.stringify({ error: "Forbidden", message: "Missing or invalid CSRF token", code: "csrf_token" }),
          { status: 403, headers: { "Content-Type": "application/json", "X-CSRF-Failed": "1", ...corsHeaders } }
        );
      }
    }

    /** Did the caller prove refund authority with a valid server-side PIN?
     *  Fail-closed: with no REFUND_PIN configured, escalation is impossible and
     *  refunds stay manager-only. */
    const refundEscalated = (() => {
      const pin = (request.headers.get("X-Refund-PIN") || "").trim();
      const expected = (env.REFUND_PIN || "").trim();
      if (!pin || !expected) return false;
      return timingSafeEqual(pin, expected);
    })();

    /**
     * THE enforcement point. A manager is unrestricted; every cashier write is
     * narrowed by permissions.ts. Loads the current row when a guard needs to
     * compare submitted vs stored values, and returns a ready 403 Response when
     * denied, or null when allowed.
     */
    const authorize = async (args: {
      table: string;
      method: HttpMethod;
      docId?: string | null;
      submitted?: Record<string, any> | null;
    }): Promise<Response | null> => {
      let current: Record<string, any> | null = null;
      if (role !== "manager" && args.docId && args.method !== "DELETE") {
        try {
          current = (await env.DB
            .prepare(`SELECT * FROM ${args.table} WHERE id = ?`)
            .bind(args.docId)
            .first()) as Record<string, any> | null;
        } catch {
          current = null;
        }
      }

      const decision = can({
        role,
        table: args.table,
        method: args.method,
        docId: args.docId ?? null,
        submitted: args.submitted ?? null,
        current,
        refundEscalated,
      });

      if (decision.allowed) return null;

      console.warn(
        `[worker] 403 role=${role} table=${args.table} method=${args.method} code=${decision.code}`
      );
      return new Response(
        JSON.stringify({ error: "Forbidden", message: decision.reason, code: decision.code }),
        { status: 403, headers: { "Content-Type": "application/json", "X-Auth-Role": role, ...corsHeaders } }
      );
    };

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

          // AUTHORIZE — this path was previously unguarded. `/api/sync` accepted
          // `action: "delete"` on any table with no role check at all, a complete
          // bypass of the REST DELETE rules. Enforce the same rules here.
          if (action === "delete") {
            const denied = await authorize({ table, method: "DELETE", docId });
            if (denied) return denied;
          } else {
            const preview = sanitizeAndNormalize(table, data);
            preview.id = docId;
            const denied = await authorize({ table, method: "PATCH", docId, submitted: preview });
            if (denied) return denied;
          }

          if (action === "delete") {
            await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(docId).run();
          } else {
            let normalized = sanitizeAndNormalize(table, data);
            normalized.id = docId;
            // Single-branch system: always stamp the one branch id.
            normalized.branch_id = MAIN_BRANCH_ID;
            // settings.key is NOT NULL and was stripped as untrusted input —
            // re-derive it from the document id (see stampSettingKey).
            stampSettingKey(table, normalized, docId);

            if (table === "orders") {
              // Refund is terminal: never let a stale device copy (Uploaded with
              // an old paymentStatus / without refund markers) overwrite the
              // refunded row in D1. The freshness guard alone cannot stop this —
              // a NULL incoming updatedAt skips it entirely (NULL comparison).
              const currentRow = await env.DB
                .prepare(`SELECT paymentStatus, refundedAt, refundReason, status FROM orders WHERE id = ?`)
                .bind(docId)
                .first();
              normalized = applyRefundLatch(normalized, currentRow);
            }

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

            // Last-writer-wins freshness guard. Two devices can race an upsert on
            // the same row (inventory stock moves are the classic case); without a
            // freshness check the LATER arrival silently overwrites a NEWER row.
            // For tables with an updated-at column, only apply the conflict update
            // when the incoming row is strictly newer than the stored one. The
            // INSERT path (genuinely new id) is unaffected.
            const updatedAtCol = UPDATED_AT_COLUMN[table];
            const freshness = updatedAtCol
              ? ` WHERE excluded.${updatedAtCol} > ${table}.${updatedAtCol}`
              : "";

            const sql = `
              INSERT INTO ${table} (${columns})
              VALUES (${placeholders})
              ON CONFLICT(id) DO UPDATE SET
                ${updates}${freshness}
            `;

            const values = keys.map(k => normalized[k]);
            const upsertResult: any = await env.DB.prepare(sql).bind(...values).run();

            if (table === "snapshots") {
              await pruneSnapshots(env.DB, MAIN_BRANCH_ID);
            }

            // Freshness-guard loss detection. When the ON CONFLICT WHERE clause
            // rejects the update (incoming updated_at is not strictly newer), D1
            // reports meta.changes === 0. The client thinks it synced but its
            // write was silently discarded — tell it so it can rebase.
            const changes = upsertResult?.meta?.changes;
            if (changes === 0) {
              const current = await env.DB
                .prepare(`SELECT * FROM ${table} WHERE id = ?`)
                .bind(docId)
                .first();
              console.warn(`[worker] stale write discarded on ${table}/${docId} (freshness guard)`);
              return new Response(
                JSON.stringify({ success: true, stale: true, current, message: "Write discarded: a newer row already exists" }),
                { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
              );
            }
          }

          return new Response(JSON.stringify({ success: true, message: "Synced successfully to D1" }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (syncErr: any) {
          // Log the detailed D1 error server-side, but never echo it to the
          // client — raw SQLite messages disclose table names and constraints.
          console.error('[Worker /api/sync Error]:', syncErr);
          return new Response(JSON.stringify({ error: "Sync Error", message: "Sync failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 3b. Cross-device daily-report claim — POST /api/report/claim
      // Only ONE manager device may send the automatic daily Telegram report per
      // business day. localStorage (client-side lock) cannot coordinate across
      // two DIFFERENT manager devices, so the first device to claim the day wins
      // here; every other device gets 409 and skips its send. The claim is a
      // unique settings row keyed by day — the INSERT is atomic, so two devices
      // racing the same day cannot both win.
      if (pathParts[0] === "api" && pathParts[1] === "report" && pathParts[2] === "claim" && request.method === "POST") {
        if (role !== "manager") {
          return new Response(JSON.stringify({ error: "Forbidden", message: "تقرير المبيعات اليومي متاح للمدير فقط.", code: "manager_only" }), {
            status: 403, headers: { "Content-Type": "application/json", "X-Auth-Role": role, ...corsHeaders }
          });
        }
        try {
          const body: any = await request.json().catch(() => ({}));
          const dayKey = String(body?.dayKey || "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
            return new Response(JSON.stringify({ error: "Bad Request", message: "dayKey must be YYYY-MM-DD" }), {
              status: 400, headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
          const id = `report_claim::${dayKey}`;
          const now = new Date().toISOString();
          // Atomic first-writer-wins: the row id is the day lock. A second claim
          // on the same day violates the PRIMARY KEY and we translate it to 409.
          await env.DB.prepare(
            `INSERT INTO settings (id, key, value, branch_id, updated_at) VALUES (?, ?, ?, ?, ?)`
          ).bind(id, "brewmaster_daily_report_claim", now, MAIN_BRANCH_ID, now).run();
          return new Response(JSON.stringify({ claimed: true, dayKey }), {
            status: 200, headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (e: any) {
          const msg = String(e?.message || "");
          if (/UNIQUE|PRIMARY KEY|constraint failed/i.test(msg)) {
            return new Response(JSON.stringify({ claimed: false, reason: "already_claimed" }), {
              status: 409, headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
          console.error('[Worker /api/report/claim Error]:', e);
          return new Response(JSON.stringify({ error: "Claim Error", message: msg }), {
            status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 3c. Cross-device daily order-sequence reservation — POST /api/orders/next-seq
      // Two tills running at the same time used to each compute "max local ticket
      // + 1" and hand out the SAME invoice number for the day. Here the counter is
      // a single D1 row per day; the read-then-increment happens inside one
      // D1 batch (atomic), so two devices racing can never receive the same seq.
      // The device falls back to its local heuristic when the Worker is offline.
      if (pathParts[0] === "api" && pathParts[1] === "orders" && pathParts[2] === "next-seq" && request.method === "POST") {
        if (role !== "manager" && role !== "cashier") {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403, headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        try {
          const body: any = await request.json().catch(() => ({}));
          const dayKey = String(body?.dayKey || "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
            return new Response(JSON.stringify({ error: "Bad Request", message: "dayKey must be YYYY-MM-DD" }), {
              status: 400, headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
          const id = `order_seq::${dayKey}`;
          const now = new Date().toISOString();
          // Truly atomic claim-and-increment: the read, increment and write are
          // ONE SQL statement (INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING),
          // so two devices racing the same day can never receive the same seq —
          // the previous SELECT-then-UPDATE pair left a window where both racers
          // read the same value and returned the same invoice number (Blocker 2).
          const result: any = await env.DB
            .prepare(
              `INSERT INTO settings (id, key, value, branch_id, updated_at) VALUES (?1, ?2, '1', ?3, ?4)
               ON CONFLICT(id) DO UPDATE SET value = CAST(settings.value AS INTEGER) + 1, updated_at = ?4
               RETURNING value`
            )
            .bind(id, "brewmaster_order_seq", MAIN_BRANCH_ID, now)
            .first();
          const next = parseInt(String(result?.value ?? ""), 10);
          if (!Number.isFinite(next) || next <= 0) {
            throw new Error("order-sequence counter returned no value");
          }
          return new Response(JSON.stringify({ seq: next, dayKey }), {
            status: 200, headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (e: any) {
          console.error('[Worker /api/orders/next-seq Error]:', e);
          return new Response(JSON.stringify({ error: "Sequence Error", message: "Failed to reserve order sequence" }), {
            status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }
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

          // Read authorization (cashier). A forbidden read returns the SAME 404 as
          // a missing row, so a cashier can neither read the secret nor even learn
          // that it exists. Managers pass both checks unconditionally.
          const settingKey =
            table === "settings"
              ? String((row as any)?.key ?? docId.split("::").pop() ?? "")
              : null;
          const readable =
            canReadTable(role, table) &&
            (table !== "settings" || canReadSettingKey(role, settingKey));

          if (!row || !readable) {
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
          let documents = (results || []).map(row => denormalizeData(table, row));

          // Read authorization (cashier). Drop rows the caller may not read so a
          // cashier can never hydrate the manager credential hash, the refund PIN
          // hash, or the plaintext Telegram token — neither directly from the
          // `settings` collection nor bundled inside a `snapshots` payload.
          // Managers are unaffected.
          if (!canReadTable(role, table)) {
            documents = [];
          } else if (table === "settings") {
            documents = documents.filter(doc => canReadSettingKey(role, (doc as any).key));
          }

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

        let data = sanitizeAndNormalize(table, rawData);
        data.id = documentId;
        // Single-branch system: always stamp the one branch id.
        data.branch_id = MAIN_BRANCH_ID;
        // settings.key is NOT NULL and was stripped as untrusted input —
        // re-derive it from the document id (see stampSettingKey).
        stampSettingKey(table, data, documentId);

        const deniedPost = await authorize({ table, method: "POST", docId: documentId, submitted: data });
        if (deniedPost) return deniedPost;

        if (table === "orders") {
          // Refund is terminal: a stale whole-row upsert (cloudUpsert sends the
          // entire order) must never overwrite a refunded row's payment state.
          const currentRow = await env.DB
            .prepare(`SELECT paymentStatus, refundedAt, refundReason, status FROM orders WHERE id = ?`)
            .bind(documentId)
            .first();
          data = applyRefundLatch(data, currentRow);
        }

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

        // Last-writer-wins freshness guard — see the /api/sync upsert above.
        const updatedAtCol = UPDATED_AT_COLUMN[table];
        const freshness = updatedAtCol
          ? ` WHERE excluded.${updatedAtCol} > ${table}.${updatedAtCol}`
          : "";

        const sql = `
          INSERT INTO ${table} (${columns})
          VALUES (${placeholders})
          ON CONFLICT(id) DO UPDATE SET
            ${updates}${freshness}
        `;

        const values = keys.map(k => data[k]);
        const upsertResult: any = await env.DB.prepare(sql).bind(...values).run();

        if (table === "snapshots") {
          await pruneSnapshots(env.DB, MAIN_BRANCH_ID);
        }

        const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(documentId).first();

        // Freshness-guard loss detection — see /api/sync above. When the ON
        // CONFLICT WHERE clause rejected the update, meta.changes === 0 and the
        // stored row was NOT touched. Return the CURRENT row with 200 + stale
        // so the client knows to rebase instead of believing its write landed.
        const changes = upsertResult?.meta?.changes;
        if (changes === 0) {
          console.warn(`[worker] stale write discarded on ${table}/${documentId} (freshness guard)`);
          return new Response(
            JSON.stringify({ ...denormalizeData(table, row), stale: true }),
            { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }

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
        let data = sanitizeAndNormalize(table, rawData);
        // Harmless on an UPDATE (the value can only equal the id-derived key),
        // and it heals a legacy settings row whose key column is NULL.
        stampSettingKey(table, data, docId);

        const deniedPatch = await authorize({ table, method: "PATCH", docId, submitted: data });
        if (deniedPatch) return deniedPatch;

        if (table === "orders") {
          // Refund is terminal: this path has no freshness guard, so a stale
          // tab PATCHing an old copy would otherwise resurrect a refunded order
          // to Paid/Unpaid unconditionally.
          const currentRow = await env.DB
            .prepare(`SELECT paymentStatus, refundedAt, refundReason, status FROM orders WHERE id = ?`)
            .bind(docId)
            .first();
          data = applyRefundLatch(data, currentRow);
        }

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

        const deniedDelete = await authorize({ table, method: "DELETE", docId });
        if (deniedDelete) return deniedDelete;

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

/**
 * Is the request's browser Origin explicitly allowlisted? Used to reject cross-
 * site state-changing requests (CSRF). A missing Origin (server-to-server, curl,
 * some same-origin GETs) returns false here; callers decide how to treat that.
 */
function isOriginAllowed(originHeader: string | null, env: Env): boolean {
  if (!originHeader) return false;
  const allowedRaw = env.ALLOWED_ORIGINS;
  if (!allowedRaw || !allowedRaw.trim()) return false;
  return allowedRaw.split(",").map(s => s.trim()).filter(Boolean).includes(originHeader);
}

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
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-ID, X-Device-ID, X-API-Key, X-CSRF-Token, X-Refund-PIN",
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-ID, X-Device-ID, X-API-Key, X-CSRF-Token, X-Refund-PIN",
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
  // Defence in depth (Blocker 1): a settings row's `key` is derived from the
  // document id and is NEVER client-writable. The authorization layer already
  // denies a mismatching `key`, but stripping it at the sanitize boundary as
  // well means no write path (REST POST/PATCH, /api/sync) can ever smuggle a
  // `key` column change into SQL — even by accident from a stale client.
  if (table === "settings") {
    delete sanitized.key;
  }
  return sanitized;
}

/**
 * Re-attach a settings row's `key` column, derived SERVER-SIDE from the document id.
 *
 * WHY THIS EXISTS — the "settings never save" outage.
 * sanitizeAndNormalize() strips a client-supplied `key` (correct: the key
 * authorizes the write, so it must never come from the client). But `settings.key`
 * is `TEXT NOT NULL` in the schema, and SQLite validates NOT NULL on the candidate
 * row BEFORE `ON CONFLICT(id) DO UPDATE` resolves the conflict. So an upsert built
 * without `key` fails with `NOT NULL constraint failed: settings.key` for BOTH new
 * rows AND updates to existing rows — every settings write (tax rate, store config,
 * credential hashes, tables/staff lists) died with a generic 500 "Sync failed",
 * while the POS kept the value in localStorage and showed "saved". The next
 * hydrate then pulled the stale D1 copy back over it, so the operator saw the
 * value silently revert (e.g. tax rate snapping back to 0).
 *
 * Stripping and then re-deriving the key keeps the security property intact —
 * the stored key can only ever be the one encoded in the id the row is written
 * to, never a client-chosen one — while satisfying the NOT NULL constraint. It
 * also heals any legacy row whose key column is NULL.
 */
function stampSettingKey(table: string, data: any, docId: string | null | undefined): void {
  if (table !== "settings") return;
  const key = settingKeyFrom(null, docId, null);
  if (key) data.key = key;
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
