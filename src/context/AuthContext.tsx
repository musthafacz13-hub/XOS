/**
 * Authentication Context & Provider for XOS
 * Manages Supabase session, user state, authentication flows, and demo bypass mode.
 */
import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { repository } from '../services/repository';
import { apiOptimization } from '../services/apiClient';
import {
  clearAuthUrlParams,
  normalizeAuthEmail,
  sanitizeAuthErrorMessage
} from '../utils/authValidation';

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initError: string | null;
  isConfigured: boolean;
  isDemoUser: boolean;
  isPasswordRecovery: boolean;
  loginWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<{ error: string | null; needsEmailVerification?: boolean }>;
  loginWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  resendVerificationEmail: (email: string) => Promise<{ error: string | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
  clearPasswordRecoveryFlag: () => void;
  retryInitialization: () => Promise<void>;
  dismissInitError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_USER_KEY = 'xos_demo_guest_active';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [isDemoUser, setIsDemoUser] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DEMO_USER_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [isPasswordRecovery, setIsPasswordRecovery] = useState<boolean>(false);

  const inFlightHydrationRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);
  const completedUserIdRef = useRef<string | null>(null);
  const mountedRef = useRef<boolean>(true);
  const isDemoUserRef = useRef<boolean>(isDemoUser);

  useEffect(() => {
    isDemoUserRef.current = isDemoUser;
  }, [isDemoUser]);

  // Apply auth email & fallback display name AFTER DB hydration without overwriting persisted profile
  const applyAuthProfileFallback = useCallback((u: User) => {
    const currentSettings = repository.getSettings();
    const fallbackName = u.user_metadata?.full_name || u.email?.split('@')[0] || 'XOS User';
    const email = u.email || '';
    const nextName = currentSettings.profile.name || fallbackName;

    if (currentSettings.profile.name === nextName && currentSettings.profile.email === email) {
      return;
    }

    repository.saveSettings({
      ...currentSettings,
      profile: {
        ...currentSettings.profile,
        name: nextName,
        email
      }
    });
  }, []);

  // Single coordinated hydration owner with coalescing & user-switch isolation
  const ensureUserHydrated = useCallback((u: User): Promise<void> => {
    if (!isSupabaseConfigured || !u?.id) return Promise.resolve();

    if (completedUserIdRef.current === u.id && repository.getActiveUserId() === u.id) {
      return Promise.resolve();
    }

    if (inFlightHydrationRef.current && inFlightHydrationRef.current.userId === u.id) {
      return inFlightHydrationRef.current.promise;
    }

    const previousUserId = repository.getActiveUserId();
    if (previousUserId && previousUserId !== u.id) {
      repository.clearUserData();
    } else if (completedUserIdRef.current && completedUserIdRef.current !== u.id) {
      repository.clearUserData();
    }

    completedUserIdRef.current = null;
    repository.setActiveUserId(u.id);

    let promise!: Promise<void>;
    promise = (async () => {
      try {
        const result = await repository.fetchAllUserData(u.id);
        if (!result.stale && repository.getActiveUserId() === u.id) {
          applyAuthProfileFallback(u);
          completedUserIdRef.current = u.id;
        }
      } finally {
        if (inFlightHydrationRef.current?.promise === promise) {
          inFlightHydrationRef.current = null;
        }
      }
    })();

    inFlightHydrationRef.current = { userId: u.id, promise };
    return promise;
  }, [applyAuthProfileFallback]);

  const initializeSession = useCallback(async () => {
    if (!isSupabaseConfigured) {
      if (isDemoUserRef.current) {
        repository.loadDemoData();
      }
      if (mountedRef.current) {
        setInitError(null);
        setLoading(false);
      }
      return;
    }

    if (mountedRef.current) {
      setInitError(null);
      setLoading(true);
    }

    try {
      const { data: { session: initialSession }, error } = await apiOptimization.coalesce(
        'auth:initial_session',
        async () => supabase.auth.getSession()
      );

      if (!mountedRef.current) return;

      if (error) {
        setInitError('Unable to verify your workspace session. Check your connection and try again.');
        setLoading(false);
        return;
      }

      if (initialSession?.user) {
        setSession(initialSession);
        setUser(initialSession.user);
        setIsDemoUser(false);
        isDemoUserRef.current = false;
        try {
          sessionStorage.removeItem(DEMO_USER_KEY);
        } catch {}
        await ensureUserHydrated(initialSession.user);
      } else if (isDemoUserRef.current) {
        repository.loadDemoData();
      }

      if (mountedRef.current) {
        setInitError(null);
        setLoading(false);
      }
    } catch {
      if (mountedRef.current) {
        setInitError('Unable to connect to your workspace right now. Check your connection and try again.');
        setLoading(false);
      }
    }
  }, [ensureUserHydrated]);

  // Initialize session and listen for auth changes (never await DB calls inside onAuthStateChange!)
  useEffect(() => {
    mountedRef.current = true;

    if (window.location.hash.includes('type=recovery')) {
      setIsPasswordRecovery(true);
    }

    if (!isSupabaseConfigured) {
      if (isDemoUserRef.current) {
        repository.loadDemoData();
      }
      setLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }

    // Listen to auth events synchronously; reactive effect below handles hydration outside callback tick
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (!mountedRef.current) return;

      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }

      if (event === 'SIGNED_OUT' || !currentSession) {
        completedUserIdRef.current = null;
        inFlightHydrationRef.current = null;
        setSession(null);
        setUser(null);
        apiOptimization.invalidateCache();
        repository.clearUserData();
        setLoading(false);
        return;
      }

      setSession(currentSession);
      setUser(currentSession.user);
      setIsDemoUser(false);
      isDemoUserRef.current = false;
      setInitError(null);
      try {
        sessionStorage.removeItem(DEMO_USER_KEY);
      } catch {}
    });

    initializeSession();

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [ensureUserHydrated, initializeSession]);

  // Hydrate whenever authenticated user ID transitions (coalesced; skips TOKEN_REFRESHED for same user.id)
  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id) return;
    ensureUserHydrated(user);
  }, [user?.id, ensureUserHydrated]);

  const loginWithPassword = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    const cleanEmail = normalizeAuthEmail(email);
    // Coalesce duplicate in-flight login requests (e.g. double-click submit)
    return apiOptimization.coalesce(`auth:login:${cleanEmail}`, async () => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password
        });

        if (error) {
          return { error: sanitizeAuthErrorMessage(error) };
        }

        if (!data.session || !data.user) {
          return { error: 'Unable to establish an authenticated session. Please try again.' };
        }

        setSession(data.session);
        setUser(data.user);
        setIsDemoUser(false);
        isDemoUserRef.current = false;
        try { sessionStorage.removeItem(DEMO_USER_KEY); } catch {}
        apiOptimization.invalidateCache();
        await ensureUserHydrated(data.user);

        return { error: null };
      } catch (err) {
        return { error: sanitizeAuthErrorMessage(err) || 'Network request failed.' };
      }
    });
  }, [ensureUserHydrated]);

  const signUpWithEmail = useCallback(async (email: string, password: string, fullName: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    const cleanEmail = normalizeAuthEmail(email);
    // Coalesce duplicate in-flight registration attempts
    return apiOptimization.coalesce(`auth:signup:${cleanEmail}`, async () => {
      try {
        const redirectUrl = `${window.location.origin}/auth/callback`;
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: fullName.trim()
            },
            emailRedirectTo: redirectUrl
          }
        });

        if (error) {
          return { error: sanitizeAuthErrorMessage(error) };
        }

        // In Supabase GoTrue v2 with email confirmation enabled, signing up with an
        // already-registered email returns a user with an empty identities array and no session.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0 && !data.session) {
          return { error: 'An account with this email address already exists. Please log in instead.' };
        }

        // If user created but session is null, email confirmation is required by Supabase settings
        const needsEmailVerification = !data.session;

        if (data.session && data.user) {
          setSession(data.session);
          setUser(data.user);
          setIsDemoUser(false);
          isDemoUserRef.current = false;
          try { sessionStorage.removeItem(DEMO_USER_KEY); } catch {}
          apiOptimization.invalidateCache();
          await ensureUserHydrated(data.user);
        }

        return { error: null, needsEmailVerification };
      } catch (err) {
        return { error: sanitizeAuthErrorMessage(err) || 'Registration failed.' };
      }
    });
  }, [ensureUserHydrated]);

  const loginWithMagicLink = useCallback(async (email: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    const cleanEmail = normalizeAuthEmail(email);
    
    // Client-side rate-limit protection: prevent firing requests within 60s cooldown
    const { allowed, remainingMs } = apiOptimization.checkCooldown(`auth:magiclink:${cleanEmail}`, 60000);
    if (!allowed) {
      const waitSec = Math.ceil(remainingMs / 1000);
      return { error: `Too many requests. Please wait ${waitSec} second${waitSec > 1 ? 's' : ''} before requesting another magic link.` };
    }

    return apiOptimization.coalesce(`auth:magiclink:${cleanEmail}`, async () => {
      try {
        const redirectUrl = `${window.location.origin}/auth/callback`;
        const { error } = await supabase.auth.signInWithOtp({
          email: cleanEmail,
          options: {
            emailRedirectTo: redirectUrl
          }
        });

        if (error) {
          return { error: sanitizeAuthErrorMessage(error) };
        }

        // Record cooldown timestamp only upon successful dispatch
        apiOptimization.recordAction(`auth:magiclink:${cleanEmail}`);
        return { error: null };
      } catch (err) {
        return { error: sanitizeAuthErrorMessage(err) || 'Failed to send magic link.' };
      }
    });
  }, []);

  const resendVerificationEmail = useCallback(async (email: string) => {
    if (!isSupabaseConfigured) {
      return {
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).'
      };
    }
    const cleanEmail = normalizeAuthEmail(email);
    const { allowed, remainingMs } = apiOptimization.checkCooldown(`auth:resend:${cleanEmail}`, 60000);
    if (!allowed) {
      const waitSec = Math.ceil(remainingMs / 1000);
      return { error: `Too many requests. Please wait ${waitSec} second${waitSec > 1 ? 's' : ''} before resending.` };
    }

    return apiOptimization.coalesce(`auth:resend:${cleanEmail}`, async () => {
      try {
        const redirectUrl = `${window.location.origin}/auth/callback`;
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: cleanEmail,
          options: {
            emailRedirectTo: redirectUrl
          }
        });
        if (error) {
          return { error: sanitizeAuthErrorMessage(error) };
        }
        apiOptimization.recordAction(`auth:resend:${cleanEmail}`);
        return { error: null };
      } catch (err) {
        return { error: sanitizeAuthErrorMessage(err) || 'Failed to resend verification email.' };
      }
    });
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    const cleanEmail = normalizeAuthEmail(email);

    // Client-side rate-limit protection: prevent firing requests within 60s cooldown
    const { allowed, remainingMs } = apiOptimization.checkCooldown(`auth:reset:${cleanEmail}`, 60000);
    if (!allowed) {
      const waitSec = Math.ceil(remainingMs / 1000);
      return { error: `Too many requests. Please wait ${waitSec} second${waitSec > 1 ? 's' : ''} before requesting another reset link.` };
    }

    return apiOptimization.coalesce(`auth:reset:${cleanEmail}`, async () => {
      try {
        const redirectUrl = `${window.location.origin}/auth/callback?type=recovery`;
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: redirectUrl
        });

        if (error) {
          return { error: sanitizeAuthErrorMessage(error) };
        }

        // Record cooldown timestamp only upon successful dispatch
        apiOptimization.recordAction(`auth:reset:${cleanEmail}`);
        return { error: null };
      } catch (err) {
        return { error: sanitizeAuthErrorMessage(err) || 'Failed to send reset link.' };
      }
    });
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    return apiOptimization.coalesce('auth:update_password', async () => {
      try {
        const { error } = await supabase.auth.updateUser({
          password: newPassword
        });

        if (error) {
          return { error: sanitizeAuthErrorMessage(error) };
        }

        setIsPasswordRecovery(false);
        return { error: null };
      } catch (err) {
        return { error: sanitizeAuthErrorMessage(err) || 'Failed to update password.' };
      }
    });
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.warn('Sign out caught:', err);
    } finally {
      completedUserIdRef.current = null;
      inFlightHydrationRef.current = null;
      setUser(null);
      setSession(null);
      setIsDemoUser(false);
      isDemoUserRef.current = false;
      setIsPasswordRecovery(false);
      apiOptimization.invalidateCache();
      repository.clearUserData();
      clearAuthUrlParams();
      try {
        sessionStorage.removeItem(DEMO_USER_KEY);
      } catch {}
    }
  }, []);

  const enterDemoMode = useCallback(() => {
    completedUserIdRef.current = null;
    inFlightHydrationRef.current = null;
    repository.clearUserData();
    repository.loadDemoData();
    isDemoUserRef.current = true;
    setIsDemoUser(true);
    try {
      sessionStorage.setItem(DEMO_USER_KEY, 'true');
    } catch {}
  }, []);

  const exitDemoMode = useCallback(() => {
    completedUserIdRef.current = null;
    inFlightHydrationRef.current = null;
    isDemoUserRef.current = false;
    setIsDemoUser(false);
    repository.clearUserData();
    try {
      sessionStorage.removeItem(DEMO_USER_KEY);
    } catch {}
  }, []);

  const clearPasswordRecoveryFlag = useCallback(() => {
    setIsPasswordRecovery(false);
  }, []);

  const retryInitialization = useCallback(async () => {
    await initializeSession();
  }, [initializeSession]);

  const dismissInitError = useCallback(() => {
    setInitError(null);
    setLoading(false);
  }, []);

  const value = useMemo(() => ({
    user,
    session,
    loading,
    initError,
    isConfigured: isSupabaseConfigured,
    isDemoUser,
    isPasswordRecovery,
    loginWithPassword,
    signUpWithEmail,
    loginWithMagicLink,
    resendVerificationEmail,
    requestPasswordReset,
    updatePassword,
    signOut,
    enterDemoMode,
    exitDemoMode,
    clearPasswordRecoveryFlag,
    retryInitialization,
    dismissInitError
  }), [
    user,
    session,
    loading,
    initError,
    isDemoUser,
    isPasswordRecovery,
    loginWithPassword,
    signUpWithEmail,
    loginWithMagicLink,
    resendVerificationEmail,
    requestPasswordReset,
    updatePassword,
    signOut,
    enterDemoMode,
    exitDemoMode,
    clearPasswordRecoveryFlag,
    retryInitialization,
    dismissInitError
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
