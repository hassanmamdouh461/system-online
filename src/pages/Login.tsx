import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Coffee, ArrowRight, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [password, setPassword]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const { login } = useAuth();
  const navigate  = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!password) throw new Error('من فضلك ادخل كلمة المرور');
      const loggedUser = await login(password);
      if (loggedUser.role === 'manager') {
        navigate('/manager-dashboard');
      } else {
        navigate('/orders');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'كلمة المرور غير صحيحة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* ── Animations ───────────────────────────── */}
      <style>{`
        @keyframes float2d {
          0%,  100% { transform: translateY(0px);  }
          50%        { transform: translateY(-7px); }
        }
        .icon-float {
          animation: float2d 3s ease-in-out infinite;
          will-change: transform;
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
          className="bg-white/10 backdrop-blur-lg border border-white/20 p-8 rounded-2xl w-full max-w-sm tablet:max-w-md shadow-2xl relative z-10"
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
              BrewMaster POS
            </h1>
            <p className="text-gray-400 text-sm">
              ادخل كلمة المرور لتسجيل الدخول
            </p>
          </div>

          {/* ── Form ───────────────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Password */}
            <div className="space-y-2">
              <label className="text-gray-300 text-xs uppercase tracking-wider font-semibold ml-1">كلمة المرور / Password</label>
              <div className="relative group">
                <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400 group-focus-within:text-caramel transition-colors" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 text-white pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:border-caramel focus:ring-1 focus:ring-caramel transition-all placeholder-gray-500 text-lg tracking-widest"
                  placeholder="••••••••"
                  autoFocus
                />
              </div>
            </div>

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
              className="w-full bg-gradient-to-r from-caramel to-mocha-600 text-white py-3 rounded-xl font-semibold shadow-lg shadow-caramel/20 flex items-center justify-center gap-2 hover:shadow-caramel/40 transition-shadow disabled:opacity-70 disabled:cursor-not-allowed text-lg"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>دخول <ArrowRight className="w-5 h-5" /></>
              )}
            </motion.button>
          </form>
        </motion.div>
      </div>
    </>
  );
}
