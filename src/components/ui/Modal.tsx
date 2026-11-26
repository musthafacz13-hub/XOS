import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { modalBackdropVariants, modalContentVariants } from '../../utils/motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  disableClose?: boolean;
  labelledById?: string;
}

const MAX_WIDTH_MAP = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl'
} as const;

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  headerExtra,
  children,
  footer,
  maxWidth = 'lg',
  disableClose = false,
  labelledById
}) => {
  const headingId = labelledById || 'xos-modal-title';

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !disableClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, disableClose, onClose]);

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
            if (!disableClose) onClose();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
        >
          <motion.div
            variants={modalContentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className={`w-full ${MAX_WIDTH_MAP[maxWidth]} bg-white rounded-t-3xl sm:rounded-2xl border-t sm:border border-black/[0.08] shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-black/[0.06] shrink-0">
              <div className="min-w-0 flex-1">
                {headerExtra}
                <h3
                  id={headingId}
                  className="text-base sm:text-lg font-semibold text-[#1d1d1f] tracking-[-0.015em]"
                >
                  {title}
                </h3>
                {subtitle && (
                  <p className="text-xs text-[#6e6e73] mt-0.5 leading-snug">
                    {subtitle}
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={disableClose}
                onClick={onClose}
                aria-label="Close dialog"
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] -mr-2 -mt-1 flex items-center justify-center rounded-xl text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3] disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5">
              {children}
            </div>

            {/* Optional Footer */}
            {footer && (
              <div className="px-5 sm:px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom,0px))] sm:pb-3.5 border-t border-black/[0.06] bg-[#fbfbfd] flex items-center justify-end gap-2 shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
