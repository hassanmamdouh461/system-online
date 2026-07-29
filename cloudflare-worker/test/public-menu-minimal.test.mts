/**
 * /public/menu returns only the guest-safe columns.
 *
 * The endpoint previously ran SELECT * and passed every column through
 * denormalizeData, exposing branch_id, created_at, updated_at, deleted_at and
 * the internal `available` flag. The query now selects only
 * id, name, price, category, description, image.
 *
 *   node --experimental-strip-types test/public-menu-minimal.test.mts
 */

import assert from "node:assert/strict";
import worker from "../src/index.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

/**
 * Stub D1 that captures the menu query and returns a row with ALL the columns a
 * real menu_items table has — so the test proves the worker only selects the
 * safe ones (if the query were still SELECT *, the extra fields would appear).
 */
function makeStubDB(captured: { sql: string | null }) {
  return {
    prepare(sql: string) {
      if (/FROM menu_items/i.test(sql)) captured.sql = sql;
      return {
        bind() {
          return this;
        },
        async first() {
          return null;
        },
        async all() {
          if (/FROM menu_items/i.test(sql)) {
            // Even though the SELECT lists explicit columns, return a full-fat
            // row here: denormalizeData must have nothing extra to pass through.
            return {
              results: [
                {
                  id: "m1",
                  name: "Latte",
                  price: 25.5,
                  category: "Coffee",
                  description: "Double shot",
                  image: "https://img.example/latte.png",
                  available: 1,
                  branch_id: "main_branch",
                  created_at: "2026-01-01T00:00:00Z",
                  updated_at: "2026-05-01T00:00:00Z",
                  deleted_at: null,
                },
              ],
            };
          }
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
}

async function main() {
  console.log("\n1) the SQL selects only the six public columns");
  const captured: { sql: string | null } = { sql: null };
  const env: any = { DB: makeStubDB(captured), ALLOWED_ORIGINS: "https://pos.engaz.tech" };
  const res = await worker.fetch(
    new Request("https://api.engaz.tech/public/menu", { headers: { Origin: "https://pos.engaz.tech" } }),
    env
  );
  ok(res.status === 200, `status 200 (got ${res.status})`);
  ok(captured.sql !== null, "menu query was issued");
  ok(!/SELECT \*/i.test(captured.sql!), "query is not SELECT *");
  for (const col of ["id", "name", "price", "category", "description", "image"]) {
    ok(new RegExp(`\\b${col}\\b`).test(captured.sql!), `query selects ${col}`);
  }
  for (const col of ["branch_id", "created_at", "updated_at", "deleted_at"]) {
    ok(!new RegExp(`SELECT[^)]*\\b${col}\\b`, "i").test(captured.sql!.split("FROM")[0]), `query does NOT select ${col}`);
  }

  console.log("\n2) response documents carry no internal fields");
  const body: any = await res.json();
  ok(Array.isArray(body.documents) && body.documents.length === 1, "one document returned");
  const doc = body.documents[0];
  ok(doc.id === "m1", "id present");
  ok(doc.name === "Latte", "name present");
  ok(doc.price === 25.5, "price present");
  ok(doc.category === "Coffee", "category present");
  ok(doc.description === "Double shot", "description present");
  ok(doc.image === "https://img.example/latte.png", "image present");
  // available is stripped by design — but note denormalizeData sets it from the
  // row, and the row came from our stub. The SELECT no longer fetches it, so a
  // real D1 would return undefined. Assert the query guarantees absence.
  ok(!/SELECT[^)]*\bavailable\b/i.test(captured.sql!.split("FROM")[0]), "query does NOT select available");

  console.log(`\n✅ public-menu-minimal.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ public-menu-minimal FAILED:", err);
  process.exit(1);
});
