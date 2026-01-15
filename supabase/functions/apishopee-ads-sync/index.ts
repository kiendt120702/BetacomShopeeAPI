/**
 * Supabase Edge Function: Shopee Ads Sync Worker
 * Background sync worker để đồng bộ Ads data từ Shopee
 * 
 * Mô hình Realtime:
 * 1. Worker gọi Shopee API định kỳ (15 phút/lần)
 * 2. Lưu/Cập nhật dữ liệu vào DB (upsert để tránh trùng lặp)
 * 3. Supabase Realtime tự động bắn tín hiệu UPDATE/INSERT xuống Frontend
 * 4. Frontend tự cập nhật giao diện mà không cần F5
 * 
 * Actions:
 * - sync: Sync toàn bộ campaigns và performance data
 * - status: Lấy trạng thái sync hiện tại
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SHOPEE_HOST = 'https://partner.shopeemobile.com';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// ==================== TYPES ====================

interface ShopCredentials {
  access_token: string;
  refresh_token: string;
  partner_id: number;
  partner_key: string;
}

interface CampaignInfo {
  campaign_id: number;
  ad_type: 'auto' | 'manual';
  name?: string;
  status?: string;
  campaign_budget?: number;
  campaign_placement?: string;
  bidding_method?: string;
  roas_target?: number | null;
  start_time?: number;
  end_time?: number;
  item_count?: number;
}

interface PerformanceMetrics {
  impression: number;
  clicks: number;
  ctr: number;
  expense: number;
  direct_order: number;
  direct_gmv: number;
  broad_order: number;
  broad_gmv: number;
  direct_item_sold: number;
  broad_item_sold: number;
}

// ==================== HELPER FUNCTIONS ====================

async function hmacSha256(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getShopCredentials(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<ShopCredentials> {
  const { data: shop, error } = await supabase
    .from('apishopee_shops')
    .select('access_token, refresh_token, partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  if (error || !shop) {
    throw new Error('Shop not found');
  }

  if (!shop.access_token || !shop.partner_id || !shop.partner_key) {
    throw new Error('Shop credentials incomplete');
  }

  return shop as ShopCredentials;
}

async function callShopeeAPI(
  credentials: ShopCredentials,
  shopId: number,
  apiPath: string,
  method: 'GET' | 'POST',
  params?: Record<string, string | number>,
  body?: Record<string, unknown>
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${credentials.partner_id}${apiPath}${timestamp}${credentials.access_token}${shopId}`;
  const sign = await hmacSha256(credentials.partner_key, baseString);

  const queryParams = new URLSearchParams();
  queryParams.set('partner_id', credentials.partner_id.toString());
  queryParams.set('timestamp', timestamp.toString());
  queryParams.set('access_token', credentials.access_token);
  queryParams.set('shop_id', shopId.toString());
  queryParams.set('sign', sign);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.set(key, String(value));
      }
    }
  }

  const url = `${SHOPEE_HOST}${apiPath}?${queryParams.toString()}`;
  console.log(`[ADS-SYNC] ${method} ${apiPath}`);

  const fetchOptions: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body && method === 'POST') {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);
  return await response.json();
}

// Get current date in Vietnam timezone (GMT+7)
function getVietnamDate(): Date {
  const now = new Date();
  // Convert UTC to Vietnam time (UTC+7)
  const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vnTime;
}

// Format date to DD-MM-YYYY for Shopee API (using Vietnam timezone)
function formatDateForShopee(date: Date): string {
  // Use UTC methods since we already converted to VN time
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

// Format date to YYYY-MM-DD for database (using Vietnam timezone)
function formatDateForDB(date: Date): string {
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${year}-${month}-${day}`;
}

// ==================== SYNC FUNCTIONS ====================

/**
 * Sync campaigns từ Shopee API
 * Sử dụng UPSERT để tránh trùng lặp
 */
