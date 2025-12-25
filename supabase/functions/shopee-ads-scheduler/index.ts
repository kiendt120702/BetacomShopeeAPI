/**
 * Supabase Edge Function: Shopee Ads Budget Scheduler
 * Quản lý lịch điều chỉnh ngân sách ads theo khung giờ
 * Hỗ trợ multi-partner: lấy credentials từ database
 * 
 * Actions:
 * - create: Tạo cấu hình lịch ngân sách mới
 * - update: Cập nhật cấu hình
 * - delete: Xóa cấu hình
 * - list: Xem danh sách cấu hình
 * - logs: Xem lịch sử thay đổi
 * - process: Xử lý điều chỉnh ngân sách (gọi bởi cron mỗi giờ)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Shopee API config (fallback)
const DEFAULT_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const DEFAULT_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || ''; // VPS Proxy URL
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const TOKEN_BUFFER_MS = 5 * 60 * 1000;

// Interface cho partner credentials
interface PartnerCredentials {
  partnerId: number;
  partnerKey: string;
}

/**
 * Lấy partner credentials từ database hoặc fallback env
 */
async function getPartnerCredentials(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<PartnerCredentials> {
  const { data, error } = await supabase
    .from('shops')
    .select('partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  if (data?.partner_id && data?.partner_key && !error) {
    console.log('[PARTNER] Using partner from shop:', data.partner_id);
    return {
      partnerId: data.partner_id,
      partnerKey: data.partner_key,
    };
  }

  console.log('[PARTNER] Using default partner from env:', DEFAULT_PARTNER_ID);
  return {
    partnerId: DEFAULT_PARTNER_ID,
    partnerKey: DEFAULT_PARTNER_KEY,
  };
}

/**
 * Helper function để gọi API qua proxy hoặc trực tiếp
 */
async function fetchWithProxy(targetUrl: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
    console.log('[PROXY] Calling via proxy:', PROXY_URL);
    return await fetch(proxyUrl, options);
  }
  return await fetch(targetUrl, options);
}

function createSignature(partnerKey: string, partnerId: number, path: string, timestamp: number, accessToken = '', shopId = 0): string {
  let baseString = `${partnerId}${path}${timestamp}`;
  if (accessToken) baseString += accessToken;
  if (shopId) baseString += shopId;
  const hmac = createHmac('sha256', partnerKey);
  hmac.update(baseString);
  return hmac.digest('hex');
}

function generateReferenceId(): string {
  return `budget-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

async function refreshAccessToken(credentials: PartnerCredentials, refreshToken: string, shopId: number) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const sign = createSignature(credentials.partnerKey, credentials.partnerId, path, timestamp);
  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${credentials.partnerId}&timestamp=${timestamp}&sign=${sign}`;
  const response = await fetchWithProxy(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken, partner_id: credentials.partnerId, shop_id: shopId }),
  });
  return await response.json();
}

async function saveToken(supabase: ReturnType<typeof createClient>, shopId: number, token: Record<string, unknown>) {
  // Chỉ cập nhật bảng shops (đã consolidate schema)
  await supabase.from('shops').upsert({
    shop_id: shopId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expire_in: token.expire_in,
    expired_at: Date.now() + (token.expire_in as number) * 1000,
    token_updated_at: new Date().toISOString(),
  }, { onConflict: 'shop_id' });
}

async function getTokenWithAutoRefresh(supabase: ReturnType<typeof createClient>, shopId: number) {
  // 1. Tìm token từ bảng shops
  const { data: shopData, error: shopError } = await supabase
    .from('shops')
    .select('shop_id, access_token, refresh_token, expired_at')
    .eq('shop_id', shopId)
    .single();

  if (!shopError && shopData?.access_token) {
    return shopData;
  }

  // Token not found after schema consolidation
  throw new Error('Token not found');
}


