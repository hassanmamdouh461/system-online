// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getWorkerUrl, resetWorkerUrlWarningForTests } from './cloudConfig';

/**
 * Regression guard: a build with no VITE_CLOUDFLARE_WORKER_URL must not silently
 * attach itself to the production database.
 *
 * WHY THIS GUARD EXISTS
 * getWorkerUrl() returned a hardcoded 'https://api.engaz.tech' whenever the env
 * var was unset — in EVERY mode, including `npm run dev`, and BEFORE the stored
 * operator override was consulted. So:
 *
 *   • Running the app locally without configuring anything pointed local testing
 *     at the live D1 database holding real orders, real revenue and the real
 *     menu. A developer creating a test order, deleting a menu item, or
 *     triggering a sync was operating on the running business, with no UI
 *     indication. CORS on the production Worker — an unrelated safety net in a
 *     different system — was the only thing that prevented this from destroying
 *     production data.
 *   • The operator-facing worker-URL override in localStorage was unreachable:
 *     the built-in constant was checked first and always won, so the setting
 *     silently did nothing in every build.
 *
 * Vitest runs with import.meta.env.DEV === true, so these tests exercise the dev
 * path directly. The production fallback is deliberately retained (an existing
 * deployment must keep working) and is asserted at the source level below.
 */

const SRC = readFileSync(resolve(__dirname, './cloudConfig.ts'), 'utf8');

/** Strip comments so prose about api.engaz.tech is not mistaken for code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('getWorkerUrl() in a dev environment', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    resetWorkerUrlWarningForTests();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    localStorage.clear();
  });

  it('does NOT fall back to the production worker when nothing is configured', () => {
    // The whole point: unconfigured dev stays local-only.
    expect(getWorkerUrl()).toBe('');
  });

  it('never returns the production host from an unconfigured dev build', () => {
    expect(getWorkerUrl()).not.toContain('api.engaz.tech');
  });

  it('warns loudly, exactly once, when the env var is missing', () => {
    getWorkerUrl();
    getWorkerUrl();
    getWorkerUrl();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0]?.[0] ?? '');
    // The warning has to name the variable, or it cannot be acted on.
    expect(message).toContain('VITE_CLOUDFLARE_WORKER_URL');
  });

  it('honours the stored operator override', () => {
    localStorage.setItem('brewmaster_d1_worker_url', 'https://staging.example-worker.dev');
    expect(getWorkerUrl()).toBe('https://staging.example-worker.dev');
  });

  it('the stored override is consulted BEFORE the built-in constant', () => {
    // This is the ordering bug: the built-in used to win over the override, so
    // the override silently did nothing.
    localStorage.setItem('brewmaster_d1_worker_url', 'https://my-own-worker.workers.dev');
    const url = getWorkerUrl();
    expect(url).toBe('https://my-own-worker.workers.dev');
    expect(url).not.toContain('api.engaz.tech');
  });

  it('still rejects the SPA origin and placeholder URLs via cleanUrl', () => {
    localStorage.setItem('brewmaster_d1_worker_url', 'https://pos.engaz.tech');
    expect(getWorkerUrl()).toBe('');

    resetWorkerUrlWarningForTests();
    localStorage.setItem('brewmaster_d1_worker_url', 'https://system-online.YOUR_SUBDOMAIN.workers.dev');
    expect(getWorkerUrl()).toBe('');
  });
});

describe('resolution order, asserted on the source', () => {
  it('the built-in production worker is gated behind a dev check', () => {
    const body = code(SRC);
    // The constant must not be returned unconditionally.
    expect(body).toContain('BUILTIN_PRODUCTION_WORKER');
    expect(body).toMatch(/isDevEnvironment\s*\(\s*\)/);
  });

  it('the dev branch returns before the built-in fallback is reached', () => {
    const body = code(SRC);
    const devBranch = body.indexOf('isDevEnvironment()');
    const builtinUse = body.indexOf('cleanUrl(BUILTIN_PRODUCTION_WORKER)');
    expect(devBranch).toBeGreaterThan(-1);
    expect(builtinUse).toBeGreaterThan(-1);
    // Dev short-circuit must come first, otherwise dev reaches production again.
    expect(devBranch).toBeLessThan(builtinUse);
  });

  it('the stored override is read before the built-in fallback', () => {
    const body = code(SRC);
    const stored = body.indexOf('brewmaster_d1_worker_url');
    const builtinUse = body.indexOf('cleanUrl(BUILTIN_PRODUCTION_WORKER)');
    expect(stored).toBeGreaterThan(-1);
    expect(stored).toBeLessThan(builtinUse);
  });

  it('production still has a working fallback so live deployments do not break', () => {
    // Deliberate: removing this would turn a missing env var into a dead POS.
    expect(code(SRC)).toContain("'https://api.engaz.tech'");
  });
});
