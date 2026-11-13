/**
 * Reusable Authentication Container Layout
 * Centers authentication forms with Apple-inspired minimalism, subtle glass treatment,
 * and backdrop motion canvas.
 */
import React from 'react';
import { motion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { MotionCanvasBackground } from '../welcome/MotionCanvasBackground';
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
    <div className="min-h-screen bg-white text-[#111111] flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden select-none">
      {/* Background Motion Visual */}
      <MotionCanvasBackground />

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
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 hover:text-black transition-colors mb-4 p-1.5 -ml-1.5 rounded-lg hover:bg-black/[0.03] cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4 text-neutral-400" />
            <span>{backLabel}</span>
          </button>
        )}

        {/* Card Frame */}
        <div className="bg-white/90 backdrop-blur-md border border-black/[0.08] shadow-xl rounded-3xl p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="space-y-1.5 text-left">
            <div className="flex items-center gap-2 mb-3">
              <XOSLogo size="sm" />
              <span className="text-xs font-bold text-neutral-400 tracking-wider uppercase">
                XOS Account
              </span>
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-[#111111]">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-neutral-500 leading-relaxed font-normal">
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
        <div className="mt-6 text-center text-xs text-neutral-400">
          <span>Protected by end-to-end user isolation & Supabase Row Level Security.</span>
        </div>
      </motion.div>
    </div>
  );
};
