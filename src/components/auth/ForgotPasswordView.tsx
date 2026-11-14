/**
 * XOS Forgot Password View
 * Dispatches password recovery instructions via Supabase Auth without exposing
 * account registration existence (prevents account-enumeration attacks).
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { KeyRound, Loader2, ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';
import { tapScale } from '../../utils/motion';
import { validateEmailAddress, normalizeAuthEmail } from '../../utils/authValidation';

interface ForgotPasswordViewProps {
  onNavigate: (view: 'login' | 'signup') => void;
}

export const ForgotPasswordView: React.FC<ForgotPasswordViewProps> = ({ onNavigate }) => {
  const { requestPasswordReset, isConfigured } = useAuth();

  const [email, setEmail] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const mountedRef = useRef(true);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCooldownSeconds(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading || cooldownSeconds > 0) return;

    setErrorMessage(null);

    const validationError = validateEmailAddress(email);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const cleanEmail = normalizeAuthEmail(email);
    isSubmittingRef.current = true;
    setLoading(true);

    try {
      const { error } = await requestPasswordReset(cleanEmail);
      if (!mountedRef.current) return;

      // Preserve anti-enumeration for nonexistent accounts, while surfacing connectivity/config/rate errors
      const isOperationalError = Boolean(
        error &&
        (error.includes('credentials') ||
          error.includes('timed out') ||
          error.includes('interrupted') ||
          error.includes('Network connection') ||
          error.includes('Too many attempts'))
      );

      if (isOperationalError && error) {
        setErrorMessage(error);
      } else {
        setSubmittedEmail(cleanEmail);
        setSubmitted(true);
        setCooldownSeconds(60);
      }
    } finally {
      isSubmittingRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link to choose a new password."
      onBack={() => onNavigate('login')}
      backLabel="Back to Login"
    >
      {submitted ? (
        <div className="space-y-5 text-center py-2">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto border border-sky-100 shadow-xs">
            <CheckCircle2 className="w-6 h-6 text-[#87CEEB]" />
          </div>

          <div className="space-y-1.5">
            <h3 className="font-bold text-base text-[#111111]">
              Recovery instructions dispatched
            </h3>
            <p className="text-xs text-neutral-600 leading-relaxed font-normal">
              If an account is associated with this email, you will receive password reset instructions shortly:
            </p>
            <p className="text-xs font-mono font-semibold text-[#111111] bg-neutral-50 py-1.5 px-3 rounded-lg border border-neutral-200 inline-block break-all max-w-full">
              {submittedEmail}
            </p>
          </div>

          <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-left text-xs text-neutral-500 leading-relaxed space-y-1">
            <span className="font-semibold text-neutral-800 block">Security Note:</span>
            <p>• The reset link will expire in 1 hour.</p>
            <p>• For your security, you will be required to confirm your new password twice.</p>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="button"
              disabled={loading || cooldownSeconds > 0}
              onClick={handleResetRequest}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold rounded-xl border border-neutral-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                {cooldownSeconds > 0 ? `Resend email in ${cooldownSeconds}s` : 'Resend Recovery Email'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="min-h-[44px] text-xs text-neutral-500 hover:text-black transition-colors font-medium cursor-pointer flex items-center justify-center w-full py-2 rounded-xl"
            >
              Return to Login
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleResetRequest} className="space-y-4" noValidate>
          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {!isConfigured && (
            <div className="p-3 bg-neutral-100 rounded-xl border border-neutral-200 text-xs text-neutral-600 space-y-1">
              <span className="font-semibold text-neutral-900 block">Supabase Connection Pending</span>
              <p className="text-[11px] leading-relaxed">
                Password recovery requires configured Supabase credentials in your environment.
              </p>
            </div>
          )}

          <div className="space-y-1.5 text-left">
            <label htmlFor="recovery-email" className="block text-xs font-semibold text-neutral-700">
              Email address
            </label>
            <input
              id="recovery-email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              autoComplete="email"
              disabled={loading}
              placeholder="name@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              className="w-full min-h-[44px] px-3.5 py-2.5 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] transition-all disabled:opacity-60"
            />
          </div>

          <motion.button
            whileTap={tapScale.button}
            type="submit"
            disabled={loading}
            className="w-full min-h-[48px] flex items-center justify-center gap-2 py-3 bg-[#111318] text-white text-sm font-semibold rounded-xl hover:bg-black transition-colors shadow-sm disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#87CEEB]" />
                <span>Sending Instructions...</span>
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4 text-[#87CEEB]" />
                <span>Send Password Reset Link</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </>
            )}
          </motion.button>

          <div className="pt-2 text-center text-xs text-neutral-500 border-t border-black/[0.04]">
            <span>Remembered your password? </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => onNavigate('login')}
              className="font-semibold text-[#111111] hover:underline cursor-pointer disabled:opacity-50"
            >
              Back to Login
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};