async function syncCampaigns(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number
): Promise<{ total: number; ongoing: number; campaigns: CampaignInfo[] }> {
  console.log('[ADS-SYNC] Syncing campaigns...');

  // Step 1: Lấy danh sách campaign IDs
  const idListResult = await callShopeeAPI(
    credentials,
    shopId,
    '/api/v2/ads/get_product_level_campaign_id_list',
    'GET',
    { ad_type: 'all', offset: 0, limit: 5000 }
  );

  if (idListResult.error) {
    throw new Error(`Failed to get campaign list: ${idListResult.message || idListResult.error}`);
  }

  const campaignList = idListResult.response?.campaign_list || [];
  if (campaignList.length === 0) {
    console.log('[ADS-SYNC] No campaigns found');
    return { total: 0, ongoing: 0, campaigns: [] };
  }

  console.log(`[ADS-SYNC] Found ${campaignList.length} campaigns`);

  // Step 2: Lấy chi tiết từng batch 100 campaigns
  const allCampaigns: CampaignInfo[] = [];
  const batchSize = 100;

  for (let i = 0; i < campaignList.length; i += batchSize) {
    const batch = campaignList.slice(i, i + batchSize);
    const campaignIds = batch.map((c: { campaign_id: number }) => c.campaign_id).join(',');

    const detailResult = await callShopeeAPI(
      credentials,
      shopId,
      '/api/v2/ads/get_product_level_campaign_setting_info',
      'GET',
      { campaign_id_list: campaignIds, info_type_list: '1,3' }
    );

    if (detailResult.response?.campaign_list) {
      for (const detail of detailResult.response.campaign_list) {
        const original = batch.find((c: { campaign_id: number }) => c.campaign_id === detail.campaign_id);
        allCampaigns.push({
          campaign_id: detail.campaign_id,
          ad_type: original?.ad_type || detail.common_info?.ad_type || 'auto',
          name: detail.common_info?.ad_name,
          status: detail.common_info?.campaign_status,
          campaign_budget: detail.common_info?.campaign_budget,
          campaign_placement: detail.common_info?.campaign_placement,
          bidding_method: detail.common_info?.bidding_method,
          roas_target: detail.auto_bidding_info?.roas_target || null,
          start_time: detail.common_info?.campaign_duration?.start_time,
          end_time: detail.common_info?.campaign_duration?.end_time,
          item_count: detail.common_info?.item_id_list?.length || 0,
        });
      }
    }
  }

  // Step 3: UPSERT vào database (tránh trùng lặp)
  const now = new Date().toISOString();
  const upsertData = allCampaigns.map(c => ({
    shop_id: shopId,
    campaign_id: c.campaign_id,
    ad_type: c.ad_type,
    name: c.name || null,
    status: c.status || null,
    campaign_placement: c.campaign_placement || null,
    bidding_method: c.bidding_method || null,
    campaign_budget: c.campaign_budget || 0,
    start_time: c.start_time || null,
    end_time: c.end_time || null,
    item_count: c.item_count || 0,
    roas_target: c.roas_target,
    synced_at: now,
    cached_at: now,
  }));

  const { error: upsertError } = await supabase
    .from('apishopee_ads_campaign_data')
    .upsert(upsertData, { onConflict: 'shop_id,campaign_id' });

  if (upsertError) {
    console.error('[ADS-SYNC] Upsert campaigns error:', upsertError);
    throw new Error(`Failed to save campaigns: ${upsertError.message}`);
  }

  const ongoingCount = allCampaigns.filter(c => c.status === 'ongoing').length;
  console.log(`[ADS-SYNC] Synced ${allCampaigns.length} campaigns (${ongoingCount} ongoing)`);

  return {
    total: allCampaigns.length,
    ongoing: ongoingCount,
    campaigns: allCampaigns.filter(c => c.status === 'ongoing'),
  };
}

/**
 * Sync daily performance cho các campaigns đang chạy
 * Lấy 7 ngày gần nhất
 */
