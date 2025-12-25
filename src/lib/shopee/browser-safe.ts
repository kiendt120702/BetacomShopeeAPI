/**
 * Browser-safe Shopee SDK wrapper
 * SDK gốc chỉ chạy trên Node.js, file này cung cấp mock cho browser
 * 
 * LƯU Ý: Để sử dụng đầy đủ tính năng, bạn cần:
 * 1. Tạo backend API (Express, Fastify, etc.)
 * 2. Gọi Shopee SDK từ backend
 * 3. Frontend gọi API của bạn
 */

import type { AccessToken } from './types';
import { LocalStorageTokenStorage } from './storage/local-storage';

// Kiểm tra môi trường
export const isServer = typeof window === 'undefined';
export const isBrowser = !isServer;

// Config từ env
export const SHOPEE_CONFIG = {
  partner_id: Number(import.meta.env.VITE_SHOPEE_PARTNER_ID) || 0,
  partner_key: import.meta.env.VITE_SHOPEE_PARTNER_KEY || '',
  shop_id: Number(import.meta.env.VITE_SHOPEE_SHOP_ID) || undefined,
  callback_url: import.meta.env.VITE_SHOPEE_CALLBACK_URL || 'https://ops.betacom.agency/auth/callback',
};

// Shopee Region enum
export enum ShopeeRegion {
  GLOBAL = 'GLOBAL',
  SG = 'SG',
  MY = 'MY',
  TH = 'TH',
  VN = 'VN',
  PH = 'PH',
  ID = 'ID',
  TW = 'TW',
  BR = 'BR',
  MX = 'MX',
  CO = 'CO',
  CL = 'CL',
  PL = 'PL',
}

// Base URLs
const BASE_URLS: Record<string, string> = {
  GLOBAL: 'https://partner.shopeemobile.com',
  SANDBOX: 'https://partner.test-stable.shopeemobile.com',
};

// Token storage instance
const tokenStorage = new LocalStorageTokenStorage();

/**
 * Kiểm tra config hợp lệ
 */
export function isConfigValid(): boolean {
  return SHOPEE_CONFIG.partner_id > 0 && SHOPEE_CONFIG.partner_key.length > 0;
}

/**
 * Tạo signature cho Shopee API
 */
function createSignature(path: string, timestamp: number): string {
  // Browser không có crypto.createHmac, cần dùng Web Crypto API
  // Tạm thời return empty - cần implement với SubtleCrypto
  console.warn('[Shopee] Signature generation requires backend implementation');
  return '';
}

/**
 * Tạo URL xác thực OAuth
 * URL này redirect user đến trang đăng nhập Shopee
 */
export function getAuthorizationUrl(redirectUri?: string): string {
  const callback = redirectUri || SHOPEE_CONFIG.callback_url;
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/shop/auth_partner';
  
  // Shopee auth URL format
  const baseUrl = BASE_URLS.GLOBAL;
  const params = new URLSearchParams({
    partner_id: SHOPEE_CONFIG.partner_id.toString(),
    timestamp: timestamp.toString(),
    redirect: callback,
  });

  // Note: Signature cần được tạo ở backend
  // Format: SHA256(partner_id + path + timestamp + partner_key)
  
  return `${baseUrl}${path}?${params.toString()}`;
}

/**
 * Lấy token đã lưu
 */
export async function getStoredToken(): Promise<AccessToken | null> {
  return await tokenStorage.get();
}

/**
 * Lưu token
 */
export async function storeToken(token: AccessToken): Promise<void> {
  await tokenStorage.store(token);
}

/**
 * Xóa token
 */
export async function clearToken(): Promise<void> {
  await tokenStorage.clear();
}

/**
 * Kiểm tra token còn hạn không
 */
export async function isTokenValid(bufferMinutes = 5): Promise<boolean> {
  const token = await getStoredToken();
  
  if (!token) return false;
  if (!token.expired_at) return true;
  
  const now = Date.now();
  const bufferMs = bufferMinutes * 60 * 1000;
  
  return now < token.expired_at - bufferMs;
}

/**
 * Mock authenticate - Trong thực tế cần gọi backend API
 */
export async function authenticateWithCode(
  code: string,
  shopId?: number
): Promise<AccessToken> {
  // ⚠️ QUAN TRỌNG: Đây chỉ là mock
  // Thực tế bạn cần:
  // 1. Gửi code đến backend của bạn
  // 2. Backend gọi Shopee API với SDK
  // 3. Backend trả về token cho frontend
  
  console.warn('[Shopee] authenticateWithCode requires backend implementation');
  console.log('[Shopee] Received code:', code, 'shopId:', shopId);
  
  // Mock token để test UI
  const mockToken: AccessToken = {
    access_token: 'mock_access_token_' + Date.now(),
    refresh_token: 'mock_refresh_token_' + Date.now(),
    expire_in: 14400, // 4 hours
    expired_at: Date.now() + 14400 * 1000,
    shop_id: shopId,
    request_id: 'mock_request_' + Date.now(),
  };
  
  await storeToken(mockToken);
  return mockToken;
}

/**
 * Mock refresh token - Trong thực tế cần gọi backend API
 */
export async function refreshToken(
  shopId?: number,
  merchantId?: number
): Promise<AccessToken> {
  console.warn('[Shopee] refreshToken requires backend implementation');
  
  const currentToken = await getStoredToken();
  
  const newToken: AccessToken = {
    access_token: 'mock_refreshed_token_' + Date.now(),
    refresh_token: currentToken?.refresh_token || 'mock_refresh_' + Date.now(),
    expire_in: 14400,
    expired_at: Date.now() + 14400 * 1000,
    shop_id: shopId || currentToken?.shop_id,
    merchant_id: merchantId,
    request_id: 'mock_request_' + Date.now(),
  };
  
  await storeToken(newToken);
  return newToken;
}

/**
 * Xử lý OAuth callback
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
