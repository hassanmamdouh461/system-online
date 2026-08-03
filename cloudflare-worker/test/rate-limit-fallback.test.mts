/**
 * The rate limiter no longer fails FULLY open when D1 is down.
 *
 * Failing open on a D1 outage is deliberate — a broken limiter must not lock
 * every operator out of the till. But full fail-open removed the only
 * brute-force protection at exactly the moment an attacker would want it gone.
 * There is now an in-isolate fallback window: auth keeps working, unlimited
 * guessing does not.
 *
 *   node --experimental-strip-types test/rate-limit-fallback.test.mts
 */

import assert from "node:assert/strict";
import { checkRateLimit, __resetMemoryRateLimit } from "../src/auth.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

const brokenDB: any = {
  prepare() {
    return {
      bind() {
        return this;
      },
      async first() {
        throw new Error("D1_ERROR: network failure");
      },
      async run() {
        throw new Error("D1_ERROR: network failure");
      },
    };
  },
};

async function main() {
  console.log("\n1) D1 down → first attempts still allowed (auth stays usable)");
  __resetMemoryRateLimit();
  const env: any = { DB: brokenDB };

  const results: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    results.push(await checkRateLimit(env, "session_mint:1.2.3.4", 5, 60));
  }
  ok(
    results.every((r) => r === true),
    "the first 5 attempts are allowed despite the D1 error"
  );

  console.log("\n2) D1 down → the 6th attempt is refused (no unlimited guessing)");
  const sixth = await checkRateLimit(env, "session_mint:1.2.3.4", 5, 60);
  ok(sixth === false, "attempt 6 within the window is blocked");
  const seventh = await checkRateLimit(env, "session_mint:1.2.3.4", 5, 60);
  ok(seventh === false, "and it stays blocked");

  console.log("\n3) the fallback window is per-key");
  const otherIp = await checkRateLimit(env, "session_mint:9.9.9.9", 5, 60);
  ok(otherIp === true, "a different client IP is unaffected");

  console.log("\n4) attempts outside the window expire");
  __resetMemoryRateLimit();
  // A zero-length window means every prior attempt is already past the cutoff.
  for (let i = 0; i < 10; i++) await checkRateLimit(env, "expiring", 2, 0);
  ok(
    (await checkRateLimit(env, "expiring", 2, 0)) === true,
    "an expired window does not permanently lock a client out"
  );

  console.log("\n5) a healthy D1 still drives the primary limiter");
  __resetMemoryRateLimit();
  const stored: Record<string, string> = {};
  const goodEnv: any = {
    DB: {
      prepare(sql: string) {
        const st: { args: any[] } = { args: [] };
        return {
          bind(...a: any[]) {
            st.args = a;
            return this;
          },
          async first() {
            return stored[st.args[0]] ? { value: stored[st.args[0]] } : null;
          },
          async run() {
            if (/INSERT INTO settings/i.test(sql)) stored[st.args[0]] = st.args[2];
            return { success: true };
          },
        };
      },
    },
  };
  const allowed: boolean[] = [];
  for (let i = 0; i < 3; i++) allowed.push(await checkRateLimit(goodEnv, "d1path", 3, 60));
  ok(allowed.every(Boolean), "D1 path allows up to the limit");
  ok((await checkRateLimit(goodEnv, "d1path", 3, 60)) === false, "D1 path blocks past the limit");

  console.log(`\n✅ rate-limit-fallback.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ rate-limit-fallback FAILED:", err);
  process.exit(1);
});
