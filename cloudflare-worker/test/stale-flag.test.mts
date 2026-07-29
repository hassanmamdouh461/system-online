/**
 * Stale-flag response when the last-writer-wins freshness guard discards a write.
 *
 * Both upsert paths (/api/sync and REST POST) now inspect D1's meta.changes:
 *   - changes === 0 on a conflict ⇒ the WHERE clause rejected the update, so the
 *     stored row is newer. The response must carry `stale: true` plus the current
 *     row so the client can rebase instead of believing its write landed.
 *   - changes === 1 ⇒ normal insert/update, no stale flag.
 *
 *   node --experimental-strip-types test/stale-flag.test.mts
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

const MANAGER_PASSWORD = "mgr-stale-1103";
const CURRENT_ROW = {
  id: "inv-1",
  name: "Espresso Beans",
  stock: 42,
  updated_at: "2026-06-01T12:00:00Z",
  branch_id: "main_branch",
};

/**
 * Stub D1 whose upsert .run() reports a configurable meta.changes and whose
 * re-read .first() returns the (newer) stored row.
 */
function makeStubDB(settings: Record<string, string>, changes: number) {
  return {
    prepare(sql: string) {
      const bound: any[] = [];
      return {
        bind(...args: any[]) {
          bound.push(...args);
          return this;
        },
        async first() {
          // Session mint: credential lookup
          if (/FROM settings/i.test(sql) && bound[0] && bound[0] in settings) {
            return { value: settings[bound[0]] };
          }
          // Stale re-read / current-row fetch
          if (/FROM inventory/i.test(sql)) {
            return { ...CURRENT_ROW };
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO settings/i.test(sql)) return { success: true, meta: { changes: 1 } };
          // The upsert under test — report the configured change count.
          return { success: true, meta: { changes } };
        },
      };
    },
  };
}

async function mintSession(env: any) {
  const mint = await worker.fetch(
    new Request("https://api.engaz.tech/v1/session", {
      method: "POST",
      headers: { Origin: "https://pos.engaz.tech", "Content-Type": "application/json" },
      body: JSON.stringify({ password: MANAGER_PASSWORD }),
    }),
    env
  );
  const cookie = (mint.headers.get("Set-Cookie") || "").split(";")[0];
  const body: any = await mint.json();
  return { cookie, csrf: body.csrfToken };
}

const SYNC_BODY = {
  type: "inventory",
  action: "update",
  data: { id: "inv-1", name: "Espresso Beans", stock: 10, updated_at: "2026-06-01T10:00:00Z" },
};
const REST_URL = "https://api.engaz.tech/v1/databases/default/collections/inventory/documents";

async function main() {
  const creds = await clientHash(MANAGER_PASSWORD);
  const settings = {
    "global::brewmaster_manager_creds_v1": JSON.stringify({ username: "manager", ...creds }),
  };
  const HEADERS = {
    Origin: "https://pos.engaz.tech",
    "Content-Type": "application/json",
  };

  console.log("\n1) /api/sync: changes=0 → stale:true + current row");
  {
    const env: any = {
      DB: makeStubDB(settings, 0),
      SESSION_SECRET: "stale-secret",
      ALLOWED_ORIGINS: "https://pos.engaz.tech",
    };
    const { cookie, csrf } = await mintSession(env);
    const res = await worker.fetch(
      new Request("https://api.engaz.tech/api/sync", {
        method: "POST",
        headers: { ...HEADERS, Cookie: cookie, "X-CSRF-Token": csrf },
        body: JSON.stringify(SYNC_BODY),
      }),
      env
    );
    const body: any = await res.json();
    ok(res.status === 200, `status 200 (got ${res.status})`);
    ok(body.stale === true, "stale flag is true");
    ok(body.current && body.current.id === "inv-1", "current row echoed back");
    ok(body.current.stock === 42, "current row is the NEWER stored version (stock=42)");
  }

  console.log("\n2) /api/sync: changes=1 → no stale flag (normal write)");
  {
    const env: any = {
      DB: makeStubDB(settings, 1),
      SESSION_SECRET: "stale-secret",
      ALLOWED_ORIGINS: "https://pos.engaz.tech",
    };
    const { cookie, csrf } = await mintSession(env);
    const res = await worker.fetch(
      new Request("https://api.engaz.tech/api/sync", {
        method: "POST",
        headers: { ...HEADERS, Cookie: cookie, "X-CSRF-Token": csrf },
        body: JSON.stringify(SYNC_BODY),
      }),
      env
    );
    const body: any = await res.json();
    ok(res.status === 200, `status 200 (got ${res.status})`);
    ok(body.success === true, "success true");
    ok(body.stale === undefined, "no stale flag on a landed write");
    ok(!("current" in body), "no current row on a landed write");
  }

  console.log("\n3) REST POST: changes=0 → 200 + stale:true + current row");
  {
    const env: any = {
      DB: makeStubDB(settings, 0),
      SESSION_SECRET: "stale-secret",
      ALLOWED_ORIGINS: "https://pos.engaz.tech",
    };
    const { cookie, csrf } = await mintSession(env);
    const res = await worker.fetch(
      new Request(REST_URL, {
        method: "POST",
        headers: { ...HEADERS, Cookie: cookie, "X-CSRF-Token": csrf },
        body: JSON.stringify({
          documentId: "inv-1",
          data: { name: "Espresso Beans", stock: 10, updated_at: "2026-06-01T10:00:00Z" },
        }),
      }),
      env
    );
    const body: any = await res.json();
    ok(res.status === 200, `status 200 (not 201) (got ${res.status})`);
    ok(body.stale === true, "stale flag is true");
    ok(body.id === "inv-1", "current row echoed back");
    ok(body.stock === 42, "current row is the NEWER stored version (stock=42)");
  }

  console.log("\n4) REST POST: changes=1 → 201, no stale flag");
  {
    const env: any = {
      DB: makeStubDB(settings, 1),
      SESSION_SECRET: "stale-secret",
      ALLOWED_ORIGINS: "https://pos.engaz.tech",
    };
    const { cookie, csrf } = await mintSession(env);
    const res = await worker.fetch(
      new Request(REST_URL, {
        method: "POST",
        headers: { ...HEADERS, Cookie: cookie, "X-CSRF-Token": csrf },
        body: JSON.stringify({
          documentId: "inv-1",
          data: { name: "Espresso Beans", stock: 10, updated_at: "2026-06-01T10:00:00Z" },
        }),
      }),
      env
    );
    const body: any = await res.json();
    ok(res.status === 201, `status 201 (got ${res.status})`);
    ok(body.stale === undefined, "no stale flag on a landed write");
  }

  console.log(`\n✅ stale-flag.test: ${passed} assertions passed\n`);
}

main().catch((err) => {
  console.error("\n❌ stale-flag FAILED:", err);
  process.exit(1);
});
