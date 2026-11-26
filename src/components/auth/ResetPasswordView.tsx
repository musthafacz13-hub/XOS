/**
 * XOS Reset Password View
 * Allows authenticated recovery sessions to securely update password credentials.
 */
import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Eye, EyeOff, Loader2, ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';
import { tapScale } from '../../utils/motion';
import { clearAuthUrlParams } from '../../utils/authValidation';
import { INPUT_CLASS, LABEL_CLASS, ACCENT_BUTTON_CLASS } from '../ui/FormControls';

interface ResetPasswordViewProps {
  onSuccess: () => void;
  onNavigateLogin: () => void;
  onNavigateForgotPassword?: () => void;
}

export const ResetPasswordView: React.FC<ResetPasswordViewProps> = ({
  onSuccess,
  onNavigateLogin,
  onNavigateForgotPassword
}) => {
  const { updatePassword, user, signOut, clearPasswordRecoveryFlag } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleReturnToLogin = async () => {
    clearAuthUrlParams();
    clearPasswordRecoveryFlag();
    if (user) {
      await signOut();
    }
    onNavigateLogin();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || loading) return;

    setErrorMessage(null);

    if (!user) {
      setErrorMessage('No active recovery session was found. Please request a new password reset link.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify your entries.');
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);

    try {
      const { error } = await updatePassword(password);
      if (!mountedRef.current) return;

      if (error) {
        setErrorMessage(error);
      } else {
        setSuccess(true);
        clearAuthUrlParams();
        clearPasswordRecoveryFlag();
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
      title="Set a new password"
      subtitle="Choose a secure password with at least 8 characters for your XOS workspace."
    >
      {success ? (
        <div className="space-y-5 text-center py-2">
          <div className="w-12 h-12 rounded-2xl bg-[#f0fdf4] text-[#1f7a4c] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold text-base text-[#1d1d1f]">
              Password updated successfully
            </h3>
            <p className="text-xs text-[#6e6e73] leading-relaxed font-normal">
              Your new password is now active. You can proceed directly into your personal workspace.
            </p>
          </div>

          <motion.button
            whileTap={tapScale.button}
            onClick={() => {
              clearAuthUrlParams();
              onSuccess();
            }}
            type="button"
            className={`${ACCENT_BUTTON_CLASS} w-full min-h-[48px] text-sm font-semibold`}
          >
            <span>Enter Workspace</span>
            <ArrowRight className="w-4 h-4" />
          </motion.button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-[#fef2f2] border border-[#c92a2a]/20 text-[#991b1b] text-xs rounded-xl flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-[#c92a2a] mt-0.5 shrink-0" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {!user && (
            <div className="p-3 bg-[#fefce8] border border-[#a16207]/20 text-[#854d0e] text-xs rounded-xl flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-[#a16207] mt-0.5 shrink-0" />
              <p className="leading-relaxed">
                No active recovery session was detected. If your recovery link expired, please request a new reset email.
              </p>
            </div>
          )}

          <div className="text-left">
            <label htmlFor="new-password" className={LABEL_CLASS}>
              New password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                disabled={loading || !user}
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
                disabled={loading || !user}
                onClick={() => setShowPassword(prev => !prev)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="text-left">
            <label htmlFor="confirm-new-password" className={LABEL_CLASS}>
              Confirm new password
            </label>
            <input
              id="confirm-new-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              disabled={loading || !user}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              className={`${INPUT_CLASS} min-h-[44px]`}
            />
          </div>

          <motion.button
            whileTap={tapScale.button}
            type="submit"
            disabled={loading || !user}
            className={`${ACCENT_BUTTON_CLASS} w-full min-h-[48px] text-sm font-semibold`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Updating Password...</span>
              </>
            ) : (
              <>
                <span>Update Password</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </motion.button>

          <div className="pt-3 text-center text-xs text-[#6e6e73] border-t border-black/[0.06] flex flex-wrap items-center justify-center gap-3">
            {!user && onNavigateForgotPassword && (
              <button
                type="button"
                disabled={loading}
                onClick={onNavigateForgotPassword}
                className="min-h-[44px] px-4 inline-flex items-center justify-center text-[#0071e3] hover:text-[#0077ed] hover:underline font-semibold transition-colors cursor-pointer rounded-xl disabled:opacity-50"
              >
                Request New Reset Link
              </button>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={handleReturnToLogin}
              className="min-h-[44px] px-4 inline-flex items-center justify-center text-[#6e6e73] hover:text-[#1d1d1f] font-medium transition-colors cursor-pointer rounded-xl disabled:opacity-50"
            >
              Return to Login
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};
