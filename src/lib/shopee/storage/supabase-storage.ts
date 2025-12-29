/**
 * Supabase Token Storage
 * Lưu token vào bảng `apishopee_shops` trong Supabase
 * 
 * Schema: apishopee_shops có shop_id là unique (1 shop = 1 row chứa cả token + info)
 */

import type { TokenStorage } from './token-storage.interface';
import type { AccessToken } from '../types';
import { supabase } from '../../supabase';

export class SupabaseTokenStorage implements TokenStorage {
  private shopId?: number;

  constructor(shopId?: number) {
    this.shopId = shopId;
  }

  /**
   * Set shop ID
   */
  setShopId(shopId: number): void {
    this.shopId = shopId;
  }

  async store(token: AccessToken): Promise<void> {
    const shopId = this.shopId || token.shop_id;
    if (!shopId) {
      throw new Error('Shop ID is required to store token');
    }

    try {
      // Check if shop exists
      const { data: existing } = await supabase
        .from('apishopee_shops')
        .select('id')
        .eq('shop_id', shopId)
        .single();

      const tokenData = {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expire_in: token.expire_in,
        expired_at: token.expired_at || Date.now() + token.expire_in * 1000,
        merchant_id: token.merchant_id,
        token_updated_at: new Date().toISOString(),
      };

      let error;
      if (existing) {
        // Update existing shop
        const result = await supabase
          .from('apishopee_shops')
          .update(tokenData)
          .eq('id', existing.id);
        error = result.error;
      } else {
        // Insert new shop
        const result = await supabase
          .from('apishopee_shops')
          .insert({ shop_id: shopId, ...tokenData });
        error = result.error;
      }

      if (error) {
        console.error('[SupabaseTokenStorage] Failed to store token:', error);
        throw error;
      }

      console.log(`[SupabaseTokenStorage] Token stored for shop ${shopId}`);
    } catch (error) {
      console.error('[SupabaseTokenStorage] Store error:', error);
      throw error;
    }
  }

  async get(): Promise<AccessToken | null> {
    if (!this.shopId) {
      console.warn('[SupabaseTokenStorage] Missing shop_id');
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('apishopee_shops')
        .select('access_token, refresh_token, expire_in, expired_at, shop_id, merchant_id')
        .eq('shop_id', this.shopId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('[SupabaseTokenStorage] Failed to get token:', error);
        return null;
      }

      if (!data || !data.access_token) return null;

      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expire_in: data.expire_in,
        expired_at: data.expired_at,
        shop_id: data.shop_id,
        merchant_id: data.merchant_id,
      };
    } catch (error) {
      console.error('[SupabaseTokenStorage] Get error:', error);
      return null;
    }
  }

  async clear(): Promise<void> {
    if (!this.shopId) {
      console.warn('[SupabaseTokenStorage] Missing shop_id');
      return;
    }

    try {
      // Chỉ clear token, không xóa shop
      const { error } = await supabase
        .from('apishopee_shops')
        .update({
          access_token: null,
          refresh_token: null,
          expired_at: null,
          token_updated_at: null,
        })
        .eq('shop_id', this.shopId);

      if (error) {
        console.error('[SupabaseTokenStorage] Failed to clear token:', error);
        throw error;
      }

      console.log(`[SupabaseTokenStorage] Token cleared for shop ${this.shopId}`);
    } catch (error) {
      console.error('[SupabaseTokenStorage] Clear error:', error);
      throw error;
    }
  }

  /**
   * Kiểm tra token có hết hạn không
   */
  async isTokenExpired(bufferMinutes = 5): Promise<boolean> {
    const token = await this.get();
    if (!token) return true;
    if (!token.expired_at) return false;

    const now = Date.now();
    const bufferMs = bufferMinutes * 60 * 1000;
    return now >= token.expired_at - bufferMs;
  }

  /**
   * Lấy token theo shop_id (static method)
   */
  static async getByShopId(shopId: number): Promise<AccessToken | null> {
    const storage = new SupabaseTokenStorage(shopId);
    return storage.get();
  }
}