async function syncDailyPerformance(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number,
  campaigns: CampaignInfo[]
): Promise<number> {
  if (campaigns.length === 0) return 0;

  console.log(`[ADS-SYNC] Syncing daily performance for ${campaigns.length} campaigns...`);

  // Sử dụng Vietnam timezone để lấy đúng ngày
  const today = getVietnamDate();
  const sevenDaysAgo = new Date(today.getTime());
  sevenDaysAgo.setUTCDate(today.getUTCDate() - 6);

  const startDate = formatDateForShopee(sevenDaysAgo);
  const endDate = formatDateForShopee(today);
  
  console.log(`[ADS-SYNC] Date range: ${startDate} to ${endDate} (VN timezone)`);
  
  const campaignIds = campaigns.map(c => c.campaign_id).join(',');

  const perfResult = await callShopeeAPI(
    credentials,
    shopId,
    '/api/v2/ads/get_product_campaign_daily_performance',
    'GET',
    { start_date: startDate, end_date: endDate, campaign_id_list: campaignIds }
  );

  if (perfResult.error) {
    console.error('[ADS-SYNC] Daily performance error:', perfResult.message || perfResult.error);
    return 0;
  }

  const campaignPerfList = perfResult.response?.campaign_list || [];
  if (campaignPerfList.length === 0) {
    console.log('[ADS-SYNC] No daily performance data');
    return 0;
  }

  // Prepare upsert data
  const now = new Date().toISOString();
  const upsertData: Array<{
    shop_id: number;
    campaign_id: number;
    performance_date: string;
    impression: number;
    clicks: number;
    ctr: number;
    expense: number;
    direct_order: number;
    direct_gmv: number;
    broad_order: number;
    broad_gmv: number;
    direct_item_sold: number;
    broad_item_sold: number;
    roas: number;
    acos: number;
    synced_at: string;
  }> = [];

  for (const campPerf of campaignPerfList) {
    const metricsList = campPerf.metrics_list || campPerf.performance_list || [];
    
    for (const dayMetrics of metricsList) {
      // Parse date from DD-MM-YYYY to YYYY-MM-DD
      const dateParts = dayMetrics.date?.split('-') || [];
      let perfDate: string;
      if (dateParts.length === 3) {
        perfDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
      } else {
        continue; // Skip if date is invalid
      }

      const expense = dayMetrics.expense || 0;
      const broadGmv = dayMetrics.broad_gmv || 0;
      const roas = expense > 0 ? broadGmv / expense : 0;
      const acos = broadGmv > 0 ? (expense / broadGmv) * 100 : 0;

      upsertData.push({
        shop_id: shopId,
        campaign_id: campPerf.campaign_id,
        performance_date: perfDate,
        impression: dayMetrics.impression || 0,
        clicks: dayMetrics.clicks || 0,
        ctr: dayMetrics.ctr || 0,
        expense,
        direct_order: dayMetrics.direct_order || 0,
        direct_gmv: dayMetrics.direct_gmv || 0,
        broad_order: dayMetrics.broad_order || 0,
        broad_gmv: broadGmv,
        direct_item_sold: dayMetrics.direct_item_sold || 0,
        broad_item_sold: dayMetrics.broad_item_sold || 0,
        roas,
        acos,
        synced_at: now,
      });
    }
  }

  if (upsertData.length === 0) {
    console.log('[ADS-SYNC] No daily performance records to save');
    return 0;
  }

  // UPSERT để tránh trùng lặp
  const { error: upsertError } = await supabase
    .from('apishopee_ads_performance_daily')
    .upsert(upsertData, { onConflict: 'shop_id,campaign_id,performance_date' });

  if (upsertError) {
    console.error('[ADS-SYNC] Upsert daily performance error:', upsertError);
    throw new Error(`Failed to save daily performance: ${upsertError.message}`);
  }

  console.log(`[ADS-SYNC] Synced ${upsertData.length} daily performance records`);
  return upsertData.length;
}

/**
 * Sync hourly performance cho ngày hôm nay
 */