// Gọi API chỉnh sửa ngân sách
async function editCampaignBudget(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  campaignId: number,
  adType: 'auto' | 'manual',
  budget: number
): Promise<{ success: boolean; error?: string }> {
  const credentials = await getPartnerCredentials(supabase, shopId);
  const token = await getTokenWithAutoRefresh(supabase, shopId);
  
  const timestamp = Math.floor(Date.now() / 1000);
  const path = adType === 'manual' 
    ? '/api/v2/ads/edit_manual_product_ads'
    : '/api/v2/ads/edit_auto_product_ads';
  const sign = createSignature(credentials.partnerKey, credentials.partnerId, path, timestamp, token.access_token, shopId);

  const params = new URLSearchParams({
    partner_id: credentials.partnerId.toString(),
    timestamp: timestamp.toString(),
    access_token: token.access_token,
    shop_id: shopId.toString(),
    sign,
  });

  const body: Record<string, unknown> = {
    reference_id: generateReferenceId(),
    campaign_id: campaignId,
    edit_action: 'change_budget',
    budget,
  };

  const url = `${SHOPEE_BASE_URL}${path}?${params.toString()}`;
  
  const response = await fetchWithProxy(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await response.json();

  if (result.error && result.error !== '') {
    // Retry với token mới nếu lỗi auth
    if (result.error === 'error_auth') {
      const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);
      if (!newToken.error) {
        await saveToken(supabase, shopId, newToken);
        // Retry request
        const retryTimestamp = Math.floor(Date.now() / 1000);
        const retrySign = createSignature(credentials.partnerKey, credentials.partnerId, path, retryTimestamp, newToken.access_token, shopId);
        const retryParams = new URLSearchParams({
          partner_id: credentials.partnerId.toString(),
          timestamp: retryTimestamp.toString(),
          access_token: newToken.access_token,
          shop_id: shopId.toString(),
          sign: retrySign,
        });
        const retryUrl = `${SHOPEE_BASE_URL}${path}?${retryParams.toString()}`;
        const retryResponse = await fetchWithProxy(retryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, reference_id: generateReferenceId() }),
        });
        const retryResult = await retryResponse.json();
        if (retryResult.error && retryResult.error !== '') {
          return { success: false, error: retryResult.message || retryResult.error };
        }
        return { success: true };
      }
    }
    return { success: false, error: result.message || result.error };
  }

  return { success: true };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id, ...params } = body;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    switch (action) {
      // Tạo cấu hình lịch ngân sách mới
      case 'create': {
        const { campaign_id, campaign_name, ad_type, hour_start, hour_end, budget, days_of_week } = params;

        if (!shop_id || !campaign_id || !ad_type || hour_start === undefined || hour_end === undefined || budget === undefined) {
          return new Response(JSON.stringify({ error: 'Missing required params' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data, error } = await supabase.from('scheduled_ads_budget').insert({
          shop_id,
          campaign_id,
          campaign_name,
          ad_type,
          hour_start,
          hour_end,
          budget,
          days_of_week: days_of_week || null,
          is_active: true,
        }).select().single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, schedule: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Cập nhật cấu hình
      case 'update': {
        const { schedule_id, ...updateData } = params;

        if (!schedule_id) {
          return new Response(JSON.stringify({ error: 'schedule_id is required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data, error } = await supabase
          .from('scheduled_ads_budget')
          .update(updateData)
          .eq('id', schedule_id)
          .eq('shop_id', shop_id)
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, schedule: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Xóa cấu hình
      case 'delete': {
        const { schedule_id } = params;

        const { error } = await supabase
          .from('scheduled_ads_budget')
          .delete()
          .eq('id', schedule_id)
          .eq('shop_id', shop_id);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Xem danh sách cấu hình
      case 'list': {
        const { campaign_id } = params;

        let query = supabase
          .from('scheduled_ads_budget')
          .select('*')
          .eq('shop_id', shop_id)
          .order('campaign_id')
          .order('hour_start');

        if (campaign_id) {
          query = query.eq('campaign_id', campaign_id);
        }

        const { data, error } = await query;

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, schedules: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Xem lịch sử thay đổi
      case 'logs': {
        const { campaign_id, limit = 50 } = params;

        let query = supabase
          .from('ads_budget_logs')
          .select('*')
          .eq('shop_id', shop_id)
          .order('executed_at', { ascending: false })
          .limit(limit);

        if (campaign_id) {
          query = query.eq('campaign_id', campaign_id);
        }

        const { data, error } = await query;

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, logs: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }


      // Xử lý điều chỉnh ngân sách (gọi bởi cron mỗi giờ)
      case 'process': {
        // Chuyển sang timezone Việt Nam (UTC+7)
        const now = new Date();
        const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const currentHour = vnTime.getHours();
        const currentDay = vnTime.getDay(); // 0 = Sunday

        console.log(`[PROCESS] Running at VN hour ${currentHour}, day ${currentDay} (UTC: ${now.getUTCHours()})`);

        // Lấy tất cả cấu hình active phù hợp với giờ hiện tại
        const { data: schedules, error: fetchError } = await supabase
          .from('scheduled_ads_budget')
          .select('*')
          .eq('is_active', true)
          .lte('hour_start', currentHour)
          .gt('hour_end', currentHour);

        if (fetchError) {
          console.error('Error fetching schedules:', fetchError);
          return new Response(JSON.stringify({ error: fetchError.message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Lọc theo ngày trong tuần nếu có cấu hình
        const applicableSchedules = (schedules || []).filter(s => {
          if (!s.days_of_week || s.days_of_week.length === 0) return true;
          return s.days_of_week.includes(currentDay);
        });

        console.log(`[PROCESS] Found ${applicableSchedules.length} applicable schedules`);

        const results = [];

        // Nhóm theo shop_id để xử lý
        const byShop = new Map<number, typeof applicableSchedules>();
        for (const schedule of applicableSchedules) {
          const list = byShop.get(schedule.shop_id) || [];
          list.push(schedule);
          byShop.set(schedule.shop_id, list);
        }

        for (const [shopId, shopSchedules] of byShop) {
          for (const schedule of shopSchedules) {
            try {
              console.log(`[PROCESS] Updating campaign ${schedule.campaign_id} to budget ${schedule.budget}`);

              const result = await editCampaignBudget(
                supabase,
                shopId,
                schedule.campaign_id,
                schedule.ad_type,
                schedule.budget
              );

              // Log kết quả
              await supabase.from('ads_budget_logs').insert({
                shop_id: shopId,
                campaign_id: schedule.campaign_id,
                schedule_id: schedule.id,
                new_budget: schedule.budget,
                status: result.success ? 'success' : 'failed',
                error_message: result.error,
              });

              results.push({
                schedule_id: schedule.id,
                campaign_id: schedule.campaign_id,
                budget: schedule.budget,
                success: result.success,
                error: result.error,
              });
            } catch (err) {
              console.error(`[PROCESS] Error for campaign ${schedule.campaign_id}:`, err);

              await supabase.from('ads_budget_logs').insert({
                shop_id: shopId,
                campaign_id: schedule.campaign_id,
                schedule_id: schedule.id,
                new_budget: schedule.budget,
                status: 'failed',
                error_message: (err as Error).message,
              });

              results.push({
                schedule_id: schedule.id,
                campaign_id: schedule.campaign_id,
                budget: schedule.budget,
                success: false,
                error: (err as Error).message,
              });
            }
          }
        }

        return new Response(JSON.stringify({ 
          success: true, 
          processed: results.length,
          hour: currentHour,
          day: currentDay,
          results 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Test: Chạy ngay cho một schedule cụ thể
      case 'run-now': {
        const { schedule_id } = params;

        const { data: schedule, error: fetchError } = await supabase
          .from('scheduled_ads_budget')
          .select('*')
          .eq('id', schedule_id)
          .eq('shop_id', shop_id)
          .single();

        if (fetchError || !schedule) {
          return new Response(JSON.stringify({ error: 'Schedule not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const result = await editCampaignBudget(
          supabase,
          shop_id,
          schedule.campaign_id,
          schedule.ad_type,
          schedule.budget
        );

        // Log kết quả
        await supabase.from('ads_budget_logs').insert({
          shop_id,
          campaign_id: schedule.campaign_id,
          schedule_id: schedule.id,
          new_budget: schedule.budget,
          status: result.success ? 'success' : 'failed',
          error_message: result.error,
        });

        return new Response(JSON.stringify({ 
          success: result.success, 
          error: result.error,
          campaign_id: schedule.campaign_id,
          budget: schedule.budget,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
