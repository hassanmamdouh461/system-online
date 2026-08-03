/**
 * The backup-staleness alarm needs a last-write timestamp — from BEHIND the
 * session gate.
 *
 * Settings showed "last successful backup: never" while D1 was healthy and
 * writes were landing, because the Worker never returned a last-write marker at
 * all. The client read `body.lastWriteAt` from /api/health, which does not (and
 * must not) carry it: /api/health is deliberately public, and row counts and
 * write timestamps were removed from it on purpose (D-02). With both the local
 * queue high-water mark and lastWriteAt null, App.tsx's "backups are stale"
 * branch was unreachable — the alarm only fired if the Worker was fully down.
 *
 * So: a NEW authenticated route carries the timestamp, and /api/health stays
 * public and clean.
 *
 *   node --experimental-strip-types test/last-write-status.test.mts
 */

import assert from "node:assert/strict";
import worker from "../src/index.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

const LAST_WRITE = "2026-08-03T12:34:56.000Z";
const MANAGER_KEY = "mgr-key-status-4412";

function makeStubDB(lastWrite: string | null = LAST_WRITE) {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (/lastWriteAt/i.test(sql)) return { lastWriteAt: lastWrite };
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

const ORIGIN = "https://pos.engaz.tech";
const envWith = (db: unknown) => ({
  DB: db,
  ALLOWED_ORIGINS: ORIGIN,
  MANAGER_API_KEY: MANAGER_KEY,
});

function statusRequest(auth: boolean) {
  return new Request("https://api.engaz.tech/api/status", {
    headers: auth
      ? { Origin: ORIGIN, "X-API-Key": MANAGER_KEY }
      : { Origin: ORIGIN },
  });
}

async function main() {
  console.log("\n1) /api/status is BEHIND the session gate");
  {
    const res = await worker.fetch(statusRequest(false), envWith(makeStubDB()) as any);
    ok(res.status === 401, `unauthenticated → 401 (got ${res.status})`);
    const body: any = await res.json().catch(() => ({}));
    ok(!("lastWriteAt" in body), "no timestamp leaked to an unauthenticated caller");
  }

  console.log("\n2) an authenticated caller gets the newest write timestamp");
  {
    const res = await worker.fetch(statusRequest(true), envWith(makeStubDB()) as any);
    ok(res.status === 200, `status 200 (got ${res.status})`);
    const body: any = await res.json();
    ok(body.lastWriteAt === LAST_WRITE, `lastWriteAt is the newest write (got ${body.lastWriteAt})`);
    ok(typeof body.checkedAt === "string", "checkedAt present");
    ok(res.headers.get("Cache-Control")?.includes("no-store") === true, "never cached");
  }

  console.log("\n3) an empty database answers null, not an error");
  {
    const res = await worker.fetch(statusRequest(true), envWith(makeStubDB(null)) as any);
    ok(res.status === 200, `status 200 (got ${res.status})`);
    const body: any = await res.json();
    ok(body.lastWriteAt === null, "lastWriteAt is null on a database with no rows");
  }

  console.log("\n4) /api/health stays public AND free of operational detail");
  {
    const res = await worker.fetch(
      new Request("https://api.engaz.tech/api/health", { headers: { Origin: ORIGIN } }),
      envWith(makeStubDB()) as any
    );
    ok(res.status === 200, `public health still 200 without auth (got ${res.status})`);
    const body: any = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ["checkedAt", "db", "ok"], "health keys unchanged");
    passed++;
    console.log("  ✓ health body is still exactly { ok, db, checkedAt }");
  }

  console.log(`\n✅ last-write-status.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ last-write-status.test FAILED\n", err);
  process.exit(1);
});