async function syncHourlyPerformance(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number,
  campaigns: CampaignInfo[]
): Promise<number> {
  if (campaigns.length === 0) return 0;

  console.log(`[ADS-SYNC] Syncing hourly performance for ${campaigns.length} campaigns...`);

  // Sử dụng Vietnam timezone
  const today = getVietnamDate();
  const dateStr = formatDateForShopee(today);
  const dbDate = formatDateForDB(today);
  
  console.log(`[ADS-SYNC] Hourly date: ${dateStr} (VN timezone)`);
  
  const campaignIds = campaigns.map(c => c.campaign_id).join(',');

  const perfResult = await callShopeeAPI(
    credentials,
    shopId,
    '/api/v2/ads/get_product_campaign_hourly_performance',
    'GET',
    { performance_date: dateStr, campaign_id_list: campaignIds }
  );

  if (perfResult.error) {
    console.error('[ADS-SYNC] Hourly performance error:', perfResult.message || perfResult.error);
    return 0;
  }

  const campaignPerfList = perfResult.response?.campaign_list || [];
  if (campaignPerfList.length === 0) {
    console.log('[ADS-SYNC] No hourly performance data');
    return 0;
  }

  // Prepare upsert data
  const now = new Date().toISOString();
  const upsertData: Array<{
    shop_id: number;
    campaign_id: number;
    performance_date: string;
    hour: number;
    impression: number;
    clicks: number;
    ctr: number;
    expense: number;
    direct_order: number;
    direct_gmv: number;
    broad_order: number;
    broad_gmv: number;
    direct_item_sold: number;
    broad_item_sold: number;
    roas: number;
    acos: number;
    synced_at: string;
  }> = [];

  for (const campPerf of campaignPerfList) {
    const metricsList = campPerf.metrics_list || [];
    
    for (const hourMetrics of metricsList) {
      const expense = hourMetrics.expense || 0;
      const broadGmv = hourMetrics.broad_gmv || 0;
      const roas = expense > 0 ? broadGmv / expense : 0;
      const acos = broadGmv > 0 ? (expense / broadGmv) * 100 : 0;

      upsertData.push({
        shop_id: shopId,
        campaign_id: campPerf.campaign_id,
        performance_date: dbDate,
        hour: hourMetrics.hour,
        impression: hourMetrics.impression || 0,
        clicks: hourMetrics.clicks || 0,
        ctr: hourMetrics.ctr || 0,
        expense,
        direct_order: hourMetrics.direct_order || 0,
        direct_gmv: hourMetrics.direct_gmv || 0,
        broad_order: hourMetrics.broad_order || 0,
        broad_gmv: broadGmv,
        direct_item_sold: hourMetrics.direct_item_sold || 0,
        broad_item_sold: hourMetrics.broad_item_sold || 0,
        roas,
        acos,
        synced_at: now,
      });
    }
  }

  if (upsertData.length === 0) {
    console.log('[ADS-SYNC] No hourly performance records to save');
    return 0;
  }

  // UPSERT để tránh trùng lặp
  const { error: upsertError } = await supabase
    .from('apishopee_ads_performance_hourly')
    .upsert(upsertData, { onConflict: 'shop_id,campaign_id,performance_date,hour' });

  if (upsertError) {
    console.error('[ADS-SYNC] Upsert hourly performance error:', upsertError);
    throw new Error(`Failed to save hourly performance: ${upsertError.message}`);
  }

  console.log(`[ADS-SYNC] Synced ${upsertData.length} hourly performance records`);
  return upsertData.length;
}

/**
 * Sync shop-level daily performance (tổng hợp tất cả ads)
 * Sử dụng API get_all_cpc_ads_daily_performance - giống như Response button
 * LƯU VÀO BẢNG RIÊNG để hiển thị chính xác
 * 
 * Nếu API trả về rỗng → fallback tính tổng từ campaign-level
 */
