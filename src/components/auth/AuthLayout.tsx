/**
 * Reusable Authentication Container Layout
 * Centers authentication forms with Apple-inspired minimalism, crisp grouped geometry,
 * blur-to-sharp title reveal, and subtle backdrop motion canvas.
 */
import React from 'react';
import { motion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { pageVariants } from '../../utils/motion';
import { XOSLogo } from '../common/XOSLogo';
import { BlurText } from '../ui/BlurText';

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
    <div className="min-h-screen min-h-[100dvh] bg-[#f5f5f7] text-[#1d1d1f] flex flex-col justify-center items-center pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] sm:px-6 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] relative overflow-x-clip">
      {/* Main Container */}
      <motion.main
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative z-10 w-full max-w-[440px] mx-auto"
      >
        {/* Back Link */}
        {onBack && (
          <button
            onClick={onBack}
            type="button"
            className="inline-flex items-center gap-1.5 min-h-[44px] text-xs font-medium text-[#6e6e73] hover:text-[#1d1d1f] transition-colors mb-2.5 px-2.5 -ml-2.5 rounded-xl hover:bg-black/[0.04] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
          >
            <ChevronLeft className="w-4 h-4 text-[#6e6e73]" />
            <span>{backLabel}</span>
          </button>
        )}

        {/* Card Frame */}
        <div className="bg-white border border-black/[0.08] shadow-[0_8px_30px_rgba(0,0,0,0.04)] rounded-3xl p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="space-y-1.5 text-left">
            <div className="flex items-center gap-2.5 mb-3">
              <XOSLogo size="sm" />
              <span className="text-xs font-medium text-[#6e6e73]">
                XOS Account
              </span>
            </div>

            <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-[#1d1d1f] leading-tight">
              <BlurText as="span" blurPx={6} distance={8} className="inline-block">
                {title}
              </BlurText>
            </h1>
            {subtitle && (
              <p className="text-[13px] text-[#6e6e73] leading-relaxed font-normal">
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
        <footer className="mt-6 text-center text-xs text-[#86868b]">
          <span>Protected by end-to-end user isolation &amp; Supabase Row Level Security.</span>
        </footer>
      </motion.main>
    </div>
  );
};
