/**
 * Supabase Client
 * Khởi tạo Supabase client cho frontend
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Flag to check if Supabase is configured
const isConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

if (!isConfigured && typeof window !== 'undefined') {
  console.warn('[Supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

// Always create a real client, but with placeholder URLs when not configured
// This ensures TypeScript types are correct
// The client will fail at runtime if not configured, but that's expected
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MTY0MjA4MDUsImV4cCI6MTkzMTk5NjgwNX0.placeholder';

export const supabase: SupabaseClient = createClient(
  supabaseUrl || PLACEHOLDER_URL,
  supabaseAnonKey || PLACEHOLDER_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);

export function isSupabaseConfigured(): boolean {
  return isConfigured;
}
