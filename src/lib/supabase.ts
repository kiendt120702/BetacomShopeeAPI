/**
 * Supabase Client
 * Khởi tạo Supabase client cho frontend
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Flag to check if Supabase is configured
const isConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

if (!isConfigured && typeof window !== 'undefined') {
  console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

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
      storageKey: 'betacom-auth-token',
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  }
);

export function isSupabaseConfigured(): boolean {
  return isConfigured;
}

// Cache for shop UUID lookups
interface CacheEntry {
  value: string;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 100;
const shopUuidCache = new Map<number, CacheEntry>();

function cleanExpiredCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of shopUuidCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      shopUuidCache.delete(key);
    }
  }
}

function ensureCacheSize(): void {
  if (shopUuidCache.size >= CACHE_MAX_SIZE) {
    const entriesToRemove = Math.ceil(CACHE_MAX_SIZE * 0.2);
    const sortedEntries = [...shopUuidCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    for (let i = 0; i < entriesToRemove && i < sortedEntries.length; i++) {
      shopUuidCache.delete(sortedEntries[i][0]);
    }
  }
}

export async function getShopUuidFromShopId(shopId: number): Promise<string | null> {
  cleanExpiredCacheEntries();
  
  const cached = shopUuidCache.get(shopId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const { data, error } = await supabase
      .from('apishopee_shops')
      .select('id')
      .eq('shop_id', shopId)
      .single();

    if (error || !data) {
      console.error('[Supabase] Failed to get shop UUID for shop_id:', shopId, error);
      return null;
    }

    ensureCacheSize();
    
    shopUuidCache.set(shopId, {
      value: data.id,
      timestamp: Date.now()
    });
    
    return data.id;
  } catch (err) {
    console.error('[Supabase] Error getting shop UUID:', err);
    return null;
  }
}

export function clearShopUuidCache(shopId?: number): void {
  if (shopId) {
    shopUuidCache.delete(shopId);
  } else {
    shopUuidCache.clear();
  }
}

/**
 * Force refresh session khi gặp lỗi JWT expired
 * Trả về true nếu refresh thành công
 */
export async function forceRefreshSession(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) {
      console.error('[Supabase] Failed to refresh session:', error);
      // Nếu refresh fail, sign out user
      await supabase.auth.signOut();
      return false;
    }
    console.log('[Supabase] Session refreshed successfully');
    return !!data.session;
  } catch (err) {
    console.error('[Supabase] Error refreshing session:', err);
    return false;
  }
}

/**
 * Check if error is JWT expired error
 */
export function isJwtExpiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  return err.code === 'PGRST303' || err.message?.includes('JWT expired') || false;
}
