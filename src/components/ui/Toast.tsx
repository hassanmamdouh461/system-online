import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, title?: string) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  /**
   * "It half-worked, and you need to know." Used for outcomes that are neither a
   * clean success nor a failure — e.g. a delete applied locally whose tombstone
   * has not been confirmed by the cloud yet. `warning` was already in ToastType
   * but had no helper, no icon and no colour, so callers with genuinely amber
   * news had to pick between a green success (which hid the problem) and a red
   * error (which claimed nothing happened).
   */
  warning: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', title?: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastMessage = { id, type, message, title };
    setToasts(prev => [...prev.slice(-4), newToast]); // Limit to max 5 visible toasts

    // Warnings carry an instruction the operator has to act on ("don't clear
    // browser data before this syncs"), and they are longer than a one-line
    // success, so 4s is not enough time to read one.
    setTimeout(() => {
      removeToast(id);
    }, type === 'warning' ? 10000 : 4000);
  }, [removeToast]);

  const success = useCallback((msg: string, title?: string) => showToast(msg, 'success', title), [showToast]);
  const error = useCallback((msg: string, title?: string) => showToast(msg, 'error', title), [showToast]);
  const info = useCallback((msg: string, title?: string) => showToast(msg, 'info', title), [showToast]);
  const warning = useCallback((msg: string, title?: string) => showToast(msg, 'warning', title), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-3 max-w-sm w-full pointer-events-none p-4">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl shadow-2xl border backdrop-blur-md ${
                toast.type === 'success'
                  ? 'bg-slate-900/90 text-emerald-300 border-emerald-500/40'
                  : toast.type === 'error'
                  ? 'bg-slate-900/90 text-rose-300 border-rose-500/40'
                  : toast.type === 'warning'
                  ? 'bg-slate-900/90 text-amber-300 border-amber-500/40'
                  : 'bg-slate-900/90 text-cyan-300 border-cyan-500/40'
              }`}
            >
              <div className="shrink-0 mt-0.5">
                {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400" />}
                {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400" />}
                {toast.type === 'info' && <Info className="w-5 h-5 text-cyan-400" />}
              </div>
              <div className="flex-1 min-w-0 text-start">
                {toast.title && <h4 className="text-sm font-semibold text-white mb-0.5">{toast.title}</h4>}
                <p className="text-xs text-slate-200 leading-relaxed">{toast.message}</p>
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="shrink-0 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback if rendered outside provider
    return {
      showToast: (msg: string) => console.log('[Toast]:', msg),
      success: (msg: string) => console.log('[Toast Success]:', msg),
      error: (msg: string) => console.error('[Toast Error]:', msg),
      info: (msg: string) => console.log('[Toast Info]:', msg),
      warning: (msg: string) => console.warn('[Toast Warning]:', msg),
    };
  }
  return ctx;
}
