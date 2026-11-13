/**
 * Authentication Context & Provider for XOS
 * Manages Supabase session, user state, authentication flows, and demo bypass mode.
 */
import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { repository } from '../services/repository';
import { apiOptimization } from '../services/apiClient';

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  isDemoUser: boolean;
  isPasswordRecovery: boolean;
  loginWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<{ error: string | null; needsEmailVerification?: boolean }>;
  loginWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
  clearPasswordRecoveryFlag: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_USER_KEY = 'xos_demo_guest_active';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
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

  // Apply auth email & fallback display name AFTER DB hydration without overwriting persisted profile
  const applyAuthProfileFallback = useCallback((u: User) => {
    const currentSettings = repository.getSettings();
    const fallbackName = u.user_metadata?.full_name || u.email?.split('@')[0] || 'XOS User';
    const email = u.email || '';

    repository.saveSettings({
      ...currentSettings,
      profile: {
        ...currentSettings.profile,
        name: currentSettings.profile.name || fallbackName,
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

  // Initialize session and listen for auth changes (never await DB calls inside onAuthStateChange!)
  useEffect(() => {
    let mounted = true;

    if (window.location.hash.includes('type=recovery')) {
      setIsPasswordRecovery(true);
    }

    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    // Listen to auth events synchronously; reactive effect below handles hydration outside callback tick
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (!mounted) return;

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
      try {
        sessionStorage.removeItem(DEMO_USER_KEY);
      } catch {}
    });

    // Initial session lookup with request coalescing
    apiOptimization.coalesce('auth:initial_session', async () => {
      return supabase.auth.getSession();
    }).then(async ({ data: { session: initialSession }, error }) => {
      if (!mounted) return;
      if (!error && initialSession?.user) {
        setSession(initialSession);
        setUser(initialSession.user);
        setIsDemoUser(false);
        try {
          sessionStorage.removeItem(DEMO_USER_KEY);
        } catch {}
        await ensureUserHydrated(initialSession.user);
      }
      if (mounted) setLoading(false);
    }).catch(() => {
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [ensureUserHydrated]);

  // Hydrate whenever authenticated user ID transitions (coalesced; skips TOKEN_REFRESHED for same user.id)
  useEffect(() => {
    if (!isSupabaseConfigured || !user?.id) return;
    ensureUserHydrated(user);
  }, [user?.id, ensureUserHydrated]);

  const sanitizeError = (err: AuthError | Error | null): string => {
    if (!err) return '';
    const msg = err.message || '';
    // Map common error messages to polite, sanitized user prose
    if (msg.includes('Invalid login credentials') || msg.includes('invalid_grant')) {
      return 'Incorrect email or password. Please verify and try again.';
    }
    if (msg.includes('Email not confirmed')) {
      return 'Please verify your email address before logging in. Check your inbox for the confirmation link.';
    }
    if (msg.includes('User already registered')) {
      return 'An account with this email address already exists. Please log in instead.';
    }
    if (msg.includes('Password should be at least')) {
      return 'Password must be at least 8 characters long.';
    }
    if (msg.includes('rate limit') || msg.includes('over_email_send_rate_limit')) {
      return 'Too many attempts. Please wait a moment before trying again.';
    }
    return msg || 'An unexpected error occurred. Please try again.';
  };

  const loginWithPassword = async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    const cleanEmail = email.trim();
    // Coalesce duplicate in-flight login requests (e.g. double-click submit)
    return apiOptimization.coalesce(`auth:login:${cleanEmail}`, async () => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password
        });

        if (error) {
          return { error: sanitizeError(error) };
        }

        if (data.session) {
          setSession(data.session);
          setUser(data.user);
          setIsDemoUser(false);
          try { sessionStorage.removeItem(DEMO_USER_KEY); } catch {}
          apiOptimization.invalidateCache();
          if (data.user) {
            await ensureUserHydrated(data.user);
          }
        }

        return { error: null };
      } catch (err) {
        return { error: err instanceof Error ? sanitizeError(err) : 'Network request failed.' };
      }
    });
  };

  const signUpWithEmail = async (email: string, password: string, fullName: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    const cleanEmail = email.trim();
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
          return { error: sanitizeError(error) };
        }

        // If user created but session is null, email confirmation is required by Supabase settings
        const needsEmailVerification = !data.session;

        if (data.session && data.user) {
          setSession(data.session);
          setUser(data.user);
          setIsDemoUser(false);
          try { sessionStorage.removeItem(DEMO_USER_KEY); } catch {}
          apiOptimization.invalidateCache();
          await ensureUserHydrated(data.user);
        }

        return { error: null, needsEmailVerification };
      } catch (err) {
        return { error: err instanceof Error ? sanitizeError(err) : 'Registration failed.' };
      }
    });
  };

  const loginWithMagicLink = async (email: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    const cleanEmail = email.trim();
    
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
          return { error: sanitizeError(error) };
        }

        // Record cooldown timestamp only upon successful dispatch
        apiOptimization.recordAction(`auth:magiclink:${cleanEmail}`);
        return { error: null };
      } catch (err) {
        return { error: err instanceof Error ? sanitizeError(err) : 'Failed to send magic link.' };
      }
    });
  };

  const requestPasswordReset = async (email: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    const cleanEmail = email.trim();

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
          return { error: sanitizeError(error) };
        }

        // Record cooldown timestamp only upon successful dispatch
        apiOptimization.recordAction(`auth:reset:${cleanEmail}`);
        return { error: null };
      } catch (err) {
        return { error: err instanceof Error ? sanitizeError(err) : 'Failed to send reset link.' };
      }
    });
  };

  const updatePassword = async (newPassword: string) => {
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
          return { error: sanitizeError(error) };
        }

        setIsPasswordRecovery(false);
        return { error: null };
      } catch (err) {
        return { error: err instanceof Error ? sanitizeError(err) : 'Failed to update password.' };
      }
    });
  };

  const signOut = async () => {
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
      apiOptimization.invalidateCache();
      repository.clearUserData();
      try {
        sessionStorage.removeItem(DEMO_USER_KEY);
      } catch {}
    }
  };

  const enterDemoMode = () => {
    setIsDemoUser(true);
    try {
      sessionStorage.setItem(DEMO_USER_KEY, 'true');
    } catch {}
  };

  const exitDemoMode = () => {
    completedUserIdRef.current = null;
    inFlightHydrationRef.current = null;
    setIsDemoUser(false);
    repository.clearUserData();
    try {
      sessionStorage.removeItem(DEMO_USER_KEY);
    } catch {}
  };

  const clearPasswordRecoveryFlag = () => {
    setIsPasswordRecovery(false);
  };

  const value = useMemo(() => ({
    user,
    session,
    loading,
    isConfigured: isSupabaseConfigured,
    isDemoUser,
    isPasswordRecovery,
    loginWithPassword,
    signUpWithEmail,
    loginWithMagicLink,
    requestPasswordReset,
    updatePassword,
    signOut,
    enterDemoMode,
    exitDemoMode,
    clearPasswordRecoveryFlag
  }), [user, session, loading, isDemoUser, isPasswordRecovery]);

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
