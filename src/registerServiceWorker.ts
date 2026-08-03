/**
 * Service-worker registration for the offline app shell.
 *
 * The DATA layer was already offline-capable (IndexedDB survives a dropped line),
 * but the app SHELL was not: with no service worker, a full page load with the
 * network down failed outright (net::ERR_INTERNET_DISCONNECTED) and the POS was
 * gone. Offline therefore only held as long as nobody refreshed the tab — and
 * pressing F5 is the first thing anyone does when a screen looks stuck.
 *
 * Registration is deliberately fire-and-forget and never throws: a POS must still
 * boot on a browser with service workers unavailable or blocked (private mode,
 * locked-down kiosk, insecure origin). See public/sw.js for the caching policy.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  // Service workers require a secure context. localhost counts as secure, so dev
  // still exercises this path.
  if (!window.isSecureContext) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // A newly deployed worker would otherwise idle in "waiting" until every
        // tab closes — on a till that stays open for weeks, that is never. Tell it
        // to take over as soon as it is installed; sw.js keeps navigations
        // network-first, so an activated update cannot pin the till to an old
        // build.
        registration.addEventListener('updatefound', () => {
          const incoming = registration.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', () => {
            if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
              incoming.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch((err) => {
        // Non-fatal by design: the app works, it just is not offline-resilient.
        console.warn('[pwa] service worker registration failed:', err);
      });
  });
}
