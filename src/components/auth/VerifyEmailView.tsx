/**
 * XOS Verify Email Confirmation Screen
 * Rendered after user registration to guide the user through inbox confirmation.
 */
import React, { useState, useEffect } from 'react';
import { Mail, CheckCircle, RotateCcw, ArrowRight } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { useAuth } from '../../context/AuthContext';

interface VerifyEmailViewProps {
  email: string;
  onNavigateLogin: () => void;
}

export const VerifyEmailView: React.FC<VerifyEmailViewProps> = ({ 
  email, 
  onNavigateLogin 
}) => {
  const { loginWithMagicLink } = useAuth();
  const [cooldownSeconds, setCooldownSeconds] = useState(60);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const handleResend = async () => {
    if (cooldownSeconds > 0 || resending || !email) return;

    setResending(true);
    setResendNotice(null);
    const { error } = await loginWithMagicLink(email);
    setResending(false);

    if (error) {
      setResendNotice(error);
    } else {
      setResendNotice('A fresh verification link has been sent to your email.');
      setCooldownSeconds(60);
    }
  };

  return (
    <AuthLayout
      title="Verify your email"
      subtitle="Almost ready. Confirm your email address to activate your personal workspace."
      onBack={onNavigateLogin}
      backLabel="Back to Login"
    >
      <div className="space-y-5 text-center py-2 animate-in fade-in duration-200">
        {/* Email Icon */}
        <div className="w-14 h-14 rounded-2xl bg-[#87CEEB]/15 text-[#111111] flex items-center justify-center mx-auto border border-[#87CEEB]/30 shadow-xs">
          <Mail className="w-7 h-7 text-[#111111]" />
        </div>

        {/* Messaging */}
        <div className="space-y-2">
          <h3 className="font-bold text-base text-[#111111]">
            Confirmation email sent
          </h3>
          <p className="text-xs text-neutral-600 leading-relaxed font-normal">
            We sent a verification link to:
          </p>
          <div className="text-xs font-mono font-semibold text-[#111111] bg-neutral-50 py-1.5 px-3 rounded-lg border border-neutral-200 inline-block">
            {email || 'your email address'}
          </div>
        </div>

        {/* Step Guide */}
        <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200 text-left text-xs text-neutral-600 space-y-2">
          <span className="font-bold text-neutral-900 block text-[11px] uppercase tracking-wider">
            Verification Steps
          </span>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
            <span>Open the message from Supabase / XOS in your inbox.</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
            <span>Click the confirmation link to securely authenticate your session.</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
            <span>You will be seamlessly redirected into your XOS command center.</span>
          </div>
        </div>

        {/* Resend Notice */}
        {resendNotice && (
          <div className="p-3 bg-neutral-100 border border-neutral-200 text-neutral-700 text-xs rounded-xl">
            {resendNotice}
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 space-y-2.5">
          <button
            type="button"
            disabled={cooldownSeconds > 0 || resending}
            onClick={handleResend}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold rounded-xl border border-neutral-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>
              {cooldownSeconds > 0
                ? `Resend verification link in ${cooldownSeconds}s`
                : resending
                ? 'Sending...'
                : 'Resend Verification Email'}
            </span>
          </button>

          <button
            type="button"
            onClick={onNavigateLogin}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-[#111111] hover:bg-black text-white text-xs font-semibold rounded-xl transition-colors shadow-xs cursor-pointer"
          >
            <span>Back to Log In</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#87CEEB]" />
          </button>
        </div>
      </div>
    </AuthLayout>
  );
};
