/**
 * /api/sync no longer echoes raw D1 error messages to the client.
 *
 * SQLite errors disclose table names, column names and constraint details. The
 * catch block now logs the real error server-side but returns the generic
 * "Sync failed" to the caller.
 *
 *   node --experimental-strip-types test/sync-error-privacy.test.mts
 */

import assert from "node:assert/strict";
import worker from "../src/index.ts";

let passed = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  passed++;
  console.log("  ✓", label);
}

function bufToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function clientHash(pw: string) {
  const e = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey("raw", e.encode(pw), "PBKDF2", false, ["deriveBits", "deriveKey"]);
  const dk = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  return { hash: bufToHex(new Uint8Array(await crypto.subtle.exportKey("raw", dk))), salt: bufToHex(salt) };
}

const MANAGER_PASSWORD = "mgr-syncerr-2207";
const DETAILED_MSG = "UNIQUE constraint failed: orders.id";

/** Stub D1 whose upsert .run() throws a detailed SQLite error. */
function makeStubDB(settings: Record<string, string>) {
  return {
    prepare(sql: string) {
      const bound: any[] = [];
      return {
        bind(...args: any[]) {
          bound.push(...args);
          return this;
        },
        async first() {
          if (/FROM settings/i.test(sql) && bound[0] && bound[0] in settings) {
            return { value: settings[bound[0]] };
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          // Rate-limit bookkeeping is allowed to succeed; the order upsert fails.
          if (/INSERT INTO settings/i.test(sql)) return { success: true, meta: { changes: 1 } };
          throw new Error(DETAILED_MSG);
        },
      };
    },
  };
}

async function main() {
  console.log("\n1) D1 error message is NOT echoed to the client");
  const creds = await clientHash(MANAGER_PASSWORD);
  const env: any = {
    DB: makeStubDB({
      "global::brewmaster_manager_creds_v1": JSON.stringify({ username: "manager", ...creds }),
    }),
    SESSION_SECRET: "syncerr-secret",
    ALLOWED_ORIGINS: "https://pos.engaz.tech",
  };

  // Capture console.error to prove the detail IS logged server-side.
  const logged: string[] = [];
  const origError = console.error;
  console.error = (...args: any[]) => {
    logged.push(args.map(String).join(" "));
    origError(...args);
  };

  try {
    const mint = await worker.fetch(
      new Request("https://api.engaz.tech/v1/session", {
        method: "POST",
        headers: { Origin: "https://pos.engaz.tech", "Content-Type": "application/json" },
        body: JSON.stringify({ password: MANAGER_PASSWORD }),
      }),
      env
    );
    const cookie = (mint.headers.get("Set-Cookie") || "").split(";")[0];
    const mintBody: any = await mint.json();

    const res = await worker.fetch(
      new Request("https://api.engaz.tech/api/sync", {
        method: "POST",
        headers: {
          Origin: "https://pos.engaz.tech",
          "Content-Type": "application/json",
          Cookie: cookie,
          "X-CSRF-Token": mintBody.csrfToken,
        },
        body: JSON.stringify({
          type: "orders",
          action: "update",
          data: { id: "o1", totalAmount: 10, updatedAt: "2026-06-01T00:00:00Z" },
        }),
      }),
      env
    );

    ok(res.status === 500, `status 500 (got ${res.status})`);
    const body: any = await res.json();
    ok(body.error === "Sync Error", "error field is 'Sync Error'");
    ok(body.message === "Sync failed", "message is the generic 'Sync failed'");
    ok(!JSON.stringify(body).includes(DETAILED_MSG), "raw D1 message NOT in response body");
    ok(!JSON.stringify(body).includes("orders.id"), "table/column detail NOT in response body");

    console.log("\n2) detailed error IS logged server-side");
    const allLogs = logged.join("\n");
    ok(allLogs.includes(DETAILED_MSG), "console.error captured the detailed D1 message");
  } finally {
    console.error = origError;
  }

  console.log(`\n✅ sync-error-privacy.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ sync-error-privacy FAILED:", err);
  process.exit(1);
});
