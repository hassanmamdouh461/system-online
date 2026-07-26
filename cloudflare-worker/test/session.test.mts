/**
 * Verification for the cookie-session auth (fix A.1).
 *
 * Runs the REAL Worker sources in-process against a stub D1 and asserts the
 * ticket's acceptance criteria:
 *   /v1/.../orders WITHOUT cookie → 401
 *   /v1/.../orders WITH    cookie → 200
 *
 * Zero dependencies: Node 18+ provides fetch/Request/Response/crypto.subtle, and
 * Node's native type-stripping runs the .ts sources as-is.
 *
 * Run:  node --experimental-strip-types test/session.test.mts
 *   or: npm test   (from cloudflare-worker/)
 */

import assert from "node:assert/strict";
import worker from "../src/index.ts";

// ─── Stub D1 ─────────────────────────────────────────────────────────────────
const ORDER_ROW = {
  id: "ord_1",
  orderNumber: 1,
  items: JSON.stringify([{ name: "Latte", qty: 1 }]),
  paymentStatus: "Paid",
  totalAmount: 50,
  createdAt: "2026-07-26T10:00:00.000Z",
  updatedAt: "2026-07-26T10:00:00.000Z",
  branch_id: "main_branch",
};

const stubStatement = (sql: string) => {
  const rows = /FROM orders/.test(sql) ? [ORDER_ROW] : [];
  const self: any = {
    bind: () => self,
    first: async () => rows[0] ?? null,
    all: async () => ({ results: rows }),
    run: async () => ({ success: true }),
  };
  return self;
};

const stubDB: any = { prepare: (sql: string) => stubStatement(sql) };

const ORIGIN = "https://pos.engaz.tech";
// NOTE: API_KEY is deliberately unset — proves the Worker no longer needs it.
// (Previously an unset API_KEY made every endpoint return 503.)
const ENV: any = {
  DB: stubDB,
  ALLOWED_ORIGINS: ORIGIN,
  SESSION_SECRET: "test-secret-do-not-use-in-prod",
};

const ORDERS_URL = "https://api.engaz.tech/v1/databases/default/collections/orders/documents";
const SESSION_URL = "https://api.engaz.tech/v1/session";
const SYNC_URL = "https://api.engaz.tech/api/sync";

function req(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: { Origin: ORIGIN, ...((init.headers as Record<string, string>) || {}) },
  });
}

const call = (url: string, init: RequestInit = {}, env: any = ENV): Promise<Response> =>
  worker.fetch(req(url, init), env);

// ─── Tiny test harness ───────────────────────────────────────────────────────
const results: Array<{ name: string; ok: boolean; err?: string }> = [];
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err: any) {
    results.push({ name, ok: false, err: err?.message || String(err) });
  }
}

// ─── 1. Acceptance criterion: no cookie → 401 ────────────────────────────────
await test("GET /v1/.../orders without cookie → 401", async () => {
  const res = await call(ORDERS_URL);
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
  assert.equal((await res.json() as any).error, "Unauthorized");
});

// ─── 2. Mint the session cookie ──────────────────────────────────────────────
let cookie = "";
await test("POST /v1/session mints an HttpOnly, Secure, SameSite=None cookie", async () => {
  const res = await call(SESSION_URL, { method: "POST" });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const setCookie = res.headers.get("Set-Cookie");
  assert.ok(setCookie, "no Set-Cookie header");
  assert.match(setCookie!, /^pos_session=/);
  assert.match(setCookie!, /HttpOnly/, "must be HttpOnly (no JS/XSS access)");
  assert.match(setCookie!, /Secure/, "must be Secure");
  assert.match(setCookie!, /SameSite=None/, "cross-site cookie needs SameSite=None");
  cookie = setCookie!.split(";")[0];
});

// ─── 3. Acceptance criterion: with cookie → 200 ──────────────────────────────
await test("GET /v1/.../orders with cookie → 200 + documents", async () => {
  const res = await call(ORDERS_URL, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json() as any;
  assert.ok(Array.isArray(body.documents), "expected documents[]");
  assert.equal(body.documents.length, 1);
  assert.equal(body.documents[0].id, "ord_1");
});

// ─── 4. The actual backup write path ─────────────────────────────────────────
await test("POST /api/sync with cookie → 200 (backup write works)", async () => {
  const res = await call(SYNC_URL, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "order", action: "update", data: { id: "ord_1", totalAmount: 60 } }),
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
});

