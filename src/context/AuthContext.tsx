import { createContext, useContext, useState, ReactNode } from 'react';
import { verifyAdminCredentials, verifyManagerCredentials } from '../utils/settingsConfig';
import {
  setSessionCredential,
  ensureCloudSession,
  clearCloudSession,
  getSessionRole,
  isCloudConfigured,
  getLastSessionMintOutcome,
} from '../services/cloudConfig';
import { clearRefundPin } from '../utils/refundPin';

/**
 * Turn a failed login into a message that describes what actually went wrong.
 *
 * Every failure used to surface as "كلمة المرور غير صحيحة". That is a lie for
 * most of them: a cashier locked out by the Worker's per-IP rate limit (429), or
 * hitting a Worker with no SESSION_SECRET (503), or with the network down, was
 * told his password was wrong. During the busy hour he would then try other
 * passwords and reset the credential — and each extra attempt extended the
 * lockout, when all he had to do was wait a minute.
 *
 * Only a genuine refusal, or a purely local failure with no cloud attempt behind
 * it, may claim the password is wrong.
 */
function describeLoginFailure(): string {
  const outcome = getLastSessionMintOutcome();
  switch (outcome.kind) {
    case 'rate_limited':
      return 'محاولات كتير أوي — استنى دقيقة وجرّب تاني (الباسورد ممكن يكون صح)';
    case 'server_misconfigured':
      return 'السيرفر مش مظبوط (SESSION_SECRET ناقص) — كلّم الدعم الفني';
    case 'server_error':
      return `السيرفر بيرجّع خطأ (${outcome.status}) — جرّب بعد شوية أو كلّم الدعم`;
    case 'unreachable':
      return 'مفيش اتصال بالسيرفر — لو الباسورد صح جرّب تاني لما النت يرجع';
    case 'rejected':
    case 'ok':
    case 'no_attempt':
    default:
      return 'كلمة المرور غير صحيحة';
  }
}

const LS_SESSION_KEY = 'auth_session_system_online';

export interface BranchSession {
  branchId: string;
  branchName: string;
  authToken: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff' | 'manager';
}

export type LoginRole = 'admin' | 'manager';

interface AuthContextType {
  user: User | null;
  branch: BranchSession | null;
  /** Pass role explicitly — preferred over URL heuristics */
  login: (password: string, role?: LoginRole) => Promise<User>;
  logout: () => void;
  isAuthenticated: boolean;
}

interface StoredSession {
  user: User;
  branch: BranchSession;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function resolveManagerIntent(explicitRole?: LoginRole): boolean {
  if (explicitRole === 'manager') return true;
  if (explicitRole === 'admin') return false;

  // Fallback for direct /manager-login or ?role=manager
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname || '';
  const search = window.location.search || '';
  const hash = window.location.hash || '';
  const hashPath = hash.startsWith('#') ? hash.slice(1) : hash;
  const [hashRoute, hashQuery = ''] = hashPath.split('?');
  const query = new URLSearchParams(search || hashQuery);
  const roleParam = query.get('role');

  return (
    roleParam === 'manager' ||
    path.includes('/manager-login') ||
    path.includes('/manager') ||
    hashRoute.includes('/manager')
  );
}


export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(() => {
    try {
      const saved = localStorage.getItem(LS_SESSION_KEY) || sessionStorage.getItem(LS_SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as StoredSession;
        if (parsed.user && parsed.branch) return parsed;
      }
    } catch {}
    return null;
  });

  const login = async (password: string, role?: LoginRole) => {
    await new Promise(resolve => setTimeout(resolve, 400));

    const isManager = resolveManagerIntent(role);

    let isValid = isManager
      ? await verifyManagerCredentials('manager', password)
      : await verifyAdminCredentials('admin', password);

    // Server-authoritative fallback. Client-side verification reads the credential
    // hash from local/cloud settings, but a cashier session is (correctly) no
    // longer allowed to read the MANAGER credential row from the Worker — so on a
    // shared or fresh till the local check can fail for a perfectly valid manager
    // password. The Worker verifies the password directly against the D1 hashes and
    // mints a role-bearing session, so a server role that matches the login intent
    // is authoritative. Both sides use the same KDF (PBKDF2-100k), so they never
    // disagree on a password that is actually correct.
    if (!isValid && isCloudConfigured()) {
      setSessionCredential(password);
      const minted = await ensureCloudSession(true);
      const serverRole = getSessionRole();
      if (minted && ((isManager && serverRole === 'manager') || (!isManager && serverRole === 'cashier'))) {
        isValid = true;
      } else {
        // Wrong password, or the OTHER role's password typed on this screen: drop
        // any session the mint attempt may have established so we fail cleanly.
        void clearCloudSession();
      }
    }

    if (!isValid) {
      // Distinguish the cause instead of always blaming the password. A mint that
      // SUCCEEDED but returned the other role (cashier password typed on the
      // manager screen) still reports "wrong password", which is correct: the
      // outcome is 'ok' and only the role match failed.
      throw new Error(describeLoginFailure());
    }

    const userData: User = isManager
      ? {
          id: 'manager',
          name: 'مدير النظام',
          email: 'manager@system.com',
          role: 'manager',
        }
      : {
          id: 'main_branch',
          name: 'كاشير الفرع الرئيسي',
          email: 'pos@system.com',
          role: 'admin',
        };

    const branchSession: BranchSession = isManager
      ? {
          branchId: 'manager',
          branchName: 'الإدارة العامة',
          authToken: `token-${Date.now()}`,
        }
      : {
          branchId: 'main_branch',
          branchName: 'الفرع الرئيسي',
          authToken: `token-${Date.now()}`,
        };

    const newSession: StoredSession = { user: userData, branch: branchSession };
    setSession(newSession);
    localStorage.setItem(LS_SESSION_KEY, JSON.stringify(newSession));

    // Establish a role-bearing cloud session by handing the Worker the same
    // password we just verified. The Worker re-verifies it against the stored
    // credential hashes and bakes the resulting role into the signed cookie, so
    // cloud writes are authorized as this operator's real role — not anonymously.
    // Await the mint and confirm the role matches the login intent: a stale
    // cashier cookie must never survive a manager login (it would 403 every
    // manager-only setting write, e.g. the tax rate).
    setSessionCredential(password);
    const minted = await ensureCloudSession(true);
    const cloudRole = getSessionRole();
    if (minted && isManager && cloudRole !== 'manager') {
      console.warn('[auth] manager login but cloud session role is', cloudRole, '— dropping mismatched session');
      void clearCloudSession();
    }

    return userData;
  };

  const logout = () => {
    setSession(null);
    localStorage.removeItem(LS_SESSION_KEY);
    sessionStorage.removeItem(LS_SESSION_KEY);
    // Drop any held refund escalation PIN — a till is a shared device, and the
    // next operator must not inherit this operator's refund authority.
    clearRefundPin();
    // Drop the server session cookie + in-memory credential.
    void clearCloudSession();
  };

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        branch: session?.branch ?? null,
        login,
        logout,
        isAuthenticated: !!session,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
