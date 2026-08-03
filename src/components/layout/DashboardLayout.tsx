import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';
import { TopNav } from './TopNav';
import { Outlet } from 'react-router-dom';

/**
 * Navigation is rendered for EVERY role.
 *
 * This layout used to hide TopNav, MobileHeader and MobileNav whenever the user
 * was a manager (or the route started with /manager). The manager dashboard has
 * its own internal tabs, so that looked fine there — but it left the manager with
 * literally zero navigation controls on every OTHER page. Landing on /orders,
 * /payment or /settings (via a direct link, or via the backup-warning banner that
 * links to Settings) trapped him with no way back except the browser's Back
 * button. Measured: 0 visible nav elements as a manager on /orders, versus a full
 * nav bar for a cashier on the same page.
 *
 * TopNav and MobileNav already build manager-specific item lists (Manager
 * Dashboard / Inventory / Reports / Settings), so showing them needs no new
 * routing — those lists were simply never rendered. Items stay role-scoped inside
 * those components, and the routes themselves stay guarded by ManagerRoute.
 */
export function DashboardLayout() {
  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* Desktop Top Navigation Bar */}
      <TopNav />

      {/* Mobile Header */}
      <MobileHeader />

      {/* Lower layout wrapper */}
      <div className="flex-grow flex overflow-hidden relative">
        {/* Main Content */}
        {/*
          pt-[68px] on mobile clears the fixed MobileHeader. The offset used to be
          branched on isManager because the header was hidden for managers; now
          that it always renders, every role needs the same clearance.
        */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 p-2 sm:p-3 lg:p-4 pb-20 sm:pb-3 md:pb-4 pt-[68px] sm:pt-3">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav />
    </div>
  );
}
