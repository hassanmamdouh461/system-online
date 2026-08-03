import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard: no operator-facing screen may use window.alert().
 *
 * WHY THIS GUARD EXISTS
 * The POS ran its entire error and validation vocabulary through alert(). That
 * has three concrete consequences on a till:
 *
 *   1. alert() blocks the JS event loop. While the dialog is open the app cannot
 *      paint, cannot finish an in-flight sync, and cannot process the barcode
 *      scanner or card-reader callbacks — so a validation message silently froze
 *      the terminal until a human dismissed it.
 *   2. On a kiosk browser in fullscreen/PWA mode the native dialog can be
 *      suppressed entirely by the platform. The message then reaches nobody: the
 *      cashier sees a dead button, retries, and the same guard rejects again with
 *      no explanation on screen.
 *   3. It is not translatable chrome and ignores the RTL layout, so an Arabic
 *      message rendered in a browser-styled LTR box.
 *
 * The app already ships a non-blocking, RTL-aware Toast system (ToastProvider is
 * mounted in App.tsx). These screens now use it.
 *
 * These files touch IndexedDB and browser APIs at import time, so — following the
 * convention in IndexedDbOrderRepository.updatedAt.test.ts — this guard asserts
 * on the module source rather than importing the modules.
 */

/** Files that talk to the operator and must therefore stay alert()-free. */
const GUARDED = [
  'components/orders/POSView.tsx',
  'components/payment/PaymentModal.tsx',
  'pages/ManagerDashboard.tsx',
  // pages/Orders.tsx was guarded here while it owned the kitchen board's
  // cancel/advance dialogs. That board was removed on the operator's request,
  // leaving the page a thin wrapper that renders POSView (guarded above) and
  // nothing else — it no longer speaks to the operator, so it has no Toast to
  // wire up and no dialog to police.
  'pages/Payment.tsx',
];

/**
 * Strip comments before asserting, so a comment that merely *mentions* alert()
 * cannot satisfy — or break — the assertion. Several of these files legitimately
 * discuss the removed alert() in prose (MenuModal.tsx does too), and without this
 * step the guard would be testing documentation instead of code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function code(relative: string): string {
  return stripComments(readFileSync(resolve(__dirname, relative), 'utf8'));
}

describe('operator screens do not use blocking window.alert()', () => {
  for (const file of GUARDED) {
    it(`${file} contains no alert() call`, () => {
      // Matches `alert(`, `window.alert(` and `globalThis.alert(`, but not
      // identifiers that merely end in "alert" (e.g. showAlert, AlertTriangle).
      expect(code(file)).not.toMatch(/(?:^|[^.\w])(?:(?:window|globalThis)\.)?alert\s*\(/m);
    });
  }

  it('every guarded screen wires up the Toast system instead', () => {
    for (const file of GUARDED) {
      expect(code(file), `${file} imports useToast`).toMatch(/useToast/);
    }
  });

  it('the guard would actually catch a reintroduced alert', () => {
    // Proves the pattern is not vacuously passing.
    const pattern = /(?:^|[^.\w])(?:(?:window|globalThis)\.)?alert\s*\(/m;
    expect(stripComments("  alert('boom');")).toMatch(pattern);
    expect(stripComments('  window.alert("boom");')).toMatch(pattern);
    expect(stripComments("  // alert('boom');")).not.toMatch(pattern);
    expect(stripComments('  showAlert("ok");')).not.toMatch(pattern);
  });
});
