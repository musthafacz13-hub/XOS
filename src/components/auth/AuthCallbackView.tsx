/**
 * XOS Authentication Callback Processor
 * Handles incoming Supabase auth redirects (PKCE codes, token fragments, password recovery, email verification).
 */
import React, { useEffect, useState, useRef } from 'react';
import { Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { AuthLayout } from './AuthLayout';
import { clearAuthUrlParams, sanitizeAuthErrorMessage } from '../../utils/authValidation';

interface AuthCallbackViewProps {
  onSuccess: () => void;
  onPasswordRecovery: () => void;
  onNavigateLogin: () => void;
}

export const AuthCallbackView: React.FC<AuthCallbackViewProps> = ({
  onSuccess,
  onPasswordRecovery,
  onNavigateLogin
}) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    if (hasProcessedRef.current) return;
    hasProcessedRef.current = true;

    let active = true;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const processAuthCallback = async () => {
      // 1. Check for explicit error in URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));

      const errorDesc = urlParams.get('error_description') || hashParams.get('error_description');
      const errorMsg = urlParams.get('error') || hashParams.get('error');

      if (errorDesc || errorMsg) {
        clearAuthUrlParams();
        if (active) {
          let decoded = errorDesc || errorMsg || 'Authentication callback failed.';
          try {
            decoded = decodeURIComponent(decoded);
          } catch {
            // Keep raw message if already decoded or malformed
          }
          setErrorMessage(sanitizeAuthErrorMessage(decoded));
        }
        return;
      }

      // 2. Check for password recovery type
      const isRecovery = hashParams.get('type') === 'recovery' || urlParams.get('type') === 'recovery';

      if (!isSupabaseConfigured) {
        clearAuthUrlParams();
        if (active) {
          if (isRecovery) {
            onPasswordRecovery();
          } else {
            onSuccess();
          }
        }
        return;
      }

      // 3. Check for PKCE Authorization Code
      const code = urlParams.get('code');
      if (code) {
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          clearAuthUrlParams();
          if (!active) return;

          if (error) {
            setErrorMessage(sanitizeAuthErrorMessage(error));
            return;
          }

          if (isRecovery) {
            onPasswordRecovery();
          } else if (data.session) {
            onSuccess();
          } else {
            onNavigateLogin();
          }
          return;
        } catch (err) {
          clearAuthUrlParams();
          if (active) {
            setErrorMessage(sanitizeAuthErrorMessage(err));
          }
          return;
        }
      }

      // 4. Check for existing session or hash token
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!active) return;

        if (error) {
          clearAuthUrlParams();
          setErrorMessage(sanitizeAuthErrorMessage(error));
          return;
        }

        if (isRecovery) {
          clearAuthUrlParams();
          onPasswordRecovery();
        } else if (session) {
          clearAuthUrlParams();
          onSuccess();
        } else {
          // Wait briefly for onAuthStateChange / implicit hash parsing before routing to login
          fallbackTimer = setTimeout(() => {
            if (!active) return;
            const stillRecovery = window.location.hash.includes('type=recovery');
            clearAuthUrlParams();
            if (stillRecovery) {
              onPasswordRecovery();
            } else {
              onNavigateLogin();
            }
          }, 1200);
        }
      } catch (err) {
        clearAuthUrlParams();
        if (active) {
          setErrorMessage(sanitizeAuthErrorMessage(err));
        }
      }
    };

    processAuthCallback();

    return () => {
      active = false;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
    };
  }, [onSuccess, onPasswordRecovery, onNavigateLogin]);

  return (
    <AuthLayout
      title="Securing your session"
      subtitle="Validating authentication tokens and preparing your personal workspace."
    >
      <div className="py-8 text-center space-y-4">
        {errorMessage ? (
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 className="font-bold text-sm text-[#111111]">
                Authentication link could not be verified
              </h3>
              <p className="text-xs text-neutral-500 leading-relaxed font-normal">
                {errorMessage}
              </p>
            </div>

            <button
              onClick={() => {
                clearAuthUrlParams();
                onNavigateLogin();
              }}
              type="button"
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-5 py-2.5 bg-[#111318] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors cursor-pointer"
            >
              <span>Return to Login</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#8ECFFF]" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-[#87CEEB]" />
            <p className="text-xs text-neutral-500 font-medium">
              Authenticating session with Supabase...
            </p>
          </div>
        )}
      </div>
    </AuthLayout>
  );
};
