/**
 * /api/health no longer leaks business telemetry.
 *
 * The endpoint previously returned { ok, db, lastWriteAt, orderCount, checkedAt }.
 * Row counts and last-write timestamps are operational intel; the public probe
 * now returns only { ok, db, checkedAt }.
 *
 *   node --experimental-strip-types test/health-privacy.test.mts
 */

import assert from "node:assert/strict";
import worker from "../src/index.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

function makeStubDB() {
  return {
    prepare(_sql: string) {
      return {
        bind() {
          return this;
        },
        async first() {
          return { "?column?": 1 };
        },
        async all() {
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
  console.log("\n1) healthy DB → { ok, db, checkedAt } only");
  const env: any = { DB: makeStubDB(), ALLOWED_ORIGINS: "https://pos.engaz.tech" };
  const res = await worker.fetch(
    new Request("https://api.engaz.tech/api/health", { headers: { Origin: "https://pos.engaz.tech" } }),
    env
  );
  ok(res.status === 200, `status 200 (got ${res.status})`);
  const body: any = await res.json();
  ok(body.ok === true, "ok is true");
  ok(body.db === "ok", "db is 'ok'");
  ok(typeof body.checkedAt === "string", "checkedAt present");
  ok(!("orderCount" in body), "orderCount NOT in response");
  ok(!("lastWriteAt" in body), "lastWriteAt NOT in response");
  const keys = Object.keys(body).sort();
  assert.deepEqual(keys, ["checkedAt", "db", "ok"], "response has exactly the three public keys");
  passed++;
  console.log("  ✓ response keys are exactly { ok, db, checkedAt }");

  console.log("\n2) unconfigured DB → 503 { ok:false, db:'unconfigured', checkedAt }");
  const noDbEnv: any = { ALLOWED_ORIGINS: "https://pos.engaz.tech" };
  const res503 = await worker.fetch(
    new Request("https://api.engaz.tech/api/health", { headers: { Origin: "https://pos.engaz.tech" } }),
    noDbEnv
  );
  ok(res503.status === 503, `status 503 (got ${res503.status})`);
  const body503: any = await res503.json();
  ok(body503.ok === false, "ok is false");
  ok(body503.db === "unconfigured", "db is 'unconfigured'");
  ok(typeof body503.checkedAt === "string", "checkedAt present");
  ok(!("orderCount" in body503), "orderCount NOT in 503 response");

  console.log(`\n✅ health-privacy.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ health-privacy FAILED:", err);
  process.exit(1);
});
