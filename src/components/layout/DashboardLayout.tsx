import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';
import { TopNav } from './TopNav';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * The desktop top strip is hidden for the manager, on the manager's request: its
 * items (Manager Dashboard / Inventory / Reports / Settings) duplicate the
 * dashboard's own internal tabs, which read as two competing navigations.
 *
 * The mobile header and the mobile bottom nav still render for every role — they
 * are the only navigation a phone has, and MobileHeader also carries the logout
 * button. On desktop the manager keeps a logout button inside the manager
 * dashboard header, so removing the strip cannot strand him in a session he
 * can't end. (A previous audit found the opposite bug: nav was hidden for the
 * manager EVERYWHERE, on mobile too, which left zero controls on /orders and
 * /settings. Only the desktop strip is dropped here.)
 */
export function DashboardLayout() {
  const { user } = useAuth();
  const isManager = user?.role === 'manager';

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* Desktop Top Navigation Bar — cashier/branch roles only */}
      {!isManager && <TopNav />}

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
