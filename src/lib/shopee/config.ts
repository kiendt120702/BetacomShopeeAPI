/**
 * Shopee SDK Configuration
 * Cấu hình SDK theo docs/guides/setup.md
 */

import { ShopeeSDK } from '@congminh1254/shopee-sdk';
import { createAutoStorage, type StorageType } from './storage';

// Định nghĩa ShopeeRegion local (tương thích với SDK)
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

// Environment variables - thay đổi theo môi trường của bạn
export const SHOPEE_CONFIG = {
  partner_id: Number(process.env.NEXT_PUBLIC_SHOPEE_PARTNER_ID) || 0,
  partner_key: process.env.NEXT_PUBLIC_SHOPEE_PARTNER_KEY || '',
  region: ShopeeRegion.VN, // Vietnam region
  shop_id: Number(process.env.NEXT_PUBLIC_SHOPEE_SHOP_ID) || undefined,
};

// Base URLs
export const SHOPEE_BASE_URL = {
  PRODUCTION: undefined, // SDK tự động chọn theo region
  SANDBOX: 'https://partner.test-stable.shopeemobile.com',
};

// Storage type setting
let currentStorageType: StorageType = 'localStorage';

// Kiểm tra config hợp lệ
export function isConfigValid(): boolean {
  return SHOPEE_CONFIG.partner_id > 0 && SHOPEE_CONFIG.partner_key.length > 0;
}

// Set storage type
export function setStorageType(type: StorageType): void {
  currentStorageType = type;
  resetShopeeSDK(); // Reset để tạo lại với storage mới
}

// Tạo SDK instance với custom storage
export function createShopeeSDK(useSandbox = false): ShopeeSDK {
  const config = {
    partner_id: SHOPEE_CONFIG.partner_id,
    partner_key: SHOPEE_CONFIG.partner_key,
    shop_id: SHOPEE_CONFIG.shop_id,
    base_url: useSandbox ? SHOPEE_BASE_URL.SANDBOX : undefined,
  };

  // Sử dụng auto storage - cast as any để bypass type check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = createAutoStorage(SHOPEE_CONFIG.shop_id) as any;

  return new ShopeeSDK(config, storage);
}

// Singleton SDK instance
let sdkInstance: ShopeeSDK | null = null;

export function getShopeeSDK(useSandbox = false): ShopeeSDK {
  if (!sdkInstance) {
    sdkInstance = createShopeeSDK(useSandbox);
  }
  return sdkInstance;
}

// Reset SDK instance (useful khi thay đổi config)
export function resetShopeeSDK(): void {
  sdkInstance = null;
}

// Get current storage type
export function getStorageType(): StorageType {
  return currentStorageType;
}

export type { StorageType };
