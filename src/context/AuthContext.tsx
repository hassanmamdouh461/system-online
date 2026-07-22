import React, { createContext, useContext, useState, ReactNode } from 'react';
import { verifyAdminCredentials } from '../utils/settingsConfig';

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

    const isValid = await verifyAdminCredentials('admin', password);
    if (!isValid) {
      throw new Error('كلمة المرور غير صحيحة');
    }

    const isManager = resolveManagerIntent(role);

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
    return userData;
  };

  const logout = () => {
    setSession(null);
    localStorage.removeItem(LS_SESSION_KEY);
    sessionStorage.removeItem(LS_SESSION_KEY);
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
