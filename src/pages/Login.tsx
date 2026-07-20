import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Coffee, ArrowRight, Lock, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const LS_KEY = 'brewmaster_remembered_email';

export default function Login() {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const { login } = useAuth();
  const navigate  = useNavigate();
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  // ── On mount: restore saved email if "Remember Me" was checked before ──
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      setEmail(saved);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!email || !password) throw new Error('Please fill in all fields');
      // rememberMe is passed to AuthContext — localStorage handled there
      const loggedUser = await login(email, password, rememberMe);
      if (loggedUser.role === 'manager') {
        navigate('/manager-dashboard');
      } else {
        navigate('/orders');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* ── Animations + Custom Checkbox styles ───────────────────────────── */}
      <style>{`
        @keyframes float2d {
          0%,  100% { transform: translateY(0px);  }
          50%        { transform: translateY(-7px); }
        }
        .icon-float {
          animation: float2d 3s ease-in-out infinite;
          will-change: transform;
        }
        .cb-caramel {
          appearance: none;
          -webkit-appearance: none;
          width: 1rem;
          height: 1rem;
          border: 1.5px solid #6b7280;
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
          position: relative;
          flex-shrink: 0;
          transition: border-color 0.2s, background 0.2s;
        }
        .cb-caramel:checked {
          background: #c8956c;
          border-color: #c8956c;
        }
        .cb-caramel:checked::after {
          content: '';
          position: absolute;
          left: 3px;
          top: 0px;
          width: 5px;
          height: 9px;
          border: 2px solid #fff;
          border-top: none;
          border-left: none;
          transform: rotate(45deg);
        }
        .cb-caramel:focus {
          outline: none;
          box-shadow: 0 0 0 2px rgba(200,149,108,0.35);
        }
      `}</style>

      <div className="min-h-screen flex items-center justify-center bg-gray-900 relative overflow-hidden">
        {/* Abstract Background Shapes */}
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-caramel/20 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-mocha-700/10 rounded-full blur-[100px]" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="bg-white/10 backdrop-blur-lg border border-white/20 p-8 rounded-2xl w-full max-w-md shadow-2xl relative z-10"
        >
          {/* ── Icon + heading ─────────────────────────────────────────────── */}
          <div className="flex flex-col items-center mb-8 text-center">
            <div className="relative mb-4 icon-float">
              <div className="absolute inset-0 rounded-full bg-caramel/40 blur-xl scale-150" />
              <div className="relative bg-gradient-to-br from-caramel to-mocha-600 p-3 rounded-full shadow-lg shadow-caramel/40">
                <Coffee className="w-8 h-8 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">
              {isElectron ? "Branch Login / دخول الفرع" : "Manager Portal / بوابة الإدارة"}
            </h1>
            <p className="text-gray-400 text-sm">
              {isElectron 
                ? "Sign in to your local branch cashier / سجل دخول الفرع" 
                : "Sign in to the central manager website / دخول موقع المدير"}
            </p>
          </div>

          {/* ── Form ───────────────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div className="space-y-2">
              <label className="text-gray-300 text-xs uppercase tracking-wider font-semibold ml-1">Email</label>
              <div className="relative group">
                <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400 group-focus-within:text-caramel transition-colors" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:border-caramel focus:ring-1 focus:ring-caramel transition-all placeholder-gray-500"
                  placeholder={isElectron ? "branch1@system.com" : "manager@system.com"}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="text-gray-300 text-xs uppercase tracking-wider font-semibold ml-1">Password</label>
              <div className="relative group">
                <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400 group-focus-within:text-caramel transition-colors" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:border-caramel focus:ring-1 focus:ring-caramel transition-all placeholder-gray-500"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {/* ── Remember Me ──────────────────────────────────────────────── */}
            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="cb-caramel"
              />
              <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                Remember me
              </span>
            </label>

            {/* Error */}
            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-red-400 text-sm text-center bg-red-500/10 py-2 px-3 rounded-lg"
              >
                {error}
              </motion.p>
            )}

            {/* Submit */}
            <motion.button
              whileHover={loading ? {} : { scale: 1.02 }}
              whileTap={loading ? {} : { scale: 0.98 }}
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-caramel to-mocha-600 text-white py-3 rounded-xl font-semibold shadow-lg shadow-caramel/20 flex items-center justify-center gap-2 hover:shadow-caramel/40 transition-shadow disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>Sign In <ArrowRight className="w-5 h-5" /></>
              )}
            </motion.button>

            {/* Quick Demo Accounts Selector */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <p className="text-gray-400 text-xs font-semibold mb-3 tracking-wide text-center uppercase">
                Quick Demo Login / دخول سريع للتجربة
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!isElectron}
                  onClick={() => {
                    setEmail('branch1@system.com');
                    setPassword('123');
                  }}
                  className={`border border-white/10 rounded-lg p-2 text-xs transition-colors flex flex-col items-center justify-center text-center ${
                    isElectron 
                      ? 'bg-white/5 hover:bg-white/10 text-white' 
                      : 'bg-white/5 text-gray-500 opacity-40 cursor-not-allowed'
                  }`}
                  title={isElectron ? "Click to auto-fill" : "Desktop POS app only"}
                >
                  <span className="font-bold text-caramel">فرع المعادي (1)</span>
                  <span className="text-[9px] text-gray-400">branch1@system.com</span>
                  {!isElectron && <span className="text-[8px] text-red-400 font-bold mt-0.5">(تطبيق الكمبيوتر فقط)</span>}
                </button>
                <button
                  type="button"
                  disabled={!isElectron}
                  onClick={() => {
                    setEmail('branch2@system.com');
                    setPassword('123');
                  }}
                  className={`border border-white/10 rounded-lg p-2 text-xs transition-colors flex flex-col items-center justify-center text-center ${
                    isElectron 
                      ? 'bg-white/5 hover:bg-white/10 text-white' 
                      : 'bg-white/5 text-gray-500 opacity-40 cursor-not-allowed'
                  }`}
                  title={isElectron ? "Click to auto-fill" : "Desktop POS app only"}
                >
                  <span className="font-bold text-caramel">فرع مصر الجديدة (2)</span>
                  <span className="text-[9px] text-gray-400">branch2@system.com</span>
                  {!isElectron && <span className="text-[8px] text-red-400 font-bold mt-0.5">(تطبيق الكمبيوتر فقط)</span>}
                </button>
                <button
                  type="button"
                  disabled={!isElectron}
                  onClick={() => {
                    setEmail('branch3@system.com');
                    setPassword('123');
                  }}
                  className={`border border-white/10 rounded-lg p-2 text-xs transition-colors flex flex-col items-center justify-center text-center ${
                    isElectron 
                      ? 'bg-white/5 hover:bg-white/10 text-white' 
                      : 'bg-white/5 text-gray-500 opacity-40 cursor-not-allowed'
                  }`}
                  title={isElectron ? "Click to auto-fill" : "Desktop POS app only"}
                >
                  <span className="font-bold text-caramel">فرع الزمالك (3)</span>
                  <span className="text-[9px] text-gray-400">branch3@system.com</span>
                  {!isElectron && <span className="text-[8px] text-red-400 font-bold mt-0.5">(تطبيق الكمبيوتر فقط)</span>}
                </button>
                <button
                  type="button"
                  disabled={isElectron}
                  onClick={() => {
                    setEmail('manager@system.com');
                    setPassword('123');
                  }}
                  className={`border rounded-lg p-2 text-xs transition-colors flex flex-col items-center justify-center text-center col-span-2 ${
                    !isElectron 
                      ? 'bg-mocha-600/30 hover:bg-mocha-600/50 text-white border-mocha-500/30' 
                      : 'bg-white/5 text-gray-500 border-white/10 opacity-40 cursor-not-allowed'
                  }`}
                  title={!isElectron ? "Click to auto-fill" : "Management Web Portal only"}
                >
                  <span className="font-bold text-amber-300">المدير العام (التقارير أونلاين)</span>
                  <span className="text-[9px] text-gray-300">manager@system.com</span>
                  {isElectron && <span className="text-[8px] text-red-400 font-bold mt-0.5">(موقع الويب فقط / Web Only)</span>}
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    </>
  );
}
