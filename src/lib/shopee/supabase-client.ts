/**
 * Shopee API Client via Supabase Edge Functions
 * Gọi backend API để xử lý Shopee authentication
 */

import { supabase, isSupabaseConfigured } from '../supabase';
import type { AccessToken } from './types';

export { isSupabaseConfigured };

/**
 * Lấy URL xác thực OAuth từ backend
 * @param redirectUri - URL callback sau khi authorize
 * @param partnerAccountId - ID của partner account (optional, dùng default nếu không truyền)
 */
export async function getAuthorizationUrl(redirectUri: string, partnerAccountId?: string): Promise<string> {
  console.log('[Shopee] Calling shopee-auth with redirect_uri:', redirectUri, 'partner_account_id:', partnerAccountId);
  
  const { data, error } = await supabase.functions.invoke('shopee-auth', {
    body: { 
      action: 'get-auth-url', 
      redirect_uri: redirectUri,
      partner_account_id: partnerAccountId,
    },
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
 * @param code - Authorization code từ callback
 * @param shopId - Shop ID (optional)
 * @param partnerAccountId - ID của partner account (optional)
 */
export async function authenticateWithCode(
  code: string,
  shopId?: number,
  partnerAccountId?: string
): Promise<AccessToken> {
  console.log('[Shopee] authenticateWithCode called:', { code: code.substring(0, 10) + '...', shopId, partnerAccountId });
  
  const { data, error } = await supabase.functions.invoke('shopee-auth', {
    body: {
      action: 'get-token',
      code,
      shop_id: shopId,
      partner_account_id: partnerAccountId,
    },
  });

  console.log('[Shopee] authenticateWithCode response:', { data, error });

  if (error) {
    throw new Error(error.message || 'Failed to authenticate');
  }

  if (data.error) {
    throw new Error(data.message || data.error);
  }

  // Đảm bảo shop_id có giá trị (lấy từ param nếu API không trả về)
  const token: AccessToken = {
    ...data,
    shop_id: data.shop_id || shopId,
  };
  
  console.log('[Shopee] Final token:', { shop_id: token.shop_id, has_access_token: !!token.access_token });

  return token;
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
