/**
 * XOS Sign Up View
 * Supports new user registration with full name, email, secure password confirmation,
 * password strength validation, and email verification handling.
 */
import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, Loader2, ArrowRight, Check, CheckCircle2 } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';
import { tapScale } from '../../utils/motion';
import { validateSignUpInputs, normalizeAuthEmail } from '../../utils/authValidation';

interface SignUpViewProps {
  onNavigate: (view: 'welcome' | 'login' | 'verify-email') => void;
  onSuccess: () => void;
  onSetRegisteredEmail: (email: string) => void;
}

export const SignUpView: React.FC<SignUpViewProps> = ({
  onNavigate,
  onSuccess,
  onSetRegisteredEmail
}) => {
  const { signUpWithEmail, isConfigured } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Password strength heuristics
  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;

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
      subtitle="Start building your life operating system with private and secure data isolation."
      onBack={() => onNavigate('welcome')}
      backLabel="Back to Overview"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Error Alert Box */}
        {errorMessage && (
          <div
            role="alert"
            className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
            <span className="leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Success Notice */}
        {successMessage && (
          <div
            role="status"
            className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="leading-relaxed">{successMessage}</span>
          </div>
        )}

        {/* Supabase Not Configured Notice (if applicable) */}
        {!isConfigured && (
          <div className="p-3 bg-neutral-100 rounded-xl border border-neutral-200 text-xs text-neutral-600 space-y-1">
            <span className="font-semibold text-neutral-900 block">Supabase Connection Pending</span>
            <p className="text-[11px] leading-relaxed">
              Environment variables for Supabase are not yet configured. Sign up will be enabled as soon as credentials are supplied.
            </p>
          </div>
        )}

        {/* Full Name */}
        <div className="space-y-1.5 text-left">
          <label htmlFor="signup-name" className="block text-xs font-semibold text-neutral-700">
            Full name
          </label>
          <input
            id="signup-name"
            type="text"
            required
            autoComplete="name"
            disabled={loading}
            placeholder="Jordan Miller"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            className="w-full min-h-[44px] px-3.5 py-2.5 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] transition-all disabled:opacity-60"
          />
        </div>

        {/* Email Address */}
        <div className="space-y-1.5 text-left">
          <label htmlFor="signup-email" className="block text-xs font-semibold text-neutral-700">
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

        {/* Password */}
        <div className="space-y-1.5 text-left">
          <label htmlFor="signup-password" className="block text-xs font-semibold text-neutral-700">
            Password (minimum 8 characters)
          </label>
          <div className="relative">
            <input
              id="signup-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              disabled={loading}
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              className="w-full min-h-[44px] pl-3.5 pr-12 py-2.5 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] transition-all disabled:opacity-60"
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => setShowPassword(prev => !prev)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100/80 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Clean minimal password checklist */}
          {password.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-neutral-500">
              <span className={`flex items-center gap-1 ${hasMinLength ? 'text-emerald-600 font-semibold' : ''}`}>
                <Check className="w-3 h-3" /> 8+ chars
              </span>
              <span className={`flex items-center gap-1 ${hasLetter ? 'text-emerald-600 font-semibold' : ''}`}>
                <Check className="w-3 h-3" /> Letters
              </span>
              <span className={`flex items-center gap-1 ${hasNumber ? 'text-emerald-600 font-semibold' : ''}`}>
                <Check className="w-3 h-3" /> Numbers
              </span>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div className="space-y-1.5 text-left">
          <label htmlFor="signup-confirm" className="block text-xs font-semibold text-neutral-700">
            Confirm password
          </label>
          <input
            id="signup-confirm"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="new-password"
            disabled={loading}
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            className="w-full min-h-[44px] px-3.5 py-2.5 text-base md:text-sm bg-white border border-neutral-300 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] transition-all disabled:opacity-60"
          />
        </div>

        {/* Submit Button */}
        <motion.button
          whileTap={tapScale.button}
          type="submit"
          disabled={loading}
          className="w-full min-h-[48px] flex items-center justify-center gap-2 py-3 bg-[#111318] text-white text-sm font-semibold rounded-xl hover:bg-black transition-colors shadow-sm disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ECFFF] mt-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-[#87CEEB]" />
              <span>Creating Workspace...</span>
            </>
          ) : (
            <>
              <span>Create Account</span>
              <ArrowRight className="w-4 h-4 text-[#87CEEB]" />
            </>
          )}
        </motion.button>

        {/* Route to Login */}
        <div className="pt-3 text-center text-xs text-neutral-500 border-t border-black/[0.04]">
          <span>Already have an account? </span>
          <button
            type="button"
            disabled={loading}
            onClick={() => onNavigate('login')}
            className="font-semibold text-[#111111] hover:underline cursor-pointer disabled:opacity-50"
          >
            Log In
          </button>
        </div>
      </form>
    </AuthLayout>
  );
};
