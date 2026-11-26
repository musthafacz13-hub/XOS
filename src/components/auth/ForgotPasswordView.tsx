/**
 * XOS Forgot Password View
 * Dispatches password recovery instructions via Supabase Auth without exposing
 * account registration existence (prevents account-enumeration attacks).
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, KeyRound, Loader2, ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';
import { tapScale } from '../../utils/motion';
import { validateEmailAddress, normalizeAuthEmail } from '../../utils/authValidation';
import { INPUT_CLASS, LABEL_CLASS, ACCENT_BUTTON_CLASS, SUBTLE_BUTTON_CLASS } from '../ui/FormControls';

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
          <div className="w-12 h-12 rounded-2xl bg-[#e8f2ff] text-[#0071e3] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-base text-[#1d1d1f]">
              Recovery instructions dispatched
            </h3>
            <p className="text-xs text-[#6e6e73] leading-relaxed font-normal">
              If an account is associated with this email, you will receive password reset instructions shortly:
            </p>
            <p className="text-xs font-mono font-semibold text-[#1d1d1f] bg-[#f5f5f7] py-1.5 px-3 rounded-lg inline-block break-all max-w-full">
              {submittedEmail}
            </p>
          </div>

          <div className="p-3.5 bg-[#f5f5f7] rounded-xl text-left text-xs text-[#6e6e73] leading-relaxed space-y-1">
            <span className="font-semibold text-[#1d1d1f] block">Security Note:</span>
            <p>The reset link will expire in 1 hour.</p>
            <p>For your security, you will be required to confirm your new password twice.</p>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="button"
              disabled={loading || cooldownSeconds > 0}
              onClick={handleResetRequest}
              className={`${SUBTLE_BUTTON_CLASS} w-full min-h-[44px] text-xs`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                {cooldownSeconds > 0 ? `Resend email in ${cooldownSeconds}s` : 'Resend Recovery Email'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="min-h-[44px] text-xs text-[#6e6e73] hover:text-[#1d1d1f] transition-colors font-medium cursor-pointer flex items-center justify-center w-full py-2 rounded-xl"
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
              className="p-3 bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs rounded-xl flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-[#c92a2a] mt-0.5 shrink-0" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {!isConfigured && (
            <div className="p-3 bg-[#f5f5f7] rounded-xl text-xs text-[#6e6e73] space-y-1">
              <span className="font-semibold text-[#1d1d1f] block">Supabase Connection Pending</span>
              <p className="text-[11px] leading-relaxed">
                Password recovery requires configured Supabase credentials in your environment.
              </p>
            </div>
          )}

          <div className="text-left">
            <label htmlFor="recovery-email" className={LABEL_CLASS}>
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
              className={`${INPUT_CLASS} min-h-[44px]`}
            />
          </div>

          <motion.button
            whileTap={tapScale.button}
            type="submit"
            disabled={loading}
            className={`${ACCENT_BUTTON_CLASS} w-full min-h-[48px] text-sm font-semibold`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Sending Instructions...</span>
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                <span>Send Password Reset Link</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </motion.button>

          <div className="pt-3 text-center text-xs text-[#6e6e73] border-t border-black/[0.06]">
            <span>Remembered your password? </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => onNavigate('login')}
              className="font-semibold text-[#0071e3] hover:text-[#0077ed] hover:underline cursor-pointer disabled:opacity-50"
            >
              Back to Login
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};
