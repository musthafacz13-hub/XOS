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
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = true,
  onConfirm,
  onCancel
}) => {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onCancel();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          variants={modalBackdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={onCancel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <motion.div
            variants={modalContentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-black/[0.08] p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isDestructive ? 'bg-neutral-100 text-[#111111]' : 'bg-[#87CEEB]/20 text-[#111111]'
              }`}>
                <AlertCircle className="w-5 h-5 text-[#111111]" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 id="confirm-dialog-title" className="text-sm sm:text-base font-bold text-[#111111] tracking-tight">
                  {title}
                </h3>
                <p className="mt-1.5 text-xs text-neutral-600 leading-relaxed">
                  {message}
                </p>
              </div>
              <button
                onClick={onCancel}
                type="button"
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 active:scale-97 rounded-xl transition-all cursor-pointer min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => {
                  onConfirm();
                  onCancel();
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#111111] hover:bg-black active:scale-97 rounded-xl transition-all cursor-pointer min-h-[40px] shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#87CEEB]"
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
