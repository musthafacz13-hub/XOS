/**
 * XOS Authentication Callback Processor
 * Handles incoming Supabase auth redirects (PKCE codes, token fragments, password recovery, email verification).
 */
import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../services/supabase';
import { AuthLayout } from './AuthLayout';

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

  useEffect(() => {
    let active = true;

    const processAuthCallback = async () => {
      // 1. Check for explicit error in URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.substring(1));

      const errorDesc = urlParams.get('error_description') || hashParams.get('error_description');
      const errorMsg = urlParams.get('error') || hashParams.get('error');

      if (errorDesc || errorMsg) {
        if (active) {
          setErrorMessage(decodeURIComponent(errorDesc || errorMsg || 'Authentication callback failed.'));
        }
        return;
      }

      // 2. Check for password recovery type
      const isRecovery = hashParams.get('type') === 'recovery' || urlParams.get('type') === 'recovery';

      if (!isSupabaseConfigured) {
        // Fallback if testing without Supabase credentials
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
          if (error) {
            if (active) setErrorMessage(error.message);
            return;
          }

          if (active) {
            if (isRecovery) {
              onPasswordRecovery();
            } else if (data.session) {
              onSuccess();
            }
          }
          return;
        } catch (err) {
          if (active) {
            setErrorMessage(err instanceof Error ? err.message : 'Failed to exchange authorization code.');
          }
          return;
        }
      }

      // 4. Check for existing session or hash token
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          if (active) setErrorMessage(error.message);
          return;
        }

        if (active) {
          if (isRecovery) {
            onPasswordRecovery();
          } else if (session) {
            onSuccess();
          } else {
            // Wait slightly for onAuthStateChange to fire or redirect to login
            setTimeout(() => {
              if (active) {
                if (window.location.hash.includes('type=recovery')) {
                  onPasswordRecovery();
                } else {
                  onNavigateLogin();
                }
              }
            }, 1200);
          }
        }
      } catch (err) {
        if (active) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to retrieve session.');
        }
      }
    };

    processAuthCallback();

    return () => {
      active = false;
    };
  }, [onSuccess, onPasswordRecovery, onNavigateLogin]);

  return (
    <AuthLayout
      title="Securing your session"
      subtitle="Validating authentication tokens and preparing your personal workspace."
    >
      <div className="py-8 text-center space-y-4">
        {errorMessage ? (
          <div className="space-y-4 animate-in fade-in duration-200">
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
              onClick={onNavigateLogin}
              type="button"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#111111] text-white text-xs font-semibold rounded-xl hover:bg-black transition-colors cursor-pointer"
            >
              <span>Return to Login</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#87CEEB]" />
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
