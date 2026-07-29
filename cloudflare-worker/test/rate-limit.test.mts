/**
 * D1-backed rate limiter on POST /v1/session (checkRateLimit in auth.ts).
 *
 * Asserts:
 *   - the first `maxAttempts` calls from the same key are allowed
 *   - the next call within the window is blocked
 *   - once the window expires, calls are allowed again
 *   - a D1 error fails OPEN (returns true) so auth stays up
 *
 *   node --experimental-strip-types test/rate-limit.test.mts
 */

import assert from "node:assert/strict";
import { checkRateLimit } from "../src/auth.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

/**
 * Stub D1 that actually stores the rate_limit settings rows in a mutable map so
 * time can be simulated by rewriting the stored timestamp array between calls.
 */
function makeStubDB(store: Record<string, string>) {
  return {
    prepare(sql: string) {
      const bound: any[] = [];
      return {
        bind(...args: any[]) {
          bound.push(...args);
          return this;
        },
        async first() {
          if (/FROM settings/i.test(sql) && bound[0] && bound[0] in store) {
            return { value: store[bound[0]] };
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO settings/i.test(sql)) {
            // bind order: id, key, value, branch_id, updated_at
            store[bound[0]] = bound[2];
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  };
}

/** Stub D1 whose every statement rejects — simulates a broken database. */
function makeBrokenDB() {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async first() {
          throw new Error("D1 is down");
        },
        async all() {
          throw new Error("D1 is down");
        },
        async run() {
          throw new Error("D1 is down");
        },
      };
    },
  };
}

async function main() {
  console.log("\n1) first N attempts allowed, N+1 blocked within the window");
  const store: Record<string, string> = {};
  const env: any = { DB: makeStubDB(store) };
  const KEY = "session_mint:1.2.3.4";
  const MAX = 5;
  const WINDOW = 60;

  for (let i = 1; i <= MAX; i++) {
    const allowed = await checkRateLimit(env, KEY, MAX, WINDOW);
    ok(allowed === true, `attempt ${i}/${MAX} allowed`);
  }
  const blocked = await checkRateLimit(env, KEY, MAX, WINDOW);
  ok(blocked === false, `attempt ${MAX + 1} blocked`);

  console.log("\n2) attempts are allowed again after the window expires");
  // Simulate time passing: rewrite the stored timestamps so they are all older
  // than the window. The limiter filters attempts older than now - window.
  const id = `global::rate_limit::${KEY}`;
  const stale = JSON.parse(store[id]).map((t: number) => t - WINDOW - 1);
  store[id] = JSON.stringify(stale);

  const afterWindow = await checkRateLimit(env, KEY, MAX, WINDOW);
  ok(afterWindow === true, "allowed again once old attempts age out");

  console.log("\n3) D1 error fails open");
  const brokenEnv: any = { DB: makeBrokenDB() };
  const failOpen = await checkRateLimit(brokenEnv, KEY, MAX, WINDOW);
  ok(failOpen === true, "D1 error → allowed (fail-open)");

  console.log(`\n✅ rate-limit.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ rate-limit FAILED:", err);
  process.exit(1);
});
