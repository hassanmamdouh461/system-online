/**
 * POST /v1/session must never lock out an honest operator.
 *
 * The bug: the limiter spent a slot on EVERY POST — successful mints, the
 * client's background re-mints on hydrate/reload, and multi-tab bursts all
 * counted the same as a wrong password. Five in a minute and the login screen
 * said "محاولات كتير أوي — استنى دقيقة وجرّب تاني" to a manager whose password
 * was CORRECT. On a café's single public IP every till shares one bucket, so
 * this fired during the busy hour, not in testing.
 *
 * The rule now: only a REJECTED credential spends budget, a success wipes the
 * window, and the ceiling (40 failures / 10 min) is one no human at a till
 * reaches.
 *
 *   node --experimental-strip-types test/login-no-lockout.test.mts
 */

import assert from "node:assert/strict";
import { peekRateLimit, recordRateLimitAttempt, clearRateLimit, __resetMemoryRateLimit } from "../src/auth.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

/** Stub D1 backing the rate_limit settings rows with a mutable map. */
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
          if (/INSERT INTO settings/i.test(sql)) store[bound[0]] = bound[2];
          if (/DELETE FROM settings/i.test(sql)) delete store[bound[0]];
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  };
}

const MAX = 40;
const WINDOW = 600;

async function main() {
  __resetMemoryRateLimit();

  console.log("\n1) peek does not consume budget (successes and re-mints are free)");
  {
    const store: Record<string, string> = {};
    const env: any = { DB: makeStubDB(store) };
    const KEY = "session_mint:41.33.7.9";
    for (let i = 0; i < 200; i++) {
      const allowed = await peekRateLimit(env, KEY, MAX, WINDOW);
      if (!allowed) break;
    }
    ok(
      (await peekRateLimit(env, KEY, MAX, WINDOW)) === true,
      "200 successful/background mints in a row never trip the limit"
    );
    ok(Object.keys(store).length === 0, "no rate-limit row is even written for non-failures");
  }

  console.log("\n2) a burst of correct logins from one café IP stays open");
  {
    const store: Record<string, string> = {};
    const env: any = { DB: makeStubDB(store) };
    const KEY = "session_mint:196.221.4.10"; // every till behind one router
    // Six tills mint at open, exactly the burst that used to produce 429s.
    for (let i = 0; i < 6; i++) {
      ok(await peekRateLimit(env, KEY, MAX, WINDOW), `till ${i + 1} allowed to mint`);
      await clearRateLimit(env, KEY); // success wipes the window
    }
  }

  console.log("\n3) a human typo is answered immediately, not with a cooldown");
  {
    const store: Record<string, string> = {};
    const env: any = { DB: makeStubDB(store) };
    const KEY = "session_mint:41.33.7.9";
    // Five wrong passwords — the old limit exactly.
    for (let i = 0; i < 5; i++) await recordRateLimitAttempt(env, KEY, WINDOW);
    ok(
      (await peekRateLimit(env, KEY, MAX, WINDOW)) === true,
      "6th attempt after five typos is still allowed (old rule blocked here)"
    );
    // …and the correct password on the 6th try clears the slate.
    await clearRateLimit(env, KEY);
    ok(
      (await peekRateLimit(env, KEY, MAX, WINDOW)) === true,
      "a successful login forgives every earlier typo"
    );
    ok(Object.keys(store).length === 0, "the window row is deleted on success");
  }

  console.log("\n4) the brute-force backstop still exists");
  {
    const store: Record<string, string> = {};
    const env: any = { DB: makeStubDB(store) };
    const KEY = "session_mint:198.51.100.7";
    for (let i = 0; i < MAX; i++) await recordRateLimitAttempt(env, KEY, WINDOW);
    ok(
      (await peekRateLimit(env, KEY, MAX, WINDOW)) === false,
      `${MAX} rejected passwords in the window are blocked (a script, not a person)`
    );

    // A different IP is unaffected — the block is per-attacker, not global.
    ok(
      (await peekRateLimit(env, "session_mint:203.0.113.5", MAX, WINDOW)) === true,
      "a blocked IP does not lock out the rest of the shop"
    );
  }

  console.log("\n5) the window ages out");
  {
    const store: Record<string, string> = {};
    const env: any = { DB: makeStubDB(store) };
    const KEY = "session_mint:198.51.100.8";
    for (let i = 0; i < MAX; i++) await recordRateLimitAttempt(env, KEY, WINDOW);
    const id = `global::rate_limit::${KEY}`;
    store[id] = JSON.stringify(JSON.parse(store[id]).map((t: number) => t - WINDOW - 1));
    ok(
      (await peekRateLimit(env, KEY, MAX, WINDOW)) === true,
      "allowed again once the old failures age out"
    );
  }

  console.log("\n6) a broken D1 does not lock the till out");
  {
    const brokenEnv: any = {
      DB: {
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
      },
    };
    __resetMemoryRateLimit();
    ok(
      (await peekRateLimit(brokenEnv, "session_mint:1.1.1.1", MAX, WINDOW)) === true,
      "D1 outage falls back to the in-memory window and still allows login"
    );
  }

  console.log(`\n✅ login-no-lockout.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ login-no-lockout.test FAILED:", err.message);
  process.exit(1);
});
