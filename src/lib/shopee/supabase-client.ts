/**
 * Shopee API Client via Supabase Edge Functions
 * Gọi backend API để xử lý Shopee authentication
 */

import { supabase, isSupabaseConfigured } from '../supabase';
import type { AccessToken } from './types';

export { isSupabaseConfigured };

/**
 * Lấy URL xác thực OAuth từ backend
 */
export async function getAuthorizationUrl(redirectUri: string): Promise<string> {
  console.log('[Shopee] Calling shopee-auth with redirect_uri:', redirectUri);
  
  const { data, error } = await supabase.functions.invoke('shopee-auth', {
    body: { action: 'get-auth-url', redirect_uri: redirectUri },
  });

  console.log('[Shopee] Response:', { data, error });

  if (error) {
    console.error('[Shopee] Error getting auth URL:', error);
    throw new Error(error.message || 'Failed to get auth URL');
  }

  if (!data?.auth_url) {
    console.error('[Shopee] No auth_url in response:', data);
    throw new Error('No auth URL returned from server');
  }

  return data.auth_url;
}

/**
 * Đổi code lấy access token
 */
export async function authenticateWithCode(
  code: string,
  shopId?: number,
  mainAccountId?: number
): Promise<AccessToken> {
  const { data, error } = await supabase.functions.invoke('shopee-auth', {
    body: {
      action: 'get-token',
      code,
      shop_id: shopId,
      main_account_id: mainAccountId,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to authenticate');
  }

  if (data.error) {
    throw new Error(data.message || data.error);
  }

  return data as AccessToken;
}

/**
 * Refresh access token
 */
export async function refreshToken(
  currentRefreshToken: string,
  shopId?: number,
  merchantId?: number
): Promise<AccessToken> {
  const { data, error } = await supabase.functions.invoke('shopee-auth', {
    body: {
      action: 'refresh-token',
      refresh_token: currentRefreshToken,
      shop_id: shopId,
      merchant_id: merchantId,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to refresh token');
  }

  if (data.error) {
    throw new Error(data.message || data.error);
  }

  return data as AccessToken;
}

/**
 * Lấy token đã lưu từ database
 */
export async function getStoredTokenFromDB(shopId: number): Promise<AccessToken | null> {
  const { data, error } = await supabase.functions.invoke('shopee-auth', {
    body: { action: 'get-stored-token', shop_id: shopId },
  });

  if (error || data?.error) {
    return null;
  }

  return data as AccessToken;
}
