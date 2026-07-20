import React, { createContext, useContext, useState, ReactNode } from 'react';
import { getAdminCredentials } from '../utils/settingsConfig';

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
  login: (password: string) => Promise<User>;
  logout: () => void;
  isAuthenticated: boolean;
}

interface StoredSession {
  user: User;
  branch: BranchSession;
}

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

    return null;
  });

  const login = async (password: string) => {
    await new Promise(resolve => setTimeout(resolve, 400));
    
    const creds = getAdminCredentials();
    
    if (password !== creds.password) {
      throw new Error('كلمة المرور غير صحيحة');
    }

    // Determine role based on URL path
    const hashPath = typeof window !== 'undefined' ? window.location.hash : '';
    const isManagerPath = hashPath.includes('/manager');

    const userData: User = isManagerPath ? {
      id: 'manager',
      name: 'مدير النظام',
      email: 'manager@system.com',
      role: 'manager',
    } : {
      id: 'main_branch',
      name: 'كاشير الفرع الرئيسي',
      email: 'pos@system.com',
      role: 'admin',
    };

    const branchSession: BranchSession = isManagerPath ? {
      branchId: 'manager',
      branchName: 'الإدارة العامة',
      authToken: `token-${Date.now()}`,
    } : {
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