async function syncShopLevelDailyPerformance(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number
): Promise<{ impression: number; clicks: number; orders: number; gmv: number; expense: number }> {
  console.log('[ADS-SYNC] Syncing shop-level daily performance...');

  // Sử dụng Vietnam timezone - lấy 7 ngày gần nhất
  const today = getVietnamDate();
  const sevenDaysAgo = new Date(today.getTime());
  sevenDaysAgo.setUTCDate(today.getUTCDate() - 6);
  
  const startDate = formatDateForShopee(sevenDaysAgo);
  const endDate = formatDateForShopee(today);
  
  console.log(`[ADS-SYNC] Shop-level date range: ${startDate} to ${endDate} (VN timezone)`);

  const perfResult = await callShopeeAPI(
    credentials,
    shopId,
    '/api/v2/ads/get_all_cpc_ads_daily_performance',
    'GET',
    { start_date: startDate, end_date: endDate }
  );

  console.log('[ADS-SYNC] Shop-level daily response:', JSON.stringify(perfResult).substring(0, 1000));

  let hasShopLevelData = false;
  
  if (!perfResult.error) {
    // Parse response - có thể là array hoặc object
    const metricsList = perfResult.response?.metrics_list || perfResult.response?.performance_list || [];
    
    if (metricsList.length > 0) {
      hasShopLevelData = true;
      const now = new Date().toISOString();
      
      // Lưu từng ngày vào DB
      for (const dayMetrics of metricsList) {
        // Parse date from DD-MM-YYYY to YYYY-MM-DD
        const dateParts = dayMetrics.date?.split('-') || [];
        let perfDate: string;
        if (dateParts.length === 3) {
          perfDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
        } else {
          continue;
        }

        const expense = dayMetrics.expense || 0;
        const broadGmv = dayMetrics.broad_gmv || 0;
        const impression = dayMetrics.impression || 0;
        const clicks = dayMetrics.clicks || 0;
        
        const ctr = impression > 0 ? (clicks / impression) * 100 : 0;
        const roas = expense > 0 ? broadGmv / expense : 0;
        const acos = broadGmv > 0 ? (expense / broadGmv) * 100 : 0;

        const { error: upsertError } = await supabase
          .from('apishopee_ads_shop_performance_daily')
          .upsert({
            shop_id: shopId,
            performance_date: perfDate,
            impression,
            clicks,
            ctr,
            expense,
            direct_order: dayMetrics.direct_order || 0,
            direct_gmv: dayMetrics.direct_gmv || 0,
            broad_order: dayMetrics.broad_order || 0,
            broad_gmv: broadGmv,
            direct_item_sold: dayMetrics.direct_item_sold || 0,
            broad_item_sold: dayMetrics.broad_item_sold || 0,
            roas,
            acos,
            synced_at: now,
          }, { onConflict: 'shop_id,performance_date' });

        if (upsertError) {
          console.error(`[ADS-SYNC] Upsert shop-level daily error for ${perfDate}:`, upsertError);
        }
      }
      
      console.log(`[ADS-SYNC] Saved ${metricsList.length} shop-level daily records from API`);
    }
  }

  // Fallback: Nếu API shop-level không có dữ liệu, tính tổng từ campaign-level
  if (!hasShopLevelData) {
    console.log('[ADS-SYNC] Shop-level API returned empty, calculating from campaign-level data...');
    
    // Lấy 7 ngày gần nhất từ campaign-level
    const dbStartDate = formatDateForDB(sevenDaysAgo);
    const dbEndDate = formatDateForDB(today);
    
    const { data: campaignData, error: queryError } = await supabase
      .from('apishopee_ads_performance_daily')
      .select('performance_date, impression, clicks, expense, direct_order, direct_gmv, broad_order, broad_gmv, direct_item_sold, broad_item_sold')
      .eq('shop_id', shopId)
      .gte('performance_date', dbStartDate)
      .lte('performance_date', dbEndDate);

    if (queryError) {
      console.error('[ADS-SYNC] Error querying campaign-level data:', queryError);
      return { impression: 0, clicks: 0, orders: 0, gmv: 0, expense: 0 };
    }

    if (!campaignData || campaignData.length === 0) {
      console.log('[ADS-SYNC] No campaign-level data to aggregate');
      return { impression: 0, clicks: 0, orders: 0, gmv: 0, expense: 0 };
    }

    // Group by date và tính tổng
    const dailyTotals: Record<string, {
      impression: number;
      clicks: number;
      expense: number;
      direct_order: number;
      direct_gmv: number;
      broad_order: number;
      broad_gmv: number;
      direct_item_sold: number;
      broad_item_sold: number;
    }> = {};

    for (const row of campaignData) {
      const date = row.performance_date;
      if (!dailyTotals[date]) {
        dailyTotals[date] = {
          impression: 0, clicks: 0, expense: 0,
          direct_order: 0, direct_gmv: 0,
          broad_order: 0, broad_gmv: 0,
          direct_item_sold: 0, broad_item_sold: 0,
        };
      }
      dailyTotals[date].impression += Number(row.impression) || 0;
      dailyTotals[date].clicks += Number(row.clicks) || 0;
      dailyTotals[date].expense += Number(row.expense) || 0;
      dailyTotals[date].direct_order += Number(row.direct_order) || 0;
      dailyTotals[date].direct_gmv += Number(row.direct_gmv) || 0;
      dailyTotals[date].broad_order += Number(row.broad_order) || 0;
      dailyTotals[date].broad_gmv += Number(row.broad_gmv) || 0;
      dailyTotals[date].direct_item_sold += Number(row.direct_item_sold) || 0;
      dailyTotals[date].broad_item_sold += Number(row.broad_item_sold) || 0;
    }

    // Lưu vào bảng shop-level
    const now = new Date().toISOString();
    for (const [date, totals] of Object.entries(dailyTotals)) {
      const ctr = totals.impression > 0 ? (totals.clicks / totals.impression) * 100 : 0;
      const roas = totals.expense > 0 ? totals.broad_gmv / totals.expense : 0;
      const acos = totals.broad_gmv > 0 ? (totals.expense / totals.broad_gmv) * 100 : 0;

      const { error: upsertError } = await supabase
        .from('apishopee_ads_shop_performance_daily')
        .upsert({
          shop_id: shopId,
          performance_date: date,
          impression: totals.impression,
          clicks: totals.clicks,
          ctr,
          expense: totals.expense,
          direct_order: totals.direct_order,
          direct_gmv: totals.direct_gmv,
          broad_order: totals.broad_order,
          broad_gmv: totals.broad_gmv,
          direct_item_sold: totals.direct_item_sold,
          broad_item_sold: totals.broad_item_sold,
          roas,
          acos,
          synced_at: now,
        }, { onConflict: 'shop_id,performance_date' });

      if (upsertError) {
        console.error(`[ADS-SYNC] Upsert aggregated shop-level error for ${date}:`, upsertError);
      }
    }

    console.log(`[ADS-SYNC] Saved ${Object.keys(dailyTotals).length} aggregated shop-level daily records`);
  }

  // Trả về tổng của ngày hôm nay
  const todayDate = formatDateForDB(today);
  const { data: todayData } = await supabase
    .from('apishopee_ads_shop_performance_daily')
    .select('*')
    .eq('shop_id', shopId)
    .eq('performance_date', todayDate)
    .maybeSingle();

  if (todayData) {
    return {
      impression: todayData.impression || 0,
      clicks: todayData.clicks || 0,
      orders: todayData.broad_order || 0,
      gmv: todayData.broad_gmv || 0,
      expense: todayData.expense || 0,
    };
  }

  return { impression: 0, clicks: 0, orders: 0, gmv: 0, expense: 0 };
}

