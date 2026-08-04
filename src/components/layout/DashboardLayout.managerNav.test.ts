import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guard for the manager's navigation, after the desktop top strip was removed
 * for that role on request (its Manager Dashboard / Inventory / Reports /
 * Settings items duplicated the dashboard's own internal tabs).
 *
 * The bug this file originally documented was the opposite and much worse: the
 * layout hid TopNav, MobileHeader AND MobileNav for the manager, so a manager who
 * landed on /orders, /payment or /settings — by direct link, or by following the
 * backup-warning banner that points at Settings — had zero navigation controls,
 * on desktop and on mobile alike.
 *
 * So the line these tests hold is narrower than "never hide anything":
 *   - only the desktop TopNav may be role-gated,
 *   - the mobile header and bottom nav must still render for every role
 *     (they are a phone's only navigation, and MobileHeader carries logout),
 *   - the manager must still have a logout control on desktop — it now lives in
 *     the manager dashboard header.
 */
const layoutSrc = readFileSync(resolve(__dirname, './DashboardLayout.tsx'), 'utf8');

/**
 * Code with comments stripped, so the prose above the component (which quotes the
 * old gate) is never mistaken for a live code site.
 */
const layout = layoutSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const topNav = readFileSync(resolve(__dirname, './TopNav.tsx'), 'utf8');
const mobileNav = readFileSync(resolve(__dirname, './MobileNav.tsx'), 'utf8');
const mobileHeader = readFileSync(resolve(__dirname, './MobileHeader.tsx'), 'utf8');
const managerDashboard = readFileSync(resolve(__dirname, '../../pages/ManagerDashboard.tsx'), 'utf8');

describe('manager navigation after removing the desktop top strip', () => {
  it('the desktop TopNav is hidden for the manager role only', () => {
    expect(layout).toMatch(/user\?\.role === 'manager'/);
    expect(layout).toContain('{!isManager && <TopNav />}');
  });

  it('the mobile header and bottom nav still render for every role', () => {
    expect(layout).toContain('<MobileHeader />');
    expect(layout).toContain('<MobileNav />');
    // Neither may be wrapped in a role check.
    expect(layout).not.toMatch(/isManager\s*&&\s*<MobileHeader/);
    expect(layout).not.toMatch(/isManager\s*&&\s*<MobileNav/);
  });

  it('the mobile header offset is applied for every role', () => {
    // Unchanged in purpose: on a phone the MobileHeader is fixed, so the content
    // below it needs a 68px clearance for EVERY role.
    //
    // What changed is WHERE the class lives. It used to sit on <main>; it moved
    // up to the wrapper that holds both <main> and CloudSessionBanner, because a
    // sibling of <main> would otherwise be rendered underneath the fixed header
    // and be invisible on exactly the device the cashier uses. The assertion
    // still fails if the clearance is dropped or role-gated.
    expect(layout).toContain('pt-[68px] sm:pt-3');
    expect(layout).not.toMatch(/isManager[^\n]*pt-\[68px\]/);
  });

  it('the cloud-session banner is outside <main>, so it cannot be scrolled away', () => {
    // The banner reports that this device has stopped saving to the cloud. If it
    // lived inside the scrolling <main> it could be scrolled out of view during
    // service, which is the whole failure it exists to prevent.
    expect(layout).toContain('<CloudSessionBanner />');
    const mainIndex = layout.indexOf('<main');
    const bannerIndex = layout.indexOf('<CloudSessionBanner />');
    expect(bannerIndex).toBeGreaterThan(-1);
    expect(bannerIndex).toBeLessThan(mainIndex);
  });

  it('the mobile header still offers logout', () => {
    expect(mobileHeader).toMatch(/logout\(\)/);
  });

  it('the manager dashboard carries a logout control for desktop', () => {
    expect(managerDashboard).toMatch(/const handleLogout = \(\) => \{/);
    expect(managerDashboard).toMatch(/onClick=\{handleLogout\}/);
  });

  it('MobileNav still offers the manager a route back to his dashboard', () => {
    expect(mobileNav).toMatch(/role === 'manager'/);
    expect(mobileNav).toContain("path: '/manager-dashboard'");
  });

  it('TopNav keeps its manager items for any future reuse', () => {
    expect(topNav).toMatch(/role === 'manager'/);
    expect(topNav).toContain("to: '/manager-dashboard'");
  });
});
