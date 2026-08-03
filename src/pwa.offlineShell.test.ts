import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard: the offline app shell must exist and stay safe.
 *
 * The system is described as offline-first and its DATA layer is: orders live in
 * IndexedDB and survive a dropped line. The SHELL did not. There was no service
 * worker, no manifest, and no public/ directory at all, so every page load still
 * needed the network. Verified during the audit: with the connection cut, a full
 * page load failed with net::ERR_INTERNET_DISCONNECTED and the app was gone.
 * Offline therefore only held while nobody closed or refreshed the tab — and F5 is
 * the first thing anyone does when a screen looks stuck, so a cashier lost the till
 * for the length of the outage.
 *
 * These assertions also pin the two properties that make caching SAFE for a POS,
 * because the dangerous failure mode is not a cache miss:
 *   1. Cross-origin requests are never served from cache. Stale money data from the
 *      D1 Worker would be worse than an honest network error.
 *   2. Navigations are network-first, so a deploy is picked up immediately instead
 *      of pinning tills to an old build.
 */
const root = resolve(__dirname, '..');
const sw = readFileSync(resolve(root, 'public/sw.js'), 'utf8');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const main = readFileSync(resolve(root, 'src/main.tsx'), 'utf8');
const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');

describe('offline app shell', () => {
  it('ships a service worker and a manifest as static files', () => {
    expect(existsSync(resolve(root, 'public/sw.js'))).toBe(true);
    expect(existsSync(resolve(root, 'public/manifest.webmanifest'))).toBe(true);
  });

  it('public/ is not gitignored', () => {
    // It was — a Gatsby-template leftover — which silently swallowed every static
    // file added there and is part of why these assets never existed.
    const rules = gitignore
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(rules).not.toContain('public/');
    expect(rules).not.toContain('public');
  });

  it('the shell is linked from the document head', () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('/manifest.webmanifest');
  });

  it('the worker is registered from the app entry point', () => {
    expect(main).toContain('registerServiceWorker');
  });

  it('the manifest is valid JSON with a usable start_url and scope', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8')
    );
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeTruthy();
  });

  it('never serves cross-origin responses from cache (money data stays live)', () => {
    // The D1 Worker lives on another origin; caching it could show a stale
    // payment state. The handler must bail out before responding.
    expect(sw).toMatch(/url\.origin !== self\.location\.origin/);
  });

  it('only intercepts GET requests', () => {
    expect(sw).toMatch(/request\.method !== 'GET'/);
  });

  it('serves navigations network-first so a deploy is never pinned', () => {
    expect(sw).toContain('networkFirstShell');
    expect(sw).toMatch(/request\.mode === 'navigate'/);
  });

  it('treats hashed /assets/ URLs as immutable', () => {
    expect(sw).toMatch(/url\.pathname\.startsWith\('\/assets\/'\)/);
    expect(sw).toContain('cacheFirst');
  });

  it('only caches complete same-origin 200 responses', () => {
    expect(sw).toMatch(/response\.status === 200/);
    expect(sw).toMatch(/response\.type === 'basic'/);
  });

  it('cleans up caches from previous versions on activate', () => {
    expect(sw).toContain('caches.delete');
  });
});