/**
 * Sync shop-level hourly performance (tổng hợp tất cả ads theo giờ)
 * Sử dụng API get_all_cpc_ads_hourly_performance - giống như Response button
 * LƯU VÀO BẢNG RIÊNG để hiển thị chính xác
 * 
 * Nếu API trả về rỗng → fallback tính tổng từ campaign-level
 */
async function syncShopLevelHourlyPerformance(
  supabase: ReturnType<typeof createClient>,
  credentials: ShopCredentials,
  shopId: number
): Promise<number> {
  console.log('[ADS-SYNC] Syncing shop-level hourly performance...');

  // Sử dụng Vietnam timezone
  const today = getVietnamDate();
  const dateStr = formatDateForShopee(today);
  const dbDate = formatDateForDB(today);
  
  console.log(`[ADS-SYNC] Shop-level hourly date: ${dateStr} (VN timezone)`);

  const perfResult = await callShopeeAPI(
    credentials,
    shopId,
    '/api/v2/ads/get_all_cpc_ads_hourly_performance',
    'GET',
    { performance_date: dateStr }
  );

  console.log('[ADS-SYNC] Shop-level hourly response:', JSON.stringify(perfResult).substring(0, 1000));

  let savedCount = 0;
  let hasShopLevelData = false;

  if (!perfResult.error) {
    const metricsList = perfResult.response?.metrics_list || [];
    
    if (metricsList.length > 0) {
      hasShopLevelData = true;
      
      // Prepare upsert data
      const now = new Date().toISOString();
      const upsertData = metricsList.map((hourMetrics: any) => {
        const expense = hourMetrics.expense || 0;
        const broadGmv = hourMetrics.broad_gmv || 0;
        const impression = hourMetrics.impression || 0;
        const clicks = hourMetrics.clicks || 0;
        
        const ctr = impression > 0 ? (clicks / impression) * 100 : 0;
        const roas = expense > 0 ? broadGmv / expense : 0;
        const acos = broadGmv > 0 ? (expense / broadGmv) * 100 : 0;

        return {
          shop_id: shopId,
          performance_date: dbDate,
          hour: hourMetrics.hour,
          impression,
          clicks,
          ctr,
          expense,
          direct_order: hourMetrics.direct_order || 0,
          direct_gmv: hourMetrics.direct_gmv || 0,
          broad_order: hourMetrics.broad_order || 0,
          broad_gmv: broadGmv,
          direct_item_sold: hourMetrics.direct_item_sold || 0,
          broad_item_sold: hourMetrics.broad_item_sold || 0,
          roas,
          acos,
          synced_at: now,
        };
      });

      // UPSERT vào bảng shop-level hourly
      const { error: upsertError } = await supabase
        .from('apishopee_ads_shop_performance_hourly')
        .upsert(upsertData, { onConflict: 'shop_id,performance_date,hour' });

      if (upsertError) {
        console.error('[ADS-SYNC] Upsert shop-level hourly error:', upsertError);
      } else {
        savedCount = upsertData.length;
        console.log(`[ADS-SYNC] Saved ${savedCount} shop-level hourly records from API`);
      }
    }
  }

  // Fallback: Nếu API shop-level không có dữ liệu, tính tổng từ campaign-level
  if (!hasShopLevelData) {
    console.log('[ADS-SYNC] Shop-level hourly API returned empty, calculating from campaign-level data...');
    
    const { data: campaignData, error: queryError } = await supabase
      .from('apishopee_ads_performance_hourly')
      .select('hour, impression, clicks, expense, direct_order, direct_gmv, broad_order, broad_gmv, direct_item_sold, broad_item_sold')
      .eq('shop_id', shopId)
      .eq('performance_date', dbDate);

    if (queryError) {
      console.error('[ADS-SYNC] Error querying campaign-level hourly data:', queryError);
      return 0;
    }

    if (!campaignData || campaignData.length === 0) {
      console.log('[ADS-SYNC] No campaign-level hourly data to aggregate');
      return 0;
    }

    // Group by hour và tính tổng
    const hourlyTotals: Record<number, {
      impression: number;
      clicks: number;
      expense: number;
      direct_order: number;
      direct_gmv: number;
      broad_order: number;
      broad_gmv: number;
      direct_item_sold: number;
      broad_item_sold: number;
    }> = {};

    for (const row of campaignData) {
      const hour = row.hour;
      if (!hourlyTotals[hour]) {
        hourlyTotals[hour] = {
          impression: 0, clicks: 0, expense: 0,
          direct_order: 0, direct_gmv: 0,
          broad_order: 0, broad_gmv: 0,
          direct_item_sold: 0, broad_item_sold: 0,
        };
      }
      hourlyTotals[hour].impression += Number(row.impression) || 0;
      hourlyTotals[hour].clicks += Number(row.clicks) || 0;
      hourlyTotals[hour].expense += Number(row.expense) || 0;
      hourlyTotals[hour].direct_order += Number(row.direct_order) || 0;
      hourlyTotals[hour].direct_gmv += Number(row.direct_gmv) || 0;
      hourlyTotals[hour].broad_order += Number(row.broad_order) || 0;
      hourlyTotals[hour].broad_gmv += Number(row.broad_gmv) || 0;
      hourlyTotals[hour].direct_item_sold += Number(row.direct_item_sold) || 0;
      hourlyTotals[hour].broad_item_sold += Number(row.broad_item_sold) || 0;
    }

    // Lưu vào bảng shop-level hourly
    const now = new Date().toISOString();
    const upsertData = Object.entries(hourlyTotals).map(([hourStr, totals]) => {
      const hour = parseInt(hourStr);
      const ctr = totals.impression > 0 ? (totals.clicks / totals.impression) * 100 : 0;
      const roas = totals.expense > 0 ? totals.broad_gmv / totals.expense : 0;
      const acos = totals.broad_gmv > 0 ? (totals.expense / totals.broad_gmv) * 100 : 0;

      return {
        shop_id: shopId,
        performance_date: dbDate,
        hour,
        impression: totals.impression,
        clicks: totals.clicks,
        ctr,
        expense: totals.expense,
        direct_order: totals.direct_order,
        direct_gmv: totals.direct_gmv,
        broad_order: totals.broad_order,
        broad_gmv: totals.broad_gmv,
        direct_item_sold: totals.direct_item_sold,
        broad_item_sold: totals.broad_item_sold,
        roas,
        acos,
        synced_at: now,
      };
    });

    const { error: upsertError } = await supabase
      .from('apishopee_ads_shop_performance_hourly')
      .upsert(upsertData, { onConflict: 'shop_id,performance_date,hour' });

    if (upsertError) {
      console.error('[ADS-SYNC] Upsert aggregated shop-level hourly error:', upsertError);
    } else {
      savedCount = upsertData.length;
      console.log(`[ADS-SYNC] Saved ${savedCount} aggregated shop-level hourly records`);
    }
  }

  return savedCount;
}

