/**
 * END-TO-END REFUND REPRODUCTION against a REAL SQLite D1.
 *
 * The other refund tests exercise applyRefundLatch in isolation with hand-made
 * rows. This one drives the actual fetch() handler over a real SQLite database
 * created from the production schema, using the EXACT payload shapes the browser
 * sends (whole-row upserts from cloudUpsertWithOutcome), so SQL-level semantics
 * (ON CONFLICT ... WHERE freshness, meta.changes) are real rather than stubbed.
 *
 *   node --experimental-strip-types test/refund-e2e-repro.test.mts
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.ts";

let passed = 0;
let failed = 0;
function ok(cond: unknown, label: string) {
  if (cond) { passed++; console.log("  \u2713", label); }
  else { failed++; console.log("  \u2717 FAIL:", label); }
}

/* ── A real D1 shim over node:sqlite ──────────────────────────────────────── */
function makeRealDB(sqlite: DatabaseSync) {
  const conv = (v: any) => (v === undefined ? null : v);
  return {
    prepare(sql: string) {
      let bound: any[] = [];
      const api = {
        bind(...args: any[]) {
          bound = args.map(conv);
          return api;
        },
        async first() {
          const st = sqlite.prepare(sql);
          const r = st.get(...bound);
          return r ?? null;
        },
        async all() {
          const st = sqlite.prepare(sql);
          return { results: st.all(...bound), success: true };
        },
        async run() {
          const st = sqlite.prepare(sql);
          const info = st.run(...bound);
          return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return api;
    },
    async batch(stmts: any[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function clientHashPassword(password: string) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);
  const derivedKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  return { hash: bufToHex(new Uint8Array(exported)), salt: bufToHex(salt) };
}

const ORIGIN = "https://pos.engaz.tech";
const API = "https://api.engaz.tech";

async function main() {
  const sqlite = new DatabaseSync(":memory:");
  const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  // Apply base schema + every migration, mirroring production.
  sqlite.exec(schema);
  for (let v = 2; v <= 13; v++) {
    try {
      const m = readFileSync(new URL(`../schema-migrate-v${v}.sql`, import.meta.url), "utf8");
      for (const stmt of m.split(";")) {
        const s = stmt.trim();
        if (!s || s.startsWith("--")) continue;
        try { sqlite.exec(s); } catch { /* already applied / not applicable */ }
      }
    } catch { /* migration file absent */ }
  }

  const creds = await clientHashPassword("mgr-pass-1");
  const cashCreds = await clientHashPassword("cash-pass-1");
  sqlite.prepare(`INSERT OR REPLACE INTO settings (id, key, value, branch_id, updated_at) VALUES (?,?,?,?,'2026-08-01T00:00:00.000Z')`).run(
    "global::brewmaster_manager_creds_v1",
    "brewmaster_manager_creds_v1",
    JSON.stringify({ username: "manager", ...creds }),
    "main_branch"
  );
  sqlite.prepare(`INSERT OR REPLACE INTO settings (id, key, value, branch_id, updated_at) VALUES (?,?,?,?,'2026-08-01T00:00:00.000Z')`).run(
    "global::brewmaster_cashier_creds_v1",
    "brewmaster_cashier_creds_v1",
    JSON.stringify({ username: "cashier", ...cashCreds }),
    "main_branch"
  );

  const env: any = { DB: makeRealDB(sqlite), SESSION_SECRET: "test-secret", ALLOWED_ORIGINS: ORIGIN };

  async function mint(password: string) {
    const res = await worker.fetch(
      new Request(`${API}/v1/session`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }),
      env
    );
    const body: any = await res.clone().json().catch(() => ({}));
    const cookie = (res.headers.get("Set-Cookie") || "").split(";")[0];
    return { status: res.status, cookie, csrf: body?.csrfToken ?? body?.csrf ?? null, body };
  }

  /** Exactly what cloudUpsertWithOutcome() sends. */
  async function upsert(order: any, sess: { cookie: string; csrf: string | null }) {
    const payload = { ...order, id: order.id, branch_id: "main_branch", branchId: "main_branch" };
    const headers: any = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: sess.cookie, "X-Branch-ID": "main_branch" };
    if (sess.csrf) headers["X-CSRF-Token"] = sess.csrf;
    const res = await worker.fetch(
      new Request(`${API}/v1/databases/default/collections/orders/documents`, {
        method: "POST",
        headers,
        body: JSON.stringify({ documentId: order.id, data: payload }),
      }),
      env
    );
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, json, text };
  }

  const row = (id: string) => sqlite.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as any;

  console.log("\n1) mint sessions");
  const mgr = await mint("mgr-pass-1");
  ok(mgr.status === 200, `manager session minted (${mgr.status})`);
  const cashier = await mint("cash-pass-1");
  console.log(`   cashier mint status: ${cashier.status}, role=${cashier.body?.role}`);

  /* ── Scenario A: the exact production shape.
   * An order created by the till has NO updatedAt (IndexedDbOrderRepository.create
   * never sets one — confirmed in the live D1 snapshots), is then paid, and is
   * finally refunded with a fresh updatedAt. */
  console.log("\n2) create an order the way the till creates it (NO updatedAt)");
  const id = "ord_repro_1";
  const created = {
    id,
    orderNumber: "7",
    tableId: "Takeaway",
    items: [{ menuItemId: "m1", name: "Espresso", price: 50, quantity: 2 }],
    status: "New",
    paymentStatus: "Unpaid",
    totalAmount: 100,
    createdAt: "2026-08-03T16:00:00.000Z",
    // NOTE: no updatedAt — this is what the real client sends.
  };
  const c = await upsert(created, mgr);
  ok(c.status === 201 || c.status === 200, `create upsert accepted (${c.status})`);
  ok(!!row(id), "order row exists in D1");
  console.log(`   stored updatedAt after create: ${JSON.stringify(row(id).updatedAt)}`);

  console.log("\n3) pay it (completeWithPayment → whole-row upsert)");
  const paid = {
    ...created,
    status: "New",
    paymentStatus: "Paid",
    paymentMethod: "Cash",
    paidAt: "2026-08-03T16:10:00.000Z",
    taxRate: 14,
    taxAmount: 14,
    grandTotal: 114,
    updatedAt: "2026-08-03T16:10:00.000Z",
  };
  const p = await upsert(paid, mgr);
  console.log(`   pay upsert → ${p.status}, stale=${p.json?.stale}`);
  ok(row(id).paymentStatus === "Paid", `D1 shows Paid (got ${row(id).paymentStatus})`);

  console.log("\n4) REFUND it (performRefund → whole-row upsert, fresh updatedAt)");
  const refunded = {
    ...paid,
    paymentStatus: "Refunded",
    refundedAt: "2026-08-03T16:30:00.000Z",
    refundReason: "Refund / void",
    status: "Cancelled",
    updatedAt: "2026-08-03T16:30:00.000Z",
  };
  const r = await upsert(refunded, mgr);
  console.log(`   refund upsert → ${r.status}, stale=${r.json?.stale}, body=${r.text.slice(0, 200)}`);
  const after = row(id);
  console.log(`   D1 now: paymentStatus=${after.paymentStatus} refundedAt=${after.refundedAt} status=${after.status}`);
  ok(after.paymentStatus === "Refunded", `MANAGER refund persisted to D1 (got ${after.paymentStatus})`);

  /* ── Scenario B: the same refund performed by a CASHIER session. */
  if (cashier.status === 200) {
    console.log("\n5) same flow as a CASHIER");
    const id2 = "ord_repro_2";
    const base2 = { ...created, id: id2, orderNumber: "8" };
    await upsert(base2, mgr);
    const paid2 = { ...base2, paymentStatus: "Paid", paymentMethod: "Cash", paidAt: "2026-08-03T17:00:00.000Z", taxRate: 14, taxAmount: 14, grandTotal: 114, updatedAt: "2026-08-03T17:00:00.000Z" };
    const p2 = await upsert(paid2, mgr);
    console.log(`   cashier-order pay → ${p2.status} stale=${p2.json?.stale}`);
    const ref2 = { ...paid2, paymentStatus: "Refunded", refundedAt: "2026-08-03T17:30:00.000Z", refundReason: "Refund / void", status: "Cancelled", updatedAt: "2026-08-03T17:30:00.000Z" };
    const r2 = await upsert(ref2, cashier);
    console.log(`   CASHIER refund → ${r2.status} stale=${r2.json?.stale} body=${r2.text.slice(0, 220)}`);
    const a2 = row(id2);
    console.log(`   D1 now: paymentStatus=${a2.paymentStatus} refundedAt=${a2.refundedAt}`);
    ok(a2.paymentStatus === "Refunded", `CASHIER refund persisted to D1 (got ${a2.paymentStatus})`);
  }

  /* ── Scenario C: the stale re-sync that the latch is supposed to stop —
   * the till's sync_queue still holds the ORIGINAL create row (no updatedAt)
   * and flushes it after the refund. */
  console.log("\n6) stale create-row re-sync after the refund (queue flush)");
  const stale = await upsert(created, mgr); // no updatedAt, Unpaid
  console.log(`   stale re-sync → ${stale.status} stale=${stale.json?.stale}`);
  const a3 = row(id);
  console.log(`   D1 now: paymentStatus=${a3.paymentStatus} refundedAt=${a3.refundedAt} status=${a3.status}`);
  ok(a3.paymentStatus === "Refunded", `refund survives a stale re-sync (got ${a3.paymentStatus})`);


  /* ── Scenario D: the shape of TODAY'S PRODUCTION ROWS — the order is inserted
   * already-Paid in ONE write that carries updatedAt (createdAt == paidAt ==
   * updatedAt, exactly as live D1 shows), then refunded. */
  console.log("\n7) production shape: inserted already-Paid WITH updatedAt, then refunded");
  const id4 = "ord_repro_4";
  const bornPaid = {
    id: id4, orderNumber: "9", tableId: "Takeaway",
    items: [{ menuItemId: "m1", name: "Espresso", price: 50, quantity: 2 }],
    status: "New", paymentStatus: "Paid", paymentMethod: "Cash",
    totalAmount: 100, taxRate: 14, taxAmount: 14, grandTotal: 114,
    createdAt: "2026-08-03T16:39:12.499Z", paidAt: "2026-08-03T16:39:12.499Z",
    updatedAt: "2026-08-03T16:39:12.499Z",
  };
  const b4 = await upsert(bornPaid, mgr);
  console.log(`   insert-paid → ${b4.status} stale=${b4.json?.stale}; stored updatedAt=${JSON.stringify(row(id4)?.updatedAt)}`);
  const ref4 = { ...bornPaid, paymentStatus: "Refunded", refundedAt: "2026-08-03T20:40:00.000Z", refundReason: "Refund / void", status: "Cancelled", updatedAt: "2026-08-03T20:40:00.000Z" };
  const r4 = await upsert(ref4, mgr);
  console.log(`   refund → ${r4.status} stale=${r4.json?.stale}`);
  const a4 = row(id4);
  console.log(`   D1 now: paymentStatus=${a4.paymentStatus} refundedAt=${a4.refundedAt} status=${a4.status}`);
  ok(a4.paymentStatus === "Refunded", `refund lands when stored updatedAt is present (got ${a4.paymentStatus})`);

  /* ── Scenario E: the /api/sync queue path (syncService flush). */
  console.log("\n8) /api/sync queue path on a NULL-updatedAt row");
  const id5 = "ord_repro_5";
  const noUpd = { id: id5, orderNumber: "10", tableId: "Takeaway", items: [{ menuItemId: "m1", name: "Espresso", price: 50, quantity: 1 }], status: "New", paymentStatus: "Unpaid", totalAmount: 50, createdAt: "2026-08-03T18:00:00.000Z" };
  await upsert(noUpd, mgr);
  console.log(`   stored updatedAt=${JSON.stringify(row(id5)?.updatedAt)}`);
  const syncRes = await worker.fetch(new Request(`${API}/api/sync`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: mgr.cookie, "X-Branch-ID": "main_branch", ...(mgr.csrf ? { "X-CSRF-Token": mgr.csrf } : {}) },
    body: JSON.stringify({
      type: "order",
      action: "update",
      data: { ...noUpd, paymentStatus: "Refunded", refundedAt: "2026-08-03T18:30:00.000Z", refundReason: "Refund / void", status: "Cancelled", updatedAt: "2026-08-03T18:30:00.000Z" },
    }),
  }), env);
  console.log(`   /api/sync → ${syncRes.status} ${(await syncRes.text()).slice(0, 200)}`);
  const a5 = row(id5);
  console.log(`   D1 now: paymentStatus=${a5.paymentStatus} refundedAt=${a5.refundedAt}`);
  ok(a5.paymentStatus === "Refunded", `/api/sync refund lands on NULL-updatedAt row (got ${a5.paymentStatus})`);

  console.log(`\n=== refund-e2e-repro: ${passed} passed, ${failed} FAILED ===\n`);
  assert.equal(failed, 0, `${failed} refund scenario(s) regressed`);
}

main().catch((err) => {
  console.error("\n❌ refund-e2e-repro FAILED:", err?.message || err);
  process.exit(1);
});
