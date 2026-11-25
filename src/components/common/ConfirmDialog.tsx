import React, { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { modalBackdropVariants, modalContentVariants } from '../../utils/motion';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  tone?: 'default' | 'danger';
  isLoading?: boolean;
  error?: string | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = true,
  tone = 'default',
  isLoading = false,
  error = null,
  onConfirm,
  onCancel
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading) {
        onCancel();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel]);

  const isDangerTone = tone === 'danger';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          variants={modalBackdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/35 backdrop-blur-xs"
          onClick={() => {
            if (!isLoading) onCancel();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <motion.div
            variants={modalContentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border-t sm:border border-black/[0.08] p-5 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  isDangerTone
                    ? 'bg-rose-50 text-rose-600'
                    : isDestructive
                      ? 'bg-[#f5f5f7] text-[#1d1d1f]'
                      : 'bg-[#e0f2fe] text-[#0284c7]'
                }`}
              >
                <AlertCircle className="w-4.5 h-4.5" />
              </div>

              <div className="flex-1 min-w-0 pt-0.5">
                <h3
                  id="confirm-dialog-title"
                  className="text-base font-semibold text-[#1d1d1f] tracking-[-0.015em]"
                >
                  {title}
                </h3>
                <p className="mt-1.5 text-[13px] text-[#6e6e73] leading-relaxed">
                  {message}
                </p>
              </div>

              <button
                onClick={onCancel}
                disabled={isLoading}
                type="button"
                className="min-h-[40px] min-w-[40px] -mt-1.5 -mr-2 flex items-center justify-center rounded-xl text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors cursor-pointer disabled:opacity-40"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
              <button
                type="button"
                disabled={isLoading}
                onClick={onCancel}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] px-4 py-2 text-[13px] font-medium text-[#1d1d1f] bg-[#f5f5f7] hover:bg-[#e8e8ed] rounded-xl transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0284c7] disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => onConfirm()}
                className={`w-full sm:w-auto min-h-[44px] sm:min-h-[40px] px-4 py-2 text-[13px] font-medium text-white rounded-xl transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 ${
                  isDangerTone
                    ? 'bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500'
                    : 'bg-[#1d1d1f] hover:bg-black focus-visible:ring-[#0284c7]'
                }`}
              >
                {isLoading ? 'Processing…' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