/**
 * Update sync status
 */
async function updateSyncStatus(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  updates: {
    is_syncing?: boolean;
    last_sync_at?: string;
    last_sync_error?: string | null;
    sync_progress?: Record<string, unknown>;
    total_campaigns?: number;
    ongoing_campaigns?: number;
  }
) {
  const { error } = await supabase
    .from('apishopee_ads_sync_status')
    .upsert(
      {
        shop_id: shopId,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id' }
    );

  if (error) {
    console.error('[ADS-SYNC] Failed to update sync status:', error);
  }
}

/**
 * Main sync function
 */
async function syncAdsData(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<{
  success: boolean;
  campaigns_synced: number;
  daily_records: number;
  hourly_records: number;
  error?: string;
}> {
  try {
    // Update status: syncing
    await updateSyncStatus(supabase, shopId, {
      is_syncing: true,
      last_sync_error: null,
      sync_progress: { step: 'starting', progress: 0 },
    });

    // Get credentials
    const credentials = await getShopCredentials(supabase, shopId);

    // Step 0: Sync shop-level performance để debug và so sánh
    console.log('[ADS-SYNC] === SHOP-LEVEL PERFORMANCE (for comparison) ===');
    const shopLevelDaily = await syncShopLevelDailyPerformance(supabase, credentials, shopId);
    const shopLevelHourlyCount = await syncShopLevelHourlyPerformance(supabase, credentials, shopId);
    console.log('[ADS-SYNC] Shop-level daily:', shopLevelDaily);
    console.log('[ADS-SYNC] Shop-level hourly count:', shopLevelHourlyCount);
    console.log('[ADS-SYNC] === END SHOP-LEVEL ===');

    // Step 1: Sync campaigns
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'syncing_campaigns', progress: 20 },
    });
    const { total, ongoing, campaigns } = await syncCampaigns(supabase, credentials, shopId);

    // Step 2: Sync daily performance (campaign-level)
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'syncing_daily_performance', progress: 50 },
    });
    const dailyRecords = await syncDailyPerformance(supabase, credentials, shopId, campaigns);

    // Step 3: Sync hourly performance (campaign-level)
    await updateSyncStatus(supabase, shopId, {
      sync_progress: { step: 'syncing_hourly_performance', progress: 80 },
    });
    const hourlyRecords = await syncHourlyPerformance(supabase, credentials, shopId, campaigns);

    // Update status: completed
    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
      sync_progress: { step: 'completed', progress: 100 },
      total_campaigns: total,
      ongoing_campaigns: ongoing,
    });

    console.log(`[ADS-SYNC] Sync completed for shop ${shopId}`);
    return {
      success: true,
      campaigns_synced: total,
      daily_records: dailyRecords,
      hourly_records: hourlyRecords,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`[ADS-SYNC] Sync failed for shop ${shopId}:`, errorMessage);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_sync_error: errorMessage,
      sync_progress: { step: 'failed', error: errorMessage },
    });

    return {
      success: false,
      campaigns_synced: 0,
      daily_records: 0,
      hourly_records: 0,
      error: errorMessage,
    };
  }
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id } = body;

    if (!shop_id) {
      return new Response(
        JSON.stringify({ error: 'shop_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    switch (action) {
      case 'sync': {
        const result = await syncAdsData(supabase, shop_id);
        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'status': {
        const { data, error } = await supabase
          .from('apishopee_ads_sync_status')
          .select('*')
          .eq('shop_id', shop_id)
          .maybeSingle();

        if (error) {
          throw error;
        }

        return new Response(
          JSON.stringify({
            success: true,
            status: data || {
              is_syncing: false,
              last_sync_at: null,
              last_sync_error: null,
              total_campaigns: 0,
              ongoing_campaigns: 0,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Use: sync, status' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('[ADS-SYNC] Error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message, success: false }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
