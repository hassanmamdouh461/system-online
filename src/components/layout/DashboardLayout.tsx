import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';
import { TopNav } from './TopNav';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { CloudSessionBanner } from '../ui/CloudSessionBanner';

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

      {/*
        Everything below the fixed MobileHeader shares one clearance.
        pt-[68px] on mobile clears that header. The offset used to be branched on
        isManager because the header was hidden for managers; now that it always
        renders, every role needs the same clearance.

        It moved from <main> up to this wrapper when CloudSessionBanner was added:
        the banner is a SIBLING of <main>, so if the clearance stayed on <main>
        the banner would sit underneath the fixed header and be invisible on a
        phone — which is the one device the cashier actually uses.
      */}
      <div className="flex flex-col flex-grow overflow-hidden pt-[68px] sm:pt-3">
        {/*
          Cloud-session strip. Outside <main> so it cannot be scrolled away: when
          the 12h Worker cookie lapses this device silently stops saving to the
          cloud, and that must stay on screen for the rest of the shift rather
          than flash past as a toast. Renders nothing while the session is
          healthy and online.
        */}
        <CloudSessionBanner />

        {/* Lower layout wrapper */}
        <div className="flex-grow flex overflow-hidden relative">
          {/* Main Content */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 p-2 sm:p-3 lg:p-4 pb-20 sm:pb-3 md:pb-4">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav />
    </div>
  );
}
