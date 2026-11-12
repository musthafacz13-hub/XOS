/**
 * Authentication Context & Provider for XOS
 * Manages Supabase session, user state, authentication flows, and demo bypass mode.
 */
import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import type { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { repository } from '../services/repository';

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

  // Sync profile when authenticated
  const syncProfileToXOS = useCallback((u: User) => {
    const currentSettings = repository.getSettings();
    const fullName = u.user_metadata?.full_name || u.email?.split('@')[0] || 'XOS User';
    const email = u.email || '';
    
    repository.saveSettings({
      ...currentSettings,
      profile: {
        ...currentSettings.profile,
        name: currentSettings.profile.name || fullName,
        email: email
      }
    });
  }, []);

  // Initialize session and listen for auth changes
  useEffect(() => {
    let mounted = true;

    // Check for password recovery hash parameter on boot
    if (window.location.hash.includes('type=recovery')) {
      setIsPasswordRecovery(true);
    }

    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted) return;
      if (!error && session) {
        setSession(session);
        setUser(session.user);
        syncProfileToXOS(session.user);
      }
      setLoading(false);
    }).catch(() => {
      if (mounted) setLoading(false);
    });

    // Listen to auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (!mounted) return;

      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }

      if (currentSession) {
        setSession(currentSession);
        setUser(currentSession.user);
        syncProfileToXOS(currentSession.user);
        setIsDemoUser(false);
        try {
          sessionStorage.removeItem(DEMO_USER_KEY);
        } catch {}
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [syncProfileToXOS]);

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
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) {
        return { error: sanitizeError(error) };
      }

      if (data.session) {
        setSession(data.session);
        setUser(data.user);
        syncProfileToXOS(data.user);
        setIsDemoUser(false);
        try { sessionStorage.removeItem(DEMO_USER_KEY); } catch {}
      }

      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? sanitizeError(err) : 'Network request failed.' };
    }
  };

  const signUpWithEmail = async (email: string, password: string, fullName: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    try {
      const redirectUrl = `${window.location.origin}/auth/callback`;
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
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
        syncProfileToXOS(data.user);
        setIsDemoUser(false);
        try { sessionStorage.removeItem(DEMO_USER_KEY); } catch {}
      }

      return { error: null, needsEmailVerification };
    } catch (err) {
      return { error: err instanceof Error ? sanitizeError(err) : 'Registration failed.' };
    }
  };

  const loginWithMagicLink = async (email: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    try {
      const redirectUrl = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectUrl
        }
      });

      if (error) {
        return { error: sanitizeError(error) };
      }

      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? sanitizeError(err) : 'Failed to send magic link.' };
    }
  };

  const requestPasswordReset = async (email: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
    try {
      const redirectUrl = `${window.location.origin}/auth/callback?type=recovery`;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectUrl
      });

      if (error) {
        return { error: sanitizeError(error) };
      }

      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? sanitizeError(err) : 'Failed to send reset link.' };
    }
  };

  const updatePassword = async (newPassword: string) => {
    if (!isSupabaseConfigured) {
      return { 
        error: 'Supabase credentials are not yet configured in environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' 
      };
    }
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
  };

  const signOut = async () => {
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.warn('Sign out caught:', err);
    } finally {
      setUser(null);
      setSession(null);
      setIsDemoUser(false);
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
    setIsDemoUser(false);
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
