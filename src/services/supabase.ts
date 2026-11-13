/**
 * Supabase Client Configuration for XOS
 * Handles authentication, user session persistence, and API boundaries.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { apiOptimization } from './apiClient';

const rawUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_URL : '') || '';
const rawAnonKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_ANON_KEY : '') || '';

// Clean validation checking if real credentials are provided
export const isSupabaseConfigured = Boolean(
  rawUrl &&
  rawAnonKey &&
  !rawUrl.includes('your-project-ref') &&
  !rawAnonKey.includes('your-anon-public-key') &&
  rawUrl.startsWith('https://')
);

// Fallback placeholder credentials so createClient never throws an unhandled exception at boot time
const supabaseUrl = isSupabaseConfigured ? rawUrl : 'https://placeholder.supabase.co';
const supabaseAnonKey = isSupabaseConfigured ? rawAnonKey : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder';

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'xos_auth_session'
  },
  global: {
    fetch: apiOptimization.createOptimizedFetch(12000, 45000)
  }
});
