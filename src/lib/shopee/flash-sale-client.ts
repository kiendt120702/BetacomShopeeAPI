/**
 * Flash Sale Cache Client
 * Quản lý cache cho Flash Sale data
 */

import { supabase } from '../supabase';

export interface FlashSale {
  flash_sale_id: number;
  timeslot_id: number;
  status: number;
  start_time: number;
  end_time: number;
  enabled_item_count: number;
  item_count: number;
  type: number;
  remindme_count: number;
  click_count: number;
}

export interface CachedFlashSale {
  id: string;
  shop_id: number;
  flash_sale_id: number;
  timeslot_id: number;
  status: number;
  start_time: number;
  end_time: number;
  enabled_item_count: number;
  item_count: number;
  type: number;
  remindme_count: number;
  click_count: number;
  raw_data: any;
  cached_at: string;
  updated_at: string;
}

/**
 * Lấy flash sales từ cache
 */
export async function getFlashSalesFromCache(shopId: number): Promise<CachedFlashSale[]> {
  const { data, error } = await supabase
    .from('apishopee_flash_sale_data')
    .select('*')
    .eq('shop_id', shopId)
    .order('type', { ascending: true }); // Sort by type: Đang chạy > Sắp tới > Kết thúc

  if (error) {
    console.error('[getFlashSalesFromCache] Error:', error);
    return [];
  }

  return data || [];
}

/**
 * Lưu flash sales vào cache
 */
export async function saveFlashSalesToCache(
  shopId: number,
  flashSales: FlashSale[]
): Promise<void> {
  if (!flashSales.length) return;

  const cacheData = flashSales.map(fs => ({
    shop_id: shopId,
    flash_sale_id: fs.flash_sale_id,
    timeslot_id: fs.timeslot_id,
    status: fs.status,
    start_time: fs.start_time,
    end_time: fs.end_time,
    enabled_item_count: fs.enabled_item_count,
    item_count: fs.item_count,
    type: fs.type,
    remindme_count: fs.remindme_count,
    click_count: fs.click_count,
    raw_data: fs,
    cached_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('apishopee_flash_sale_data')
    .upsert(cacheData, { onConflict: 'shop_id,flash_sale_id' });

  if (error) {
    console.error('[saveFlashSalesToCache] Error:', error);
  }
}

/**
 * Kiểm tra cache có cần refresh không (> 5 phút)
 */
export function isCacheStale(cachedAt: string, maxAgeMinutes = 5): boolean {
  const cacheTime = new Date(cachedAt).getTime();
  const now = Date.now();
  return (now - cacheTime) > maxAgeMinutes * 60 * 1000;
}