import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Always rendered via portal on document.body with z-index above every modal
 * (ModalShell uses zIndex: 9000). Without this, confirm dialogs open *behind*
 * company/customer profile cards and look "missing".
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  type = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ zIndex: 100000, isolation: 'isolate' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          {/* Backdrop — click outside cancels */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            style={{ zIndex: 0 }}
            onClick={onCancel}
          />

          {/* Dialog card — always above backdrop */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            className="relative bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl text-right dir-rtl space-y-5"
            style={{ zIndex: 2 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 space-x-reverse">
                <div
                  className={`p-2.5 rounded-xl ${
                    type === 'danger'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h3 id="confirm-dialog-title" className="text-lg font-bold text-white">
                  {title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onCancel}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">{message}</p>

            <div className="flex items-center justify-end space-x-3 space-x-reverse pt-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-medium text-sm transition-colors cursor-pointer"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-lg cursor-pointer ${
                  type === 'danger'
                    ? 'bg-rose-600 hover:bg-rose-700 text-white'
                    : 'bg-amber-500 hover:bg-amber-600 text-slate-950'
                }`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
