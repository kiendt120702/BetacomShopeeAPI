/**
 * Supabase Edge Function: Shopee Scheduler
 * Quản lý lịch hẹn giờ copy Flash Sale
 * 
 * Actions:
 * - schedule: Tạo lịch hẹn mới
 * - list: Xem danh sách lịch hẹn
 * - cancel: Hủy lịch hẹn
 * - process: Xử lý các lịch đến giờ (gọi bởi cron)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SHOPEE_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const SHOPEE_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const TOKEN_BUFFER_MS = 5 * 60 * 1000;

function createSignature(partnerId: number, path: string, timestamp: number, accessToken = '', shopId = 0): string {
  let baseString = `${partnerId}${path}${timestamp}`;
  if (accessToken) baseString += accessToken;
  if (shopId) baseString += shopId;
  const hmac = createHmac('sha256', SHOPEE_PARTNER_KEY);
  hmac.update(baseString);
  return hmac.digest('hex');
}

async function refreshAccessToken(refreshToken: string, shopId: number) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const sign = createSignature(SHOPEE_PARTNER_ID, path, timestamp);
  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken, partner_id: SHOPEE_PARTNER_ID, shop_id: shopId }),
  });
  return await response.json();
}


async function saveToken(supabase: ReturnType<typeof createClient>, shopId: number, token: Record<string, unknown>) {
  await supabase.from('shopee_tokens').upsert({
    shop_id: shopId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expire_in: token.expire_in,
    expired_at: Date.now() + (token.expire_in as number) * 1000,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shop_id' });
}

async function getTokenWithAutoRefresh(supabase: ReturnType<typeof createClient>, shopId: number) {
  const { data, error } = await supabase.from('shopee_tokens').select('*').eq('shop_id', shopId).single();
  if (error || !data) throw new Error('Token not found');

  const now = Date.now();
  if (data.expired_at && (data.expired_at - now) < TOKEN_BUFFER_MS) {
    const newToken = await refreshAccessToken(data.refresh_token, shopId);
    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      return { ...data, access_token: newToken.access_token, refresh_token: newToken.refresh_token };
    }
  }
  return data;
}

async function callShopeeAPI(
  supabase: ReturnType<typeof createClient>,
  path: string,
  method: 'GET' | 'POST',
  shopId: number,
  token: { access_token: string; refresh_token: string },
  body?: Record<string, unknown>,
  extraParams?: Record<string, string | number>
) {
  const makeRequest = async (accessToken: string) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = createSignature(SHOPEE_PARTNER_ID, path, timestamp, accessToken, shopId);
    const params = new URLSearchParams({
      partner_id: SHOPEE_PARTNER_ID.toString(),
      timestamp: timestamp.toString(),
      access_token: accessToken,
      shop_id: shopId.toString(),
      sign,
    });
    if (extraParams) {
      Object.entries(extraParams).forEach(([k, v]) => {
        if (v !== undefined && v !== null) params.append(k, v.toString());
      });
    }
    const url = `${SHOPEE_BASE_URL}${path}?${params.toString()}`;
    const options: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (method === 'POST' && body) options.body = JSON.stringify(body);
    const response = await fetch(url, options);
    return await response.json();
  };

  let result = await makeRequest(token.access_token);
  if (result.error === 'error_auth') {
    const newToken = await refreshAccessToken(token.refresh_token, shopId);
    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      result = await makeRequest(newToken.access_token);
    }
  }
  return result;
}


// Thực hiện copy Flash Sale
async function executeCopyFlashSale(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  timeslotId: number,
  itemsData: unknown[]
) {
  const token = await getTokenWithAutoRefresh(supabase, shopId);

  // Bước 1: Tạo Flash Sale mới
  const createRes = await callShopeeAPI(
    supabase,
    '/api/v2/shop_flash_sale/create_shop_flash_sale',
    'POST',
    shopId,
    token,
    { timeslot_id: timeslotId }
  );

  if (createRes.error) {
    return { success: false, message: `Tạo Flash Sale lỗi: ${createRes.message}` };
  }

  const flashSaleId = createRes.response?.flash_sale_id;
  if (!flashSaleId) {
    return { success: false, message: 'Không nhận được flash_sale_id' };
  }

  // Bước 2: Thêm items
  const addRes = await callShopeeAPI(
    supabase,
    '/api/v2/shop_flash_sale/add_shop_flash_sale_items',
    'POST',
    shopId,
    token,
    { flash_sale_id: flashSaleId, items: itemsData }
  );

  if (addRes.error) {
    return { 
      success: false, 
      flashSaleId,
      message: `Tạo OK nhưng thêm SP lỗi: ${addRes.message}` 
    };
  }

  const failedItems = addRes.response?.failed_items || [];
  const totalItems = (itemsData as unknown[]).length;
  const successCount = totalItems - failedItems.length;

  return {
    success: true,
    flashSaleId,
    message: `Thành công! ${successCount}/${totalItems} SP`,
    failedItems: failedItems.length > 0 ? failedItems : undefined,
  };
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
      // Tạo lịch hẹn mới
      case 'schedule': {
        const { source_flash_sale_id, schedules, minutes_before = 10 } = params;
        // schedules: [{ timeslot_id, start_time, items_data }]
        // minutes_before: số phút trước khi chạy (mặc định 10)
        
        if (!shop_id || !source_flash_sale_id || !schedules?.length) {
          return new Response(JSON.stringify({ error: 'Missing required params' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const minutesToRun = Math.max(1, Math.min(60, minutes_before)); // Giới hạn 1-60 phút
        const results = [];
        for (const schedule of schedules) {
          // Tính thời gian thực hiện (trước X phút)
          const scheduledAt = new Date((schedule.start_time - minutesToRun * 60) * 1000);
          
          const { data, error } = await supabase.from('scheduled_flash_sales').insert({
            shop_id,
            source_flash_sale_id,
            target_timeslot_id: schedule.timeslot_id,
            target_start_time: schedule.start_time,
            scheduled_at: scheduledAt.toISOString(),
            items_data: schedule.items_data,
            status: 'pending',
          }).select().single();

          if (error) {
            results.push({ timeslot_id: schedule.timeslot_id, success: false, error: error.message });
          } else {
            results.push({ timeslot_id: schedule.timeslot_id, success: true, id: data.id, scheduled_at: scheduledAt });
          }
        }

        return new Response(JSON.stringify({ success: true, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }


      // Xem danh sách lịch hẹn
      case 'list': {
        const { data, error } = await supabase
          .from('scheduled_flash_sales')
          .select('*')
          .eq('shop_id', shop_id)
          .order('scheduled_at', { ascending: true });

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, schedules: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Hủy lịch hẹn
      case 'cancel': {
        const { schedule_id } = params;
        
        const { error } = await supabase
          .from('scheduled_flash_sales')
          .delete()
          .eq('id', schedule_id)
          .eq('shop_id', shop_id)
          .eq('status', 'pending');

        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Force run một lịch cụ thể (bỏ qua thời gian)
      case 'force-run': {
        const { schedule_id } = params;
        
        // Lấy thông tin lịch
        const { data: schedule, error: fetchError } = await supabase
          .from('scheduled_flash_sales')
          .select('*')
          .eq('id', schedule_id)
          .eq('status', 'pending')
          .single();

        if (fetchError || !schedule) {
          return new Response(JSON.stringify({ success: false, message: 'Không tìm thấy lịch hẹn' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Đánh dấu đang chạy
        await supabase.from('scheduled_flash_sales').update({ status: 'running' }).eq('id', schedule_id);

        try {
          const result = await executeCopyFlashSale(
            supabase,
            schedule.shop_id,
            schedule.target_timeslot_id,
            schedule.items_data
          );

          // Cập nhật kết quả
          await supabase.from('scheduled_flash_sales').update({
            status: result.success ? 'completed' : 'failed',
            result_flash_sale_id: result.flashSaleId,
            result_message: result.message,
          }).eq('id', schedule_id);

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (err) {
          await supabase.from('scheduled_flash_sales').update({
            status: 'failed',
            result_message: (err as Error).message,
          }).eq('id', schedule_id);

          return new Response(JSON.stringify({ success: false, message: (err as Error).message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Xử lý các lịch đến giờ (gọi bởi cron hoặc manual)
      case 'process': {
        const now = new Date();
        
        // Lấy các lịch pending và đã đến giờ
        const { data: pendingSchedules, error } = await supabase
          .from('scheduled_flash_sales')
          .select('*')
          .eq('status', 'pending')
          .lte('scheduled_at', now.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(10);

        if (error) throw error;

        const results = [];
        
        for (const schedule of pendingSchedules || []) {
          // Đánh dấu đang chạy
          await supabase
            .from('scheduled_flash_sales')
            .update({ status: 'running' })
            .eq('id', schedule.id);

          try {
            const result = await executeCopyFlashSale(
              supabase,
              schedule.shop_id,
              schedule.target_timeslot_id,
              schedule.items_data
            );

            // Cập nhật kết quả
            await supabase
              .from('scheduled_flash_sales')
              .update({
                status: result.success ? 'completed' : 'failed',
                result_flash_sale_id: result.flashSaleId,
                result_message: result.message,
              })
              .eq('id', schedule.id);

            results.push({ id: schedule.id, ...result });
          } catch (err) {
            await supabase
              .from('scheduled_flash_sales')
              .update({
                status: 'failed',
                result_message: (err as Error).message,
              })
              .eq('id', schedule.id);

            results.push({ id: schedule.id, success: false, message: (err as Error).message });
          }
        }

        return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
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
