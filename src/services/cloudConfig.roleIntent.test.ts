// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regression guard for the manager-writes-as-cashier bug.
 *
 * A manager deleting a menu item on /manager-dashboard got
 *   403 "تعديل المنيو والوصفات غير مسموح لصلاحية الكاشير"
 * because the browser's ONE `pos_session` cookie had been re-minted as a cashier
 * by the till tab. The dashboard kept believing it was a manager (the role is
 * cached in memory at mint), so it never re-minted, and the sync queue retired
 * the write as a permanent denial — the delete never reached D1, which is why the
 * cashier device never saw the menu change either.
 *
 * The client half of the fix, asserted here:
 *   1. Every cloud request carries `X-Role-Intent`, which selects WHICH
 *      role-scoped session cookie the Worker authenticates with.
 *   2. The intent is persisted, so a reloaded dashboard (no password in memory)
 *      still asks for the MANAGER session.
 *   3. The CSRF token is stored per role — one shared key let a cashier mint in
 *      another tab clobber the manager's token.
 *   4. reconcileSessionRole() re-mints when the server disagrees about the role,
 *      and emits ROLE_MISMATCH_EVENT when it cannot fix it silently.
 */

const WORKER = 'https://api.engaz.tech';

let cloud: typeof import('./cloudConfig');

async function loadModule() {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem('brewmaster_d1_worker_url', WORKER);
  cloud = await import('./cloudConfig');
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function headersOf(call: unknown[]): Record<string, string> {
  const init = (call[1] || {}) as RequestInit;
  return (init.headers || {}) as Record<string, string>;
}

describe('cloud role intent', () => {
  beforeEach(async () => {
    await loadModule();
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends no role intent before a role is declared', () => {
    expect(cloud.getRoleIntent()).toBeNull();
    expect(cloud.roleIntentHeaders()).toEqual({});
  });

  it('persists the declared role so a reload still asks for the same session', async () => {
    cloud.setRoleIntent('manager');
    expect(cloud.roleIntentHeaders()).toEqual({ 'X-Role-Intent': 'manager' });

    // Simulate a page reload: fresh module instance, same localStorage.
    const stored = localStorage.getItem('brewmaster_role_intent');
    expect(stored).toBe('manager');
    vi.resetModules();
    const reloaded = await import('./cloudConfig');
    expect(reloaded.getRoleIntent()).toBe('manager');
  });

  it('puts the role intent on every cloud request', async () => {
    cloud.setRoleIntent('manager');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ documents: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await cloud.cloudFetch('/v1/databases/default/collections/menu_items/documents');

    expect(fetchMock).toHaveBeenCalled();
    const headers = headersOf(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]);
    expect(headers['X-Role-Intent']).toBe('manager');
  });

  it('keeps the CSRF token per role so two tabs cannot clobber each other', async () => {
    cloud.setRoleIntent('cashier');
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, role: 'cashier', csrfToken: 'cashier-token' })
    );
    vi.stubGlobal('fetch', fetchMock);
    cloud.setSessionCredential('cashier-pass');
    await cloud.ensureCloudSession(true);

    expect(localStorage.getItem('brewmaster_csrf_token:cashier')).toBe('cashier-token');
    // The legacy shared key must not be left behind for another tab to read.
    expect(localStorage.getItem('brewmaster_csrf_token')).toBeNull();

    // Switching to the manager role must not inherit the cashier's token.
    cloud.setRoleIntent('manager');
    expect(cloud.getCsrfToken()).toBe('');
  });

  it('re-mints when the server session carries the wrong role', async () => {
    cloud.setRoleIntent('manager');
    cloud.setSessionCredential('manager-pass');

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase();
      // The probe reports the stale cashier session a sibling tab left behind.
      if (method === 'GET') return jsonResponse({ authenticated: true, role: 'cashier' });
      // The re-mint returns the correct role.
      return jsonResponse({ ok: true, role: 'manager', csrfToken: 'mgr-token' });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const repaired = await cloud.reconcileSessionRole();
    expect(repaired).toBe(true);
    expect(cloud.getSessionRole()).toBe('manager');
  });

  it('announces a mismatch it cannot repair (no password held after a reload)', async () => {
    cloud.setRoleIntent('manager');
    // No setSessionCredential: this is the post-reload state, cookie only.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ authenticated: true, role: 'cashier' }));
    vi.stubGlobal('fetch', fetchMock);

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener(cloud.ROLE_MISMATCH_EVENT, listener);

    const repaired = await cloud.reconcileSessionRole();

    window.removeEventListener(cloud.ROLE_MISMATCH_EVENT, listener);
    expect(repaired).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ expected: 'manager', actual: 'cashier' });
  });

  it('treats a matching role as fine and never re-mints', async () => {
    cloud.setRoleIntent('cashier');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ authenticated: true, role: 'cashier' }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await cloud.reconcileSessionRole()).toBe(true);
    // Exactly one call: the probe. No mint.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forgets the role on logout', () => {
    cloud.setRoleIntent('manager');
    cloud.setRoleIntent(null);
    expect(cloud.getRoleIntent()).toBeNull();
    expect(localStorage.getItem('brewmaster_role_intent')).toBeNull();
  });
});
