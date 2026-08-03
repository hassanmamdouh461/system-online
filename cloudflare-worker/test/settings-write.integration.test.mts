/**
 * Settings writes must actually LAND in D1 — regression test for the
 * "settings never save / values revert by themselves" outage.
 *
 * WHY THIS TEST EXISTS (and why the existing ones missed the bug)
 * --------------------------------------------------------------
 * Every other worker test drives a hand-written stub DB whose `run()` returns
 * `{ success: true }` no matter what SQL it was handed. That makes the whole
 * class of SCHEMA-CONSTRAINT bugs invisible. And a real one shipped:
 *
 *   sanitizeAndNormalize() strips a client-supplied `settings.key` (correct —
 *   the key authorizes the write). But `settings.key` is `TEXT NOT NULL`, and
 *   SQLite validates NOT NULL on the candidate row BEFORE `ON CONFLICT(id) DO
 *   UPDATE` resolves the conflict. So the emitted upsert failed with
 *   `NOT NULL constraint failed: settings.key` for BOTH inserts AND updates —
 *   every tax-rate / store-config / credential write died as a generic 500,
 *   the POS kept the value in localStorage and reported success, and the next
 *   hydrate pulled the stale cloud row back over it.
 *
 * So this test runs the REAL fetch() handler against a REAL SQLite database
 * created from the REAL schema.sql. Any future write path that violates a
 * column constraint fails here instead of in production.
 *
 *   node --experimental-strip-types test/settings-write.integration.test.mts
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import worker from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

// ─── PBKDF2 hash exactly as the browser POS stores it ────────────────────────
function bufToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function clientHashPassword(password: string): Promise<{ hash: string; salt: string }> {
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

// ─── Minimal D1 adapter over node:sqlite ─────────────────────────────────────
// Only the surface the Worker uses: prepare().bind().run()/first()/all(), and
// meta.changes (which the freshness-guard "stale" detection reads).
function makeSqliteD1(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      let params: any[] = [];
      const api = {
        bind(...args: any[]) {
          params = args;
          return api;
        },
        async first() {
          const row = db.prepare(sql).get(...params);
          return row === undefined ? null : row;
        },
        async all() {
          return { results: db.prepare(sql).all(...params) };
        },
        async run() {
          const res = db.prepare(sql).run(...params);
          return { success: true, meta: { changes: Number(res.changes) } };
        },
      };
      return api;
    },
  };
}

const MANAGER_PASSWORD = "mgr-settings-write-4417";
const ORIGIN = { Origin: "https://pos.engaz.tech" };
const SETTINGS_URL = "https://api.engaz.tech/v1/databases/default/collections/settings/documents";

async function main() {
  // Real schema, real constraints (settings.key TEXT NOT NULL).
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(resolve(here, "../schema.sql"), "utf8"));

  const creds = await clientHashPassword(MANAGER_PASSWORD);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO settings (id, key, value, branch_id, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(
    "global::brewmaster_manager_creds_v1",
    "brewmaster_manager_creds_v1",
    JSON.stringify({ username: "manager", ...creds }),
    "main_branch",
    now
  );
  // The stale row the operator keeps "failing" to overwrite (tax rate 0).
  db.prepare(
    "INSERT INTO settings (id, key, value, branch_id, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(
    "global::brewmaster_tax_rate",
    "brewmaster_tax_rate",
    "0",
    "main_branch",
    "2026-07-28T04:09:25.190Z"
  );

  const env: any = {
    DB: makeSqliteD1(db),
    SESSION_SECRET: "settings-write-secret",
    ALLOWED_ORIGINS: "https://pos.engaz.tech",
  };

  console.log("\n1) mint a manager session");
  const mint = await worker.fetch(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      headers: { ...ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ password: MANAGER_PASSWORD }),
    }),
    env
  );
  ok(mint.status === 200, `POST /v1/session → 200 (got ${mint.status})`);
  const mintBody: any = await mint.json();
  const cookie = (mint.headers.get("Set-Cookie") || "").split(";")[0];
  const writeHeaders = {
    ...ORIGIN,
    "Content-Type": "application/json",
    Cookie: cookie,
    "X-CSRF-Token": mintBody.csrfToken,
  };

  console.log("\n2) UPDATE an existing settings row (the tax rate)");
  const update = await worker.fetch(
    new Request(SETTINGS_URL, {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        documentId: "global::brewmaster_tax_rate",
        data: {
          id: "global::brewmaster_tax_rate",
          key: "brewmaster_tax_rate",
          value: "0.14",
          branchId: "main_branch",
          updatedAt: "2026-08-03T15:00:00.000Z",
        },
      }),
    }),
    env
  );
  const updateBody: any = await update.json().catch(() => ({}));
  ok(update.ok, `write succeeded (got ${update.status} ${JSON.stringify(updateBody)})`);
  ok(updateBody.stale !== true, "write was NOT discarded as stale");

  const taxRow: any = db
    .prepare("SELECT key, value, updated_at FROM settings WHERE id = ?")
    .get("global::brewmaster_tax_rate");
  ok(taxRow.value === "0.14", `stored value is the new one (got ${taxRow.value})`);
  ok(taxRow.key === "brewmaster_tax_rate", "key column survives the write (NOT NULL satisfied)");

  console.log("\n3) INSERT a settings row that does not exist yet");
  const insert = await worker.fetch(
    new Request(SETTINGS_URL, {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        documentId: "global::brewmaster_store_config",
        data: {
          id: "global::brewmaster_store_config",
          key: "brewmaster_store_config",
          value: JSON.stringify({ storeName: "co-worker space", phone: "01125377606" }),
          branchId: "main_branch",
          updatedAt: "2026-08-03T15:01:00.000Z",
        },
      }),
    }),
    env
  );
  ok(insert.ok, `insert succeeded (got ${insert.status})`);
  const storeRow: any = db
    .prepare("SELECT key, value FROM settings WHERE id = ?")
    .get("global::brewmaster_store_config");
  ok(!!storeRow, "the new row exists in D1");
  ok(storeRow.key === "brewmaster_store_config", "key is derived server-side from the document id");
  ok(String(storeRow.value).includes("01125377606"), "value landed intact");

  console.log("\n4) /api/sync writes settings too (the queue replay path)");
  const viaSync = await worker.fetch(
    new Request("https://api.engaz.tech/api/sync", {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        type: "settings",
        action: "update",
        data: {
          id: "global::pos_staff_list",
          key: "pos_staff_list",
          value: '["test1","test2"]',
          branchId: "main_branch",
          updatedAt: "2026-08-03T15:02:00.000Z",
        },
      }),
    }),
    env
  );
  const syncBody: any = await viaSync.json().catch(() => ({}));
  ok(viaSync.ok, `/api/sync succeeded (got ${viaSync.status} ${JSON.stringify(syncBody)})`);
  ok(syncBody.stale !== true, "/api/sync write was not discarded");
  const staffRow: any = db
    .prepare("SELECT key, value FROM settings WHERE id = ?")
    .get("global::pos_staff_list");
  ok(!!staffRow && staffRow.key === "pos_staff_list", "/api/sync row landed with its key");

  // The stored key must come from the DOCUMENT ID, never from the body — that is
  // the privilege-escalation guard (a cashier repointing a benign document at the
  // manager-credential key). Re-deriving it server-side must not weaken that: a
  // write addressed to document A while claiming key B has to be stored under A's
  // key, and must not touch B's row.
  console.log("\n5) a client CANNOT smuggle a different key onto another document");
  const spoof = await worker.fetch(
    new Request(SETTINGS_URL, {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        documentId: "global::brewmaster_language",
        data: {
          id: "global::brewmaster_language",
          key: "brewmaster_tax_rate", // ← lie
          value: "0.99",
          updatedAt: "2026-08-03T15:03:00.000Z",
        },
      }),
    }),
    env
  );
  ok(spoof.ok || spoof.status === 403, `spoofed key is neutralized or denied (got ${spoof.status})`);
  const langRow: any = db
    .prepare("SELECT key, value FROM settings WHERE id = ?")
    .get("global::brewmaster_language");
  if (langRow) {
    ok(langRow.key === "brewmaster_language", "stored key came from the id, not the body");
  }
  const stillTax: any = db
    .prepare("SELECT key, value FROM settings WHERE id = ?")
    .get("global::brewmaster_tax_rate");
  ok(stillTax.key === "brewmaster_tax_rate", "the tax-rate row's key was not repointed");
  ok(stillTax.value === "0.14", "the spoofed write did not reach the tax-rate row");

  console.log("\n6) the freshness guard still discards a genuinely older write");
  const stale = await worker.fetch(
    new Request(SETTINGS_URL, {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        documentId: "global::brewmaster_tax_rate",
        data: {
          id: "global::brewmaster_tax_rate",
          key: "brewmaster_tax_rate",
          value: "0.05",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    }),
    env
  );
  const staleBody: any = await stale.json().catch(() => ({}));
  ok(staleBody.stale === true, "older write is reported as stale");
  const afterStale: any = db
    .prepare("SELECT value FROM settings WHERE id = ?")
    .get("global::brewmaster_tax_rate");
  ok(afterStale.value === "0.14", "the newer stored value was preserved");

  console.log(`\n✅ settings-write.integration: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ settings-write.integration FAILED\n", err);
  process.exit(1);
});
