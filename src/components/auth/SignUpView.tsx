/**
 * XOS Sign Up View
 * Supports Google OAuth registration and manual email/password registration with
 * validation and email verification handling.
 */
import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Eye, EyeOff, Loader2, ArrowRight, Check, CheckCircle2 } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { GoogleAuthButton } from './GoogleAuthButton';
import { useAuth } from '../../context/AuthContext';
import { tapScale } from '../../utils/motion';
import { validateSignUpInputs, normalizeAuthEmail } from '../../utils/authValidation';
import { INPUT_CLASS, LABEL_CLASS, ACCENT_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../ui/FormControls';

interface SignUpViewProps {
  onNavigate: (view: 'welcome' | 'login' | 'verify-email' | 'magic-link') => void;
  onSuccess: () => void;
  onSetRegisteredEmail: (email: string) => void;
}

export const SignUpView: React.FC<SignUpViewProps> = ({
  onNavigate,
  onSuccess,
  onSetRegisteredEmail
}) => {
  const { signUpWithEmail, loginWithGoogle, isConfigured } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const isSubmittingRef = useRef(false);

  const isBusy = loading || googleLoading;

  useEffect(() => {
    mountedRef.current = true;
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && mountedRef.current) {
        isSubmittingRef.current = false;
        setLoading(false);
        setGoogleLoading(false);
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  // Password strength heuristics
  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  const handleGoogleSignUp = async () => {
    if (isSubmittingRef.current || isBusy) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    isSubmittingRef.current = true;
    setGoogleLoading(true);

    try {
      const { error } = await loginWithGoogle();
      if (!mountedRef.current) return;

      if (error) {
        setErrorMessage(error);
        isSubmittingRef.current = false;
        setGoogleLoading(false);
      } else {
        window.setTimeout(() => {
          if (mountedRef.current) {
            isSubmittingRef.current = false;
            setGoogleLoading(false);
          }
        }, 8000);
      }
    } catch {
      if (mountedRef.current) {
        setErrorMessage('Unable to start Google registration. Please try again.');
        isSubmittingRef.current = false;
        setGoogleLoading(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isBusy) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    const validationError = validateSignUpInputs(fullName, email, password, confirmPassword);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const cleanName = fullName.trim();
    const cleanEmail = normalizeAuthEmail(email);

    isSubmittingRef.current = true;
    setLoading(true);

    try {
      const { error, needsEmailVerification } = await signUpWithEmail(cleanEmail, password, cleanName);
      if (!mountedRef.current) return;

      if (error) {
        setErrorMessage(error);
      } else if (needsEmailVerification) {
        onSetRegisteredEmail(cleanEmail);
        onNavigate('verify-email');
      } else {
        setSuccessMessage('Account created. Opening your workspace...');
        onSuccess();
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
      title="Create your workspace"
      subtitle="Start building your personal finance, attendance, and goal workspace with account-scoped data isolation."
      onBack={() => onNavigate('welcome')}
      backLabel="Back to Overview"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Error Alert Box */}
        {errorMessage && (
          <div
            role="alert"
            className="p-3 bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs rounded-xl flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-[#c92a2a] mt-0.5 shrink-0" />
            <span className="leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Success Notice */}
        {successMessage && (
          <div
            role="status"
            className="p-3 bg-[#f0fdf4] border border-[#1f7a4c]/20 text-[#166534] text-xs rounded-xl flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-[#1f7a4c] shrink-0" />
            <span className="leading-relaxed">{successMessage}</span>
          </div>
        )}

        {/* Supabase Not Configured Notice (if applicable) */}
        {!isConfigured && (
          <div className="p-3 bg-[#f5f5f7] rounded-xl text-xs text-[#6e6e73] space-y-1">
            <span className="font-semibold text-[#1d1d1f] block">Supabase Connection Pending</span>
            <p className="text-[11px] leading-relaxed">
              Environment variables for Supabase are not yet configured. Sign up will be enabled as soon as credentials are supplied.
            </p>
          </div>
        )}

        {/* Google Registration */}
        <GoogleAuthButton
          label="Start with Google"
          loading={googleLoading}
          disabled={isBusy}
          onClick={handleGoogleSignUp}
        />

        {/* Email Registration Divider */}
        <div className="relative my-3 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-black/[0.06]" />
          </div>
          <span className="relative px-3 bg-white text-[11px] font-medium text-[#86868b]">
            or sign up with email
          </span>
        </div>

        {/* Full Name */}
        <div className="text-left">
          <label htmlFor="signup-name" className={LABEL_CLASS}>
            Full name
          </label>
          <input
            id="signup-name"
            type="text"
            required
            autoComplete="name"
            disabled={isBusy}
            placeholder="Jordan Miller"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            className={`${INPUT_CLASS} min-h-[44px]`}
          />
        </div>

        {/* Email Address */}
        <div className="text-left">
          <label htmlFor="signup-email" className={LABEL_CLASS}>
            Email address
          </label>
          <input
            id="signup-email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            autoComplete="email"
            disabled={isBusy}
            placeholder="name@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            className={`${INPUT_CLASS} min-h-[44px]`}
          />
        </div>

        {/* Password */}
        <div className="text-left">
          <label htmlFor="signup-password" className={LABEL_CLASS}>
            Password (minimum 8 characters)
          </label>
          <div className="relative">
            <input
              id="signup-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              disabled={isBusy}
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              className={`${INPUT_CLASS} min-h-[44px] pr-12`}
            />
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setShowPassword(prev => !prev)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Clean minimal password checklist */}
          {password.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 pt-1.5 text-[11px] text-[#6e6e73]">
              <span className={`flex items-center gap-1 ${hasMinLength ? 'text-[#1f7a4c] font-semibold' : ''}`}>
                <Check className="w-3 h-3" /> 8+ chars
              </span>
              <span className={`flex items-center gap-1 ${hasLetter ? 'text-[#1f7a4c] font-semibold' : ''}`}>
                <Check className="w-3 h-3" /> Letters
              </span>
              <span className={`flex items-center gap-1 ${hasNumber ? 'text-[#1f7a4c] font-semibold' : ''}`}>
                <Check className="w-3 h-3" /> Numbers
              </span>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div className="text-left">
          <label htmlFor="signup-confirm" className={LABEL_CLASS}>
            Confirm password
          </label>
          <input
            id="signup-confirm"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="new-password"
            disabled={isBusy}
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            className={`${INPUT_CLASS} min-h-[44px]`}
          />
        </div>

        {/* Submit Button */}
        <motion.button
          whileTap={tapScale.button}
          type="submit"
          disabled={isBusy}
          className={`${ACCENT_BUTTON_CLASS} w-full min-h-[48px] text-sm font-semibold mt-2`}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Creating Workspace...</span>
            </>
          ) : (
            <>
              <span>Create Account</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </motion.button>

        {/* Alternative Magic Link Option & Notice */}
        <div className="space-y-2.5 pt-1">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onNavigate('magic-link')}
            className={`${SECONDARY_BUTTON_CLASS} w-full min-h-[44px] text-xs`}
          >
            <span>Or sign in with Magic Link</span>
          </button>

          {/* Free Plan Magic Link Notice */}
          <div className="text-[11px] text-[#6e6e73] leading-relaxed space-y-1 px-3.5 py-2.5 bg-[#f5f5f7] rounded-xl text-left">
            <span className="font-semibold text-[#1d1d1f] block">Free Plan Notice</span>
            <p>On the free plan, you can request up to 2 magic links per hour. This limit helps prevent abuse and maintain reliable service.</p>
            <p>Please wait until your hourly limit resets before requesting another magic link.</p>
          </div>
        </div>

        {/* Route to Login */}
        <div className="pt-3 text-center text-xs text-[#6e6e73] border-t border-black/[0.06]">
          <span>Already have an account? </span>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onNavigate('login')}
            className="font-semibold text-[#0071e3] hover:text-[#0077ed] hover:underline cursor-pointer disabled:opacity-50"
          >
            Sign in
          </button>
        </div>
      </form>
    </AuthLayout>
  );
};