await test("POST /api/sync without cookie → 401 (backup stays gated)", async () => {
  const res = await call(SYNC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "order", action: "update", data: { id: "ord_1" } }),
  });
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

// ─── 5. Forgery / tampering must fail ────────────────────────────────────────
await test("tampered cookie → 401", async () => {
  const [name, value] = cookie.split("=");
  const res = await call(ORDERS_URL, { headers: { Cookie: `${name}=${value.slice(0, -3)}AAA` } });
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

await test("cookie signed with a different secret → 401", async () => {
  const mint = await call(SESSION_URL, { method: "POST" }, { ...ENV, SESSION_SECRET: "other-secret" });
  const other = mint.headers.get("Set-Cookie")!.split(";")[0];
  const res = await call(ORDERS_URL, { headers: { Cookie: other } });
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

await test("garbage cookie value → 401", async () => {
  const res = await call(ORDERS_URL, { headers: { Cookie: "pos_session=not-a-token" } });
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

// ─── 6. Expiry is enforced ───────────────────────────────────────────────────
await test("expired cookie → 401", async () => {
  const realNow = Date.now;
  // Mint 13h in the past — TTL is 12h, so it is already expired.
  Date.now = () => realNow() - 13 * 60 * 60 * 1000;
  const mint = await call(SESSION_URL, { method: "POST" });
  Date.now = realNow;
  const stale = mint.headers.get("Set-Cookie")!.split(";")[0];
  const res = await call(ORDERS_URL, { headers: { Cookie: stale } });
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

// ─── 7. CORS must permit credentials, else the browser drops the cookie ──────
await test("CORS: allow-credentials true with a specific (non-*) origin", async () => {
  const res = await call(ORDERS_URL, { method: "OPTIONS" });
  assert.equal(res.headers.get("Access-Control-Allow-Credentials"), "true");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.notEqual(res.headers.get("Access-Control-Allow-Origin"), "*", "cannot be * with credentials");
});

await test("CORS: a non-allowlisted origin is not reflected", async () => {
  const res = await worker.fetch(
    new Request(ORDERS_URL, { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
    ENV
  );
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "");
});

// ─── 8. Public QR menu remains anonymous ─────────────────────────────────────
await test("GET /public/menu without cookie → 200 (QR guests unaffected)", async () => {
  const res = await call("https://api.engaz.tech/public/menu");
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
});

// ─── 9. Session probe + logout ───────────────────────────────────────────────
await test("GET /v1/session probes status; DELETE clears the cookie", async () => {
  const anon = await call(SESSION_URL);
  assert.equal(anon.status, 401);

  const authed = await call(SESSION_URL, { headers: { Cookie: cookie } });
  assert.equal(authed.status, 200);
  assert.equal((await authed.json() as any).authenticated, true);

  const cleared = await call(SESSION_URL, { method: "DELETE" });
  assert.equal(cleared.status, 200);
  assert.match(cleared.headers.get("Set-Cookie")!, /Max-Age=0/);
});

// ─── 10. Regressions around the old API_KEY behaviour ────────────────────────
await test("unset API_KEY no longer 503s the whole Worker", async () => {
  const res = await call(ORDERS_URL, { headers: { Cookie: cookie } });
  assert.notEqual(res.status, 503, "unset API_KEY must not disable the service");
  assert.equal(res.status, 200);
});

await test("legacy API_KEY header still accepted while that secret is set", async () => {
  const res = await call(
    ORDERS_URL,
    { headers: { Authorization: "Bearer legacy-key" } },
    { ...ENV, API_KEY: "legacy-key" }
  );
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
});

await test("wrong legacy key → 401", async () => {
  const res = await call(
    ORDERS_URL,
    { headers: { Authorization: "Bearer nope" } },
    { ...ENV, API_KEY: "legacy-key" }
  );
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

// ─── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`  \x1b[32m✓\x1b[0m ${r.name}`);
  else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${r.name}\n      ${r.err}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
