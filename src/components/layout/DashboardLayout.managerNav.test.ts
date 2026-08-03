import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard: the manager must never be left without navigation.
 *
 * DashboardLayout used to render its three nav components only for non-managers:
 *
 *   {!isManager && <TopNav />}
 *   {!isManager && <MobileHeader />}
 *   {!isManager && <MobileNav />}
 *
 * ...where isManager was true for the manager role OR any /manager* route. On the
 * manager dashboard that looked deliberate (it has its own internal tabs), but it
 * also stripped every nav control from every OTHER page. A manager who opened
 * /orders, /payment or /settings — by direct link, or by following the
 * backup-warning banner that points at Settings — had no way back except the
 * browser's Back button. Measured during the audit: 0 visible nav elements as a
 * manager on /orders, versus a full nav bar for a cashier on the same page.
 *
 * TopNav and MobileNav already built manager-specific item lists, so the fix was
 * to stop hiding them.
 */
const layoutSrc = readFileSync(resolve(__dirname, './DashboardLayout.tsx'), 'utf8');

/**
 * Code with comments stripped. The doc comment above the component explains the
 * old `isManager` gate by quoting it, and a naive grep would count that prose as
 * a live code site.
 */
const layout = layoutSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const topNav = readFileSync(resolve(__dirname, './TopNav.tsx'), 'utf8');
const mobileNav = readFileSync(resolve(__dirname, './MobileNav.tsx'), 'utf8');

describe('navigation renders for every role', () => {
  it('no nav component is gated behind a manager check', () => {
    expect(layout).not.toMatch(/!isManager\s*&&/);
    expect(layout).not.toMatch(/isManager/);
  });

  it('all three nav components are rendered unconditionally', () => {
    expect(layout).toContain('<TopNav />');
    expect(layout).toContain('<MobileHeader />');
    expect(layout).toContain('<MobileNav />');
  });

  it('the mobile header offset is applied for every role', () => {
    // Previously branched on isManager because the header was hidden for them.
    expect(layout).toContain('pt-[68px] sm:pt-3');
  });

  it('TopNav still offers the manager a route back to his dashboard', () => {
    expect(topNav).toMatch(/role === 'manager'/);
    expect(topNav).toContain("to: '/manager-dashboard'");
  });

  it('MobileNav still offers the manager a route back to his dashboard', () => {
    expect(mobileNav).toMatch(/role === 'manager'/);
    expect(mobileNav).toContain("path: '/manager-dashboard'");
  });
});
