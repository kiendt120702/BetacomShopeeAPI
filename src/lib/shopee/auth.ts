/**
 * Shopee Authentication
 * Xác thực OAuth 2.0 theo docs/guides/authentication.md
 */

import { getShopeeSDK } from './config';
import type { AccessToken } from './types';

/**
 * Tạo URL xác thực để redirect user đến Shopee
 * @param callbackUrl - URL callback sau khi user authorize
 */
export function getAuthorizationUrl(callbackUrl: string): string {
  const sdk = getShopeeSDK();
  return sdk.getAuthorizationUrl(callbackUrl);
}

/**
 * Đổi authorization code lấy access token
 * @param code - Authorization code từ callback
 * @param shopId - Shop ID (optional)
 * @param mainAccountId - Main account ID cho multi-shop (optional)
 */
export async function authenticateWithCode(
  code: string,
  shopId?: number,
  mainAccountId?: number
): Promise<AccessToken> {
  const sdk = getShopeeSDK();
  return await sdk.authenticateWithCode(code, shopId, mainAccountId);
}

/**
 * Lấy token đã lưu
 */
export async function getStoredToken(): Promise<AccessToken | null> {
  const sdk = getShopeeSDK();
  return await sdk.getAuthToken();
}

/**
 * Refresh token khi hết hạn
 * @param shopId - Shop ID (optional, dùng từ token đã lưu nếu không truyền)
 * @param merchantId - Merchant ID cho main account (optional)
 */
export async function refreshToken(
  shopId?: number,
  merchantId?: number
): Promise<AccessToken> {
  const sdk = getShopeeSDK();
  return await sdk.refreshToken(shopId, merchantId);
}

/**
 * Kiểm tra token còn hạn không
 * @param bufferMinutes - Số phút buffer trước khi hết hạn (default: 5)
 */
export async function isTokenValid(bufferMinutes = 5): Promise<boolean> {
  const token = await getStoredToken();
  
  if (!token) return false;
  
  if (!token.expired_at) return true; // Không có expiry thì coi như valid
  
  const now = Date.now();
  const bufferMs = bufferMinutes * 60 * 1000;
  
  return now < token.expired_at - bufferMs;
}

/**
 * Lấy token hợp lệ, tự động refresh nếu cần
 */
export async function getValidToken(): Promise<AccessToken> {
  const isValid = await isTokenValid();
  
  if (!isValid) {
    const token = await getStoredToken();
    if (!token) {
      throw new Error('No token found. Please authenticate first.');
    }
    
    console.log('[AUTH] Token expired or expiring soon, refreshing...');
    return await refreshToken(token.shop_id, token.merchant_id);
  }
  
  const token = await getStoredToken();
  if (!token) {
    throw new Error('No token found. Please authenticate first.');
  }
  
  return token;
}

/**
 * Xử lý callback từ Shopee OAuth
 * Parse URL params và authenticate
 */
export async function handleOAuthCallback(
  searchParams: URLSearchParams
): Promise<AccessToken> {
  const code = searchParams.get('code');
  const shopId = searchParams.get('shop_id');
  
  if (!code) {
    throw new Error('Missing authorization code in callback');
  }
  
  return await authenticateWithCode(
    code,
    shopId ? Number(shopId) : undefined
  );
}
