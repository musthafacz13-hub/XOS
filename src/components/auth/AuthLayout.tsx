/**
 * Reusable Authentication Container Layout
 * Centers authentication forms with Apple-inspired minimalism, subtle glass treatment,
 * and backdrop motion canvas.
 */
import React from 'react';
import { motion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { pageVariants } from '../../utils/motion';
import { XOSLogo } from '../common/XOSLogo';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({
  children,
  title,
  subtitle,
  onBack,
  backLabel = 'Back to Welcome'
}) => {
  return (
    <div className="min-h-screen min-h-[100dvh] bg-white text-[#111318] flex flex-col justify-center items-center pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:px-6 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] relative overflow-x-clip">
      {/* Main Container */}
      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative z-10 w-full max-w-md mx-auto"
      >
        {/* Back Link */}
        {onBack && (
          <button
            onClick={onBack}
            type="button"
            className="inline-flex items-center gap-1.5 min-h-[44px] text-xs font-semibold text-[#687482] hover:text-[#111318] transition-colors mb-2 px-2 -ml-2 rounded-xl hover:bg-neutral-100 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4 text-[#687482]" />
            <span>{backLabel}</span>
          </button>
        )}

        {/* Card Frame */}
        <div className="bg-white border border-neutral-200/90 shadow-sm rounded-3xl p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="space-y-1.5 text-left">
            <div className="flex items-center gap-2 mb-3">
              <XOSLogo size="sm" />
              <span className="text-xs font-bold text-[#687482] tracking-wider uppercase">
                XOS Account
              </span>
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-[#111318]">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-[#687482] leading-relaxed font-normal">
                {subtitle}
              </p>
            )}
          </div>

          {/* Form Content */}
          <div>
            {children}
          </div>
        </div>

        {/* Quiet Footnote */}
        <div className="mt-6 text-center text-xs text-[#687482]">
          <span>Protected by end-to-end user isolation &amp; Supabase Row Level Security.</span>
        </div>
      </motion.div>
    </div>
  );
};
