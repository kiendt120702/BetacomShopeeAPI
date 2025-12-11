/**
 * API Wrapper với auto-refresh token
 * Tự động refresh token khi hết hạn và retry request
 */

import { getShopeeSDK } from './config';
import { getValidToken, refreshToken, getStoredToken } from './auth';

/**
 * Wrapper để gọi API với auto-refresh token
 * @param apiCall - Function gọi API
 * @returns Kết quả từ API
 */
export async function callWithAuth<T>(
  apiCall: () => Promise<T>
): Promise<T> {
  // Đảm bảo có token hợp lệ trước khi gọi API
  await getValidToken();

  try {
    return await apiCall();
  } catch (error: unknown) {
    // Kiểm tra nếu lỗi do token hết hạn
    if (isAuthError(error)) {
      console.log('[API] Auth error detected, refreshing token...');

      const token = await getStoredToken();
      if (token) {
        await refreshToken(token.shop_id, token.merchant_id);
        // Retry request sau khi refresh
        return await apiCall();
      }
    }

    throw error;
  }
}

/**
 * Kiểm tra lỗi có phải do authentication không
 */
function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;

  // Shopee API trả về error code 'error_auth' khi token invalid
  if (err.error === 'error_auth') return true;

  // Hoặc message chứa từ khóa liên quan đến token
  if (typeof err.message === 'string') {
    const msg = err.message.toLowerCase();
    return msg.includes('token') || msg.includes('auth') || msg.includes('unauthorized');
  }

  return false;
}

/**
 * Lấy SDK instance đã authenticated
 * Sử dụng khi cần truy cập trực tiếp các managers
 */
export async function getAuthenticatedSDK() {
  await getValidToken();
  return getShopeeSDK();
}

/**
 * Helper để gọi Product API
 */
export async function productAPI() {
  const sdk = await getAuthenticatedSDK();
  return sdk.product;
}

/**
 * Helper để gọi Order API
 */
export async function orderAPI() {
  const sdk = await getAuthenticatedSDK();
  return sdk.order;
}

/**
 * Helper để gọi Shop API
 */
export async function shopAPI() {
  const sdk = await getAuthenticatedSDK();
  return sdk.shop;
}

/**
 * Helper để gọi Logistics API
 */
export async function logisticsAPI() {
  const sdk = await getAuthenticatedSDK();
  return sdk.logistics;
}
