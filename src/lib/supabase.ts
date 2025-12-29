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

// Cache for shop UUID lookups to avoid repeated queries
const shopUuidCache = new Map<number, string>();

/**
 * Get the UUID (id) of a shop from its numeric Shopee shop_id
 * This is needed because apishopee_shops uses UUID as primary key,
 * but token.shop_id is the numeric Shopee shop ID
 */
export async function getShopUuidFromShopId(shopId: number): Promise<string | null> {
  // Check cache first
  if (shopUuidCache.has(shopId)) {
    return shopUuidCache.get(shopId) || null;
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

    // Cache the result
    shopUuidCache.set(shopId, data.id);
    return data.id;
  } catch (err) {
    console.error('[Supabase] Error getting shop UUID:', err);
    return null;
  }
}

/**
 * Clear the shop UUID cache (useful when shop data changes)
 */
export function clearShopUuidCache(shopId?: number): void {
  if (shopId) {
    shopUuidCache.delete(shopId);
  } else {
    shopUuidCache.clear();
  }
}
