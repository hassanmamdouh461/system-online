/**
 * Client-side verification for the cookie-session cloud auth (fix A.1).
 *
 * Proves, against the REAL cloudConfig.ts source, that:
 *   • a session is established automatically — no operator-entered API key
 *   • every cloud request sends credentials: 'include' (so the cookie rides)
 *   • no Authorization / X-API-Key header is sent anymore
 *   • a 401 mid-session triggers exactly ONE re-mint + retry (self-healing)
 *   • the public QR menu never mints a session
 *
 * Zero dependencies: a small fetch/localStorage/navigator stub stands in for the
 * browser, and Node's native type-stripping runs the .ts source as-is.
 *
 * Run:  npm run test:client   (from the repo root)
 */

import assert from 'node:assert/strict';

// ─── Browser stubs (must exist before importing the module under test) ────────
const WORKER = 'https://api.engaz.tech';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
/** Queue of responders; the last one repeats once exhausted. */
let responders: Array<(url: string, init: RequestInit) => { status: number; body?: unknown }> = [];

function installFetch() {
  calls = [];
  (globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const responder = responders.length > 1 ? responders.shift()! : responders[0];
    const { status, body } = responder(String(url), init);
    return new Response(JSON.stringify(body ?? { ok: true }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window = { location: { origin: 'https://pos.engaz.tech' }, localStorage: (globalThis as any).localStorage };
// Node 24 exposes `navigator` as a getter-only global, so it must be redefined
// rather than assigned. We only need the `onLine` flag the source checks.
const nav = { onLine: true };
Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });

store.set('brewmaster_d1_worker_url', WORKER);
installFetch();

// The REAL source is imported here. cloudConfig reads import.meta.env (a Vite
// construct); test/ts-loader.mjs rewrites it to globalThis.__VITE_ENV__ so the
// module runs unmodified under Node.
const cloud = await import('../cloudConfig.ts');

const sessionCalls = () => calls.filter((c) => c.url.endsWith('/v1/session'));
const dataCalls = () => calls.filter((c) => !c.url.endsWith('/v1/session'));

// ─── Tiny harness ────────────────────────────────────────────────────────────
const results: Array<{ name: string; ok: boolean; err?: string }> = [];
async function test(name: string, fn: () => Promise<void>) {
  // Fresh state per test: no cached session, no recorded calls.
  cloud.resetCloudSession();
  installFetch();
  responders = [() => ({ status: 200, body: { documents: [] } })];
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err: any) {
    results.push({ name, ok: false, err: err?.message || String(err) });
  }
}

// ─── 1. Zero-setup: a session is minted with no key anywhere ──────────────────
await test('first cloud read mints a session automatically (no API key needed)', async () => {
  assert.equal(store.get('brewmaster_d1_api_key'), undefined, 'no api key should exist');
  const docs = await cloud.cloudGetCollection('orders');
  assert.deepEqual(docs, []);
  assert.equal(sessionCalls().length, 1, 'expected exactly one session mint');
  assert.equal(sessionCalls()[0].init.method, 'POST');
  assert.equal(dataCalls().length, 1, 'expected one data request');
});

// ─── 2. The cookie must actually be allowed to ride ───────────────────────────
await test("every request sends credentials: 'include'", async () => {
  await cloud.cloudGetCollection('orders');
  assert.ok(calls.length >= 2, 'expected session + data calls');
  for (const c of calls) {
    assert.equal((c.init as any).credentials, 'include', `missing credentials on ${c.url}`);
  }
});

// ─── 3. No key headers may leak ───────────────────────────────────────────────
await test('no Authorization / X-API-Key header is ever sent', async () => {
  await cloud.cloudGetCollection('orders');
  await cloud.cloudUpsert('orders', 'ord_1', { totalAmount: 10 });
  for (const c of calls) {
    const headers = ((c.init.headers as Record<string, string>) || {});
    const names = Object.keys(headers).map((h) => h.toLowerCase());
    assert.ok(!names.includes('authorization'), `Authorization leaked on ${c.url}`);
    assert.ok(!names.includes('x-api-key'), `X-API-Key leaked on ${c.url}`);
  }
});

// ─── 4. Session is reused, not re-minted per request ──────────────────────────
await test('a cached session is reused across requests (one mint, not three)', async () => {
  await cloud.cloudGetCollection('orders');
  await cloud.cloudGetCollection('menu');
  await cloud.cloudGetCollection('customers');
  assert.equal(sessionCalls().length, 1, `expected 1 mint, got ${sessionCalls().length}`);
  assert.equal(dataCalls().length, 3);
});

// ─── 5. Concurrent callers share a single in-flight mint ──────────────────────
await test('concurrent first calls share ONE mint (no thundering herd)', async () => {
  await Promise.all([
    cloud.cloudGetCollection('orders'),
    cloud.cloudGetCollection('menu'),
    cloud.cloudGetCollection('customers'),
  ]);
  assert.equal(sessionCalls().length, 1, `expected 1 mint, got ${sessionCalls().length}`);
});

// ─── 6. THE self-healing path: 401 → re-mint → retry succeeds ─────────────────
await test('a 401 triggers one re-mint and a successful retry', async () => {
  let dataHits = 0;
  responders = [
    (url, init) => {
      if (url.endsWith('/v1/session')) return { status: 200 };
      dataHits++;
      // First data request 401s (stale/expired cookie), the retry succeeds.
      return dataHits === 1
        ? { status: 401, body: { error: 'Unauthorized' } }
        : { status: 200, body: { documents: [{ id: 'ord_1' }] } };
    },
  ];

  const docs = await cloud.cloudGetCollection('orders');
  assert.deepEqual(docs, [{ id: 'ord_1' }], 'retry should return the documents');
  assert.equal(dataHits, 2, 'expected exactly one retry');
  assert.equal(sessionCalls().length, 2, 'expected initial mint + one re-mint');
});

// ─── 7. A persistent 401 must not loop forever ────────────────────────────────
await test('a persistent 401 retries only once (no infinite loop)', async () => {
  let dataHits = 0;
  responders = [
    (url) => {
      if (url.endsWith('/v1/session')) return { status: 200 };
      dataHits++;
      return { status: 401, body: { error: 'Unauthorized' } };
    },
  ];

  const docs = await cloud.cloudGetCollection('orders');
  assert.equal(docs, null, 'a failed read must return null, not throw');
  assert.equal(dataHits, 2, `expected 2 attempts total, got ${dataHits}`);
});

// ─── 8. Writes self-heal too (this is the backup path) ────────────────────────
await test('cloudUpsert self-heals on 401 and reports success', async () => {
  let dataHits = 0;
  responders = [
    (url) => {
      if (url.endsWith('/v1/session')) return { status: 200 };
      dataHits++;
      return dataHits === 1 ? { status: 401 } : { status: 201, body: { id: 'ord_1' } };
    },
  ];

  const ok = await cloud.cloudUpsert('orders', 'ord_1', { totalAmount: 42 });
  assert.equal(ok, true, 'upsert should succeed after re-mint');
  assert.equal(dataHits, 2);
});

// ─── 9. A failed mint is not cached ───────────────────────────────────────────
await test('a failed mint is not cached — the next call retries it', async () => {
  responders = [
    (url) => (url.endsWith('/v1/session') ? { status: 500 } : { status: 200, body: { documents: [] } }),
  ];
  await cloud.cloudGetCollection('orders');
  const first = sessionCalls().length;
  await cloud.cloudGetCollection('orders');
  assert.ok(sessionCalls().length > first, 'a failed mint must be retried, not cached');
});

// ─── 10. Public QR menu stays anonymous ───────────────────────────────────────
await test('public menu read never mints a session', async () => {
  responders = [() => ({ status: 200, body: { documents: [{ id: 'm1' }] } })];
  const items = await cloud.cloudGetPublicMenu();
  assert.deepEqual(items, [{ id: 'm1' }]);
  assert.equal(sessionCalls().length, 0, 'a QR guest must not mint a session');
  assert.equal(dataCalls().length, 1);
});

// ─── 11. Logout drops the server session ──────────────────────────────────────
await test('clearCloudSession DELETEs the session and forces a fresh mint after', async () => {
  await cloud.cloudGetCollection('orders');
  assert.equal(sessionCalls().length, 1);

  await cloud.clearCloudSession();
  const del = sessionCalls().find((c) => c.init.method === 'DELETE');
  assert.ok(del, 'expected a DELETE /v1/session');
  assert.equal((del!.init as any).credentials, 'include');

  await cloud.cloudGetCollection('orders');
  assert.equal(
    sessionCalls().filter((c) => c.init.method === 'POST').length,
    2,
    'a request after logout must mint a new session'
  );
});

// ─── 12. Offline / unconfigured must stay quiet ───────────────────────────────
await test('offline: no network calls attempted', async () => {
  nav.onLine = false;
  const docs = await cloud.cloudGetCollection('orders');
  nav.onLine = true;
  assert.equal(docs, null);
  assert.equal(calls.length, 0, 'nothing should be attempted while offline');
});

await test('no worker URL configured: no calls, no crash', async () => {
  store.delete('brewmaster_d1_worker_url');
  const docs = await cloud.cloudGetCollection('orders');
  store.set('brewmaster_d1_worker_url', WORKER);
  assert.equal(docs, null);
  assert.equal(calls.length, 0);
});

// ─── 13. The removed helpers must be gone ─────────────────────────────────────
await test('getApiKey / setApiKey / buildCloudHeaders no longer exist', async () => {
  assert.equal((cloud as any).getApiKey, undefined, 'getApiKey should be deleted');
  assert.equal((cloud as any).setApiKey, undefined, 'setApiKey should be deleted');
  assert.equal((cloud as any).buildCloudHeaders, undefined, 'buildCloudHeaders should be deleted');
  assert.equal(typeof (cloud as any).cloudHeaders, 'function', 'cloudHeaders should replace it');
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
