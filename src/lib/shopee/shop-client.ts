/**
 * Shopee Shop API Client via Supabase Edge Functions
 * Gọi backend API để lấy thông tin Shop với Caching
 */

import { supabase } from '../supabase';
import type { GetShopInfoResponse, GetShopProfileResponse } from './types';

export interface FullShopInfoResponse {
  info: GetShopInfoResponse;
  profile: GetShopProfileResponse;
  cached: boolean;
  cached_at?: string;
}

/**
 * Lấy đầy đủ thông tin shop (info + profile) với caching
 * Cache 30 phút, tự động refresh khi hết hạn
 */
export async function getFullShopInfo(
  shopId: number,
  forceRefresh = false
): Promise<FullShopInfoResponse> {
  const { data, error } = await supabase.functions.invoke('apishopee-shop', {
    body: {
      action: 'get-full-info',
      shop_id: shopId,
      force_refresh: forceRefresh,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to get shop info');
  }

  return data as FullShopInfoResponse;
}

/**
 * Lấy thông tin shop (không cache)
 * GET /api/v2/shop/get_shop_info
 */
export async function getShopInfo(shopId: number): Promise<GetShopInfoResponse> {
  const { data, error } = await supabase.functions.invoke('apishopee-shop', {
    body: {
      action: 'get-shop-info',
      shop_id: shopId,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to get shop info');
  }

  return data as GetShopInfoResponse;
}

/**
 * Lấy profile shop (không cache)
 * GET /api/v2/shop/get_profile
 */
export async function getShopProfile(shopId: number): Promise<GetShopProfileResponse> {
  const { data, error } = await supabase.functions.invoke('apishopee-shop', {
    body: {
      action: 'get-profile',
      shop_id: shopId,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to get shop profile');
  }

  return data as GetShopProfileResponse;
}


