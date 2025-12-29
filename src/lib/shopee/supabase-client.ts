/**
 * Shopee API Client via Supabase Edge Functions
 * Gọi backend API để xử lý Shopee authentication
 */

import { supabase, isSupabaseConfigured } from '../supabase';
import type { AccessToken } from './types';

export { isSupabaseConfigured };

interface PartnerInfo {
  partner_id: number;
  partner_key: string;
  partner_name?: string;
  partner_created_by?: string;
}

/**
 * Lấy URL xác thực OAuth từ backend
 * @param redirectUri - URL callback sau khi authorize
 * @param partnerAccountId - (deprecated) ID của partner account
 * @param partnerInfo - Partner credentials trực tiếp
 */
export async function getAuthorizationUrl(
  redirectUri: string,
  partnerAccountId?: string,
  partnerInfo?: PartnerInfo
): Promise<string> {
  console.log('[Shopee] getAuthorizationUrl called');
  console.log('[Shopee] redirect_uri:', redirectUri);
  console.log('[Shopee] partnerInfo:', partnerInfo ? { 
    partner_id: partnerInfo.partner_id, 
    partner_key: partnerInfo.partner_key?.substring(0, 10) + '...',
    partner_name: partnerInfo.partner_name 
  } : null);

  try {
    console.log('[Shopee] Invoking apishopee-auth Edge Function...');
    const { data, error } = await supabase.functions.invoke('apishopee-auth', {
      body: {
        action: 'get-auth-url',
        redirect_uri: redirectUri,
        partner_info: partnerInfo,
      },
    });

    console.log('[Shopee] Edge Function response:', { data, error });

    if (error) {
      console.error('[Shopee] Edge Function error:', error);
      throw new Error(error.message || 'Failed to get auth URL from Edge Function');
    }

    if (!data) {
      console.error('[Shopee] No data returned from Edge Function');
      throw new Error('No response data from server');
    }

    if (data.error) {
      console.error('[Shopee] Server returned error:', data.error, data.message);
      throw new Error(data.message || data.error || 'Server error');
    }

    if (!data.auth_url) {
      console.error('[Shopee] No auth_url in response:', data);
      throw new Error(data.message || 'No auth URL returned from server');
    }

    console.log('[Shopee] Got auth_url:', data.auth_url.substring(0, 100) + '...');
    return data.auth_url;
  } catch (err) {
    console.error('[Shopee] getAuthorizationUrl exception:', err);
    throw err;
  }
}

/**
 * Đổi code lấy access token
 * @param code - Authorization code từ callback
 * @param shopId - Shop ID (optional)
 * @param partnerAccountId - (deprecated) ID của partner account
 * @param partnerInfo - Partner credentials trực tiếp
 */
export async function authenticateWithCode(
  code: string,
  shopId?: number,
  partnerAccountId?: string,
  partnerInfo?: PartnerInfo
): Promise<AccessToken> {
  console.log('[Shopee] authenticateWithCode called:', { code: code.substring(0, 10) + '...', shopId, partnerInfo });

  const { data, error } = await supabase.functions.invoke('apishopee-auth', {
    body: {
      action: 'get-token',
      code,
      shop_id: shopId,
      partner_info: partnerInfo,
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
  const { data, error } = await supabase.functions.invoke('apishopee-auth', {
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
  const { data, error } = await supabase.functions.invoke('apishopee-auth', {
    body: { action: 'get-stored-token', shop_id: shopId },
  });

  if (error || data?.error) {
    return null;
  }

  return data as AccessToken;
}
