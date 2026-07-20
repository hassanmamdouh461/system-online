import React, { createContext, useContext, useState, ReactNode } from 'react';

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

interface AuthContextType {
  user: User | null;
  branch: BranchSession | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<User>;
  logout: () => void;
  isAuthenticated: boolean;
}

interface StoredSession {
  user: User;
  branch: BranchSession;
}

export const BRANCH_ACCOUNTS = [
  {
    branchId: 'main_branch',
    branchName: 'الفرع الرئيسي',
    branchNameEn: 'Main Branch',
    email: 'pos@system.com',
    password: '123',
    role: 'admin' as const
  },
  {
    branchId: 'manager',
    branchName: 'الإدارة العامة',
    branchNameEn: 'General Management',
    email: 'manager@system.com',
    password: '123',
    role: 'manager' as const
  }
];

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(() => {
    try {
      const saved = localStorage.getItem(LS_SESSION_KEY) || sessionStorage.getItem(LS_SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as StoredSession;
        if (parsed.user && parsed.branch) return parsed;
      }
    } catch {}

    // Auto-detect role based on current URL path
    const hashPath = typeof window !== 'undefined' ? window.location.hash : '';
    const isManagerPath = hashPath.includes('/manager');

    if (isManagerPath) {
      return {
        user: {
          id: 'manager',
          name: 'مدير النظام',
          email: 'manager@system.com',
          role: 'manager'
        },
        branch: {
          branchId: 'manager',
          branchName: 'الإدارة العامة',
          authToken: 'token-manager'
        }
      };
    }

    // Default to Cashier POS session
    return {
      user: {
        id: 'main_branch',
        name: 'كاشير الفرع الرئيسي',
        email: 'pos@system.com',
        role: 'admin'
      },
      branch: {
        branchId: 'main_branch',
        branchName: 'الفرع الرئيسي',
        authToken: 'token-pos'
      }
    };
  });

  const login = async (email: string, password: string, rememberMe: boolean = true) => {
    await new Promise(resolve => setTimeout(resolve, 400));
    const targetEmail = email.trim().toLowerCase();
    const matchedAccount = BRANCH_ACCOUNTS.find(
      acc => (acc.email.toLowerCase() === targetEmail || targetEmail === '123') && acc.password === password
    ) || BRANCH_ACCOUNTS[0];

    const userData: User = {
      id: matchedAccount.branchId,
      name: matchedAccount.branchName,
      email: matchedAccount.email,
      role: matchedAccount.role,
    };

    const branchSession: BranchSession = {
      branchId: matchedAccount.branchId,
      branchName: matchedAccount.branchName,
      authToken: `token-${Date.now()}`,
    };

    const newSession: StoredSession = { user: userData, branch: branchSession };
    setSession(newSession);

    const storage = rememberMe ? localStorage : sessionStorage;
    storage.setItem(LS_SESSION_KEY, JSON.stringify(newSession));
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
