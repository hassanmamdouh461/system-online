import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regression guard for the snapshot/sync 403 that could never recover.
 *
 * THE BUG (production, pos.engaz.tech → api.engaz.tech):
 *   POST /v1/databases/default/collections/snapshots/documents → 403 forever,
 *   while every GET hydrated fine.
 *
 * Two independent defects had to be fixed, and each is asserted below:
 *
 *   1. The CSRF token was cached in a module-level variable read ONCE at import.
 *      The POS is routinely open in several tabs; tabs share the session cookie
 *      and localStorage but not module memory. The tab that minted SECOND rotated
 *      the cookie's sid, so the first tab kept presenting a token that could
 *      never match again. getCsrfToken() must therefore re-read localStorage.
 *
 *   2. The client classified "stale CSRF (retry)" vs "role denied (permanent)"
 *      purely from the X-CSRF-Failed RESPONSE HEADER. Cross-origin, a custom
 *      header is unreadable unless the Worker lists it in
 *      Access-Control-Expose-Headers — it did not, so the check always read null,
 *      the re-mint+retry never fired, and syncService retired queued writes as
 *      permission failures (dropped data). Detection must also honour the JSON
 *      body `code`, which is always readable cross-origin.
 *
 * A plain role denial must still NEVER be retried.
 */

const CSRF_KEY = 'brewmaster_csrf_token';
const WORKER_URL_KEY = 'brewmaster_d1_worker_url';

function installLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
  (globalThis as any).localStorage = ls;
  return ls;
}

/** cloudFetch bails out early unless the runtime looks online. */
function forceOnline() {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
}

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Fresh module instance, so module-load state reflects the current storage. */
async function loadCloudConfig() {
  vi.resetModules();
  return import('./cloudConfig');
}

describe('CSRF failure recovery', () => {
  let storage: ReturnType<typeof installLocalStorage>;

  beforeEach(() => {
    storage = installLocalStorage({ [WORKER_URL_KEY]: 'https://api.engaz.tech' });
    forceOnline();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).localStorage;
  });

  it('getCsrfToken picks up a token minted by ANOTHER TAB after this module loaded', async () => {
    // This tab starts with no token at all…
    const { getCsrfToken } = await loadCloudConfig();
    expect(getCsrfToken()).toBe('');

    // …then a second tab signs in and rotates the shared session.
    storage.setItem(CSRF_KEY, 'token-from-tab-B');

    // Reading the module-level cache would still yield '' and 403 forever.
    expect(getCsrfToken()).toBe('token-from-tab-B');
  });

  it('getCsrfToken prefers the stored token over a stale in-memory one', async () => {
    storage.setItem(CSRF_KEY, 'token-1');
    const { getCsrfToken } = await loadCloudConfig();
    expect(getCsrfToken()).toBe('token-1');

    storage.setItem(CSRF_KEY, 'token-2'); // another tab re-minted
    expect(getCsrfToken()).toBe('token-2');
  });

  it('retries a 403 identified ONLY by the body code (header invisible cross-origin)', async () => {
    storage.setItem(CSRF_KEY, 'stale-token');
    const { cloudFetch } = await loadCloudConfig();

    const sentTokens: (string | null)[] = [];
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      sentTokens.push(init?.headers?.['X-CSRF-Token'] ?? null);
      if (fetchMock.mock.calls.length === 1) {
        // Another tab re-mints while this write is in flight.
        storage.setItem(CSRF_KEY, 'fresh-token');
        // NOTE: deliberately NO X-CSRF-Failed header — that is exactly what the
        // browser saw before Access-Control-Expose-Headers was added.
        return json({ error: 'Forbidden', code: 'csrf_token' }, 403);
      }
      return json({ success: true }, 200);
    });
    (globalThis as any).fetch = fetchMock;

    const res = await cloudFetch('/v1/databases/default/collections/snapshots/documents', {
      method: 'POST',
      body: '{}',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentTokens[0]).toBe('stale-token');
    expect(sentTokens[1]).toBe('fresh-token'); // the retry used the other tab's token
    expect(res?.status).toBe(200);
    // The body must still be readable: the CSRF sniff clones, never consumes.
    await expect(res!.json()).resolves.toEqual({ success: true });
  });

  it('still retries when the X-CSRF-Failed header IS visible', async () => {
    storage.setItem(CSRF_KEY, 'stale-token');
    const { cloudFetch } = await loadCloudConfig();

    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        storage.setItem(CSRF_KEY, 'fresh-token');
        return json({ error: 'Forbidden' }, 403, { 'X-CSRF-Failed': '1' });
      }
      return json({ success: true }, 200);
    });
    (globalThis as any).fetch = fetchMock;

    const res = await cloudFetch('/v1/databases/default/collections/snapshots/documents', {
      method: 'POST',
      body: '{}',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res?.status).toBe(200);
  });

  it('NEVER retries a genuine role denial from permissions.ts', async () => {
    storage.setItem(CSRF_KEY, 'good-token');
    const { cloudFetch } = await loadCloudConfig();

    const fetchMock = vi.fn(async () =>
      json(
        { error: 'Forbidden', code: 'cashier_delete_forbidden', message: 'الحذف غير مسموح' },
        403,
        { 'X-Auth-Role': 'cashier' },
      ),
    );
    (globalThis as any).fetch = fetchMock;

    const res = await cloudFetch('/v1/databases/default/collections/orders/documents/o1', {
      method: 'DELETE',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res?.status).toBe(403);
    // The caller still gets an intact body to show the operator's Arabic reason.
    await expect(res!.json()).resolves.toMatchObject({ code: 'cashier_delete_forbidden' });
  });

  it('does not retry a csrf_origin 403 (re-minting cannot fix a blocked Origin)', async () => {
    storage.setItem(CSRF_KEY, 'good-token');
    const { cloudFetch } = await loadCloudConfig();

    const fetchMock = vi.fn(async () =>
      json({ error: 'Forbidden', code: 'csrf_origin' }, 403),
    );
    (globalThis as any).fetch = fetchMock;

    const res = await cloudFetch('/v1/databases/default/collections/snapshots/documents', {
      method: 'POST',
      body: '{}',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res?.status).toBe(403);
  });

  it('does not attach a CSRF token to reads', async () => {
    storage.setItem(CSRF_KEY, 'good-token');
    const { cloudFetch } = await loadCloudConfig();

    let sentHeaders: any = null;
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      sentHeaders = init?.headers;
      return json({ documents: [] }, 200);
    });
    (globalThis as any).fetch = fetchMock;

    await cloudFetch('/v1/databases/default/collections/orders/documents');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentHeaders?.['X-CSRF-Token']).toBeUndefined();
  });
});

describe('syncService CSRF classification', () => {
  it('treats CSRF-failed 403s as retryable instead of retiring the queued write', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, './syncService.ts'), 'utf8');

    // The permanent-retirement branch must exclude CSRF failures identified by
    // the BODY code, not just the (cross-origin-invisible) header. Retiring a
    // stale-CSRF write drops it permanently — real data loss.
    expect(src).toContain("bodyCode === 'csrf_token'");
    expect(src).toContain("bodyCode === 'csrf_origin'");
    expect(src).toContain('if (response.status === 403 && !csrfFailed)');
  });
});
