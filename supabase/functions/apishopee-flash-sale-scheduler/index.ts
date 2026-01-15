/**
 * Flash Sale Auto Scheduler Worker
 * 
 * Chạy định kỳ để xử lý các scheduled flash sale jobs:
 * 1. Tìm các jobs có status='scheduled' và scheduled_at <= now
 * 2. Kiểm tra xem timeslot đã có Flash Sale chưa (tạo thủ công trên Shopee)
 * 3. Nếu chưa có -> tạo FS và thêm sản phẩm
 * 4. Nếu đã có -> cập nhật status='error' với message phù hợp
 * 
 * Trigger: Supabase cron job hoặc external scheduler (mỗi 1-2 phút)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const DEFAULT_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

interface PartnerCredentials {
  partnerId: number;
  partnerKey: string;
}

interface ScheduledJob {
  id: string;
  shop_id: number;
  user_id: string;
  timeslot_id: number;
  slot_start_time: number;
  slot_end_time: number;
  items_count: number;
  scheduled_at: string;
}

interface FlashSaleItem {
  item_id: number;
  item_name?: string;
  status: number;
  purchase_limit: number;
  campaign_stock?: number;
  input_promotion_price?: number;
  models?: FlashSaleModel[];
}

interface FlashSaleModel {
  model_id: number;
  item_id: number;
  input_promotion_price: number;
  campaign_stock: number;
  status?: number;
}

// ==================== HELPER FUNCTIONS ====================

async function getPartnerCredentials(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<PartnerCredentials> {
  const { data } = await supabase
    .from('apishopee_shops')
    .select('partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  if (data?.partner_id && data?.partner_key) {
    return { partnerId: data.partner_id, partnerKey: data.partner_key };
  }
  return { partnerId: DEFAULT_PARTNER_ID, partnerKey: DEFAULT_PARTNER_KEY };
}

async function fetchWithProxy(targetUrl: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
    return await fetch(proxyUrl, options);
  }
  return await fetch(targetUrl, options);
}

function createSignature(
  partnerKey: string,
  partnerId: number,
  path: string,
  timestamp: number,
  accessToken = '',
  shopId = 0
): string {
  let baseString = `${partnerId}${path}${timestamp}`;
  if (accessToken) baseString += accessToken;
  if (shopId) baseString += shopId;
  const hmac = createHmac('sha256', partnerKey);
  hmac.update(baseString);
  return hmac.digest('hex');
}

async function refreshAccessToken(
  credentials: PartnerCredentials,
  refreshToken: string,
  shopId: number
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const sign = createSignature(credentials.partnerKey, credentials.partnerId, path, timestamp);
  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${credentials.partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetchWithProxy(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      partner_id: credentials.partnerId,
      shop_id: shopId,
    }),
  });
  return await response.json();
}

async function saveToken(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  token: Record<string, unknown>
) {
  await supabase.from('apishopee_shops').upsert({
    shop_id: shopId,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expire_in: token.expire_in,
    expired_at: Date.now() + (token.expire_in as number) * 1000,
    token_updated_at: new Date().toISOString(),
  }, { onConflict: 'shop_id' });
}

async function getTokenWithAutoRefresh(
  supabase: ReturnType<typeof createClient>,
  shopId: number
) {
  const { data } = await supabase
    .from('apishopee_shops')
    .select('shop_id, access_token, refresh_token, expired_at')
    .eq('shop_id', shopId)
    .single();

  if (data?.access_token) return data;
  throw new Error('Token not found');
}

async function callShopeeAPI(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  path: string,
  method: 'GET' | 'POST',
  shopId: number,
  token: { access_token: string; refresh_token: string },
  body?: Record<string, unknown>,
  extraParams?: Record<string, string | number | boolean>
): Promise<unknown> {
  const makeRequest = async (accessToken: string) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = createSignature(credentials.partnerKey, credentials.partnerId, path, timestamp, accessToken, shopId);

    const params = new URLSearchParams({
      partner_id: credentials.partnerId.toString(),
      timestamp: timestamp.toString(),
      access_token: accessToken,
      shop_id: shopId.toString(),
      sign: sign,
    });

    if (extraParams) {
      Object.entries(extraParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }

    const url = `${SHOPEE_BASE_URL}${path}?${params.toString()}`;
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (method === 'POST' && body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetchWithProxy(url, options);
    return await response.json();
  };

  let result = await makeRequest(token.access_token);

  if (result.error === 'error_auth' || result.message?.includes('Invalid access_token')) {
    console.log('[SCHEDULER] Token invalid, refreshing...');
    const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);
    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      result = await makeRequest(newToken.access_token);
    }
  }

  return result;
}

// ==================== MAIN LOGIC ====================

/**
 * Kiểm tra xem timeslot đã có Flash Sale chưa
 */
async function checkTimeslotHasFlashSale(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  timeslotId: number
): Promise<{ exists: boolean; flashSaleId?: number }> {
  // Lấy danh sách Flash Sale sắp tới (type=1) và đang chạy (type=2)
  const result = await callShopeeAPI(
    supabase,
    credentials,
    '/api/v2/shop_flash_sale/get_shop_flash_sale_list',
    'GET',
    shopId,
    token,
    undefined,
    { type: 0, offset: 0, limit: 100 } // type=0 lấy tất cả
  ) as { response?: { flash_sale_list?: Array<{ timeslot_id: number; flash_sale_id: number; type: number }> } };

  const flashSaleList = result?.response?.flash_sale_list || [];
  
  // Tìm FS có cùng timeslot_id và đang active (type 1 hoặc 2)
  const existingFS = flashSaleList.find(
    fs => fs.timeslot_id === timeslotId && (fs.type === 1 || fs.type === 2)
  );

  if (existingFS) {
    return { exists: true, flashSaleId: existingFS.flash_sale_id };
  }

  return { exists: false };
}

/**
 * Lấy template items từ Flash Sale gần nhất
 */
async function getTemplateItems(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string }
): Promise<Array<Record<string, unknown>>> {
  // Lấy Flash Sale gần nhất từ DB
  const { data: fsData } = await supabase
    .from('apishopee_flash_sale_data')
    .select('flash_sale_id, type')
    .eq('shop_id', shopId)
    .in('type', [1, 2]) // Sắp tới hoặc đang chạy
    .order('start_time', { ascending: false })
    .limit(1)
    .single();

  if (!fsData?.flash_sale_id) {
    console.log('[SCHEDULER] No template flash sale found');
    return [];
  }

  // Lấy items từ Flash Sale template
  const result = await callShopeeAPI(
    supabase,
    credentials,
    '/api/v2/shop_flash_sale/get_shop_flash_sale_items',
    'GET',
    shopId,
    token,
    undefined,
    { flash_sale_id: fsData.flash_sale_id, offset: 0, limit: 100 }
  ) as { response?: { item_info?: FlashSaleItem[]; models?: FlashSaleModel[] } };

  const itemInfoList = result?.response?.item_info || [];
  const modelsList = result?.response?.models || [];

  // Map items với models
  const itemsWithModels = itemInfoList.map((item: FlashSaleItem) => {
    const itemModels = modelsList.filter((m: FlashSaleModel) => m.item_id === item.item_id);
    return { ...item, models: itemModels.length > 0 ? itemModels : undefined };
  });

  // Chỉ lấy items enabled
  const enabledItems = itemsWithModels.filter((item: FlashSaleItem) => item.status === 1);

  // Convert sang format để add vào FS mới
  return enabledItems.map((item: FlashSaleItem) => {
    const enabledModels = item.models?.filter(m => m.status === 1) || [];
    const isNonVariantWithModel = enabledModels.length === 1 && enabledModels[0].model_id === 0;

    if (isNonVariantWithModel) {
      const model = enabledModels[0];
      if (!model.input_promotion_price || model.input_promotion_price <= 0) return null;
      return {
        item_id: item.item_id,
        purchase_limit: item.purchase_limit || 0,
        item_input_promo_price: model.input_promotion_price,
        item_stock: model.campaign_stock || 0,
      };
    }

    if (enabledModels.length === 0 && item.input_promotion_price && item.input_promotion_price > 0) {
      return {
        item_id: item.item_id,
        purchase_limit: item.purchase_limit || 0,
        item_input_promo_price: item.input_promotion_price,
        item_stock: item.campaign_stock || 0,
      };
    }

    if (enabledModels.length === 0) return null;

    return {
      item_id: item.item_id,
      purchase_limit: item.purchase_limit || 0,
      models: enabledModels.map(m => ({
        model_id: m.model_id,
        input_promo_price: m.input_promotion_price || 0,
        stock: m.campaign_stock || 0,
      })),
    };
  }).filter((item): item is Record<string, unknown> => {
    if (!item) return false;
    if ('models' in item && Array.isArray(item.models)) {
      return item.models.length > 0 && item.models.every((m: { input_promo_price: number }) => m.input_promo_price > 0);
    }
    if ('item_input_promo_price' in item) {
      return (item.item_input_promo_price as number) > 0;
    }
    return false;
  });
}

/**
 * Xử lý một scheduled job
 */
async function processJob(
  supabase: ReturnType<typeof createClient>,
  job: ScheduledJob
): Promise<{ success: boolean; message: string; flashSaleId?: number }> {
  console.log(`[SCHEDULER] Processing job ${job.id} for shop ${job.shop_id}, timeslot ${job.timeslot_id}`);

  try {
    // Kiểm tra xem timeslot đã qua chưa (thêm buffer 5 phút)
    const nowUnix = Math.floor(Date.now() / 1000);
    const bufferSeconds = 5 * 60; // 5 phút buffer
    
    if (job.slot_start_time && (nowUnix + bufferSeconds) >= job.slot_start_time) {
      const errorMsg = `Khung giờ đã qua hoặc sắp bắt đầu (${new Date(job.slot_start_time * 1000).toLocaleString('vi-VN')})`;
      console.log(`[SCHEDULER] ${errorMsg}`);
      
      await supabase
        .from('apishopee_flash_sale_auto_history')
        .update({
          status: 'error',
          error_message: errorMsg,
          executed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return { success: false, message: errorMsg };
    }

    // Update status to processing
    await supabase
      .from('apishopee_flash_sale_auto_history')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', job.id);

    const credentials = await getPartnerCredentials(supabase, job.shop_id);
    const token = await getTokenWithAutoRefresh(supabase, job.shop_id);

    // 1. Kiểm tra xem timeslot đã có Flash Sale chưa
    const { exists, flashSaleId: existingFsId } = await checkTimeslotHasFlashSale(
      supabase, credentials, job.shop_id, token, job.timeslot_id
    );

    if (exists) {
      // Slot đã có FS (có thể tạo thủ công trên Shopee)
      const errorMsg = `Khung giờ đã có Flash Sale #${existingFsId} (có thể được tạo thủ công trên Shopee)`;
      console.log(`[SCHEDULER] ${errorMsg}`);
      
      await supabase
        .from('apishopee_flash_sale_auto_history')
        .update({
          status: 'error',
          error_message: errorMsg,
          flash_sale_id: existingFsId, // Lưu lại FS ID đã tồn tại
          executed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return { success: false, message: errorMsg, flashSaleId: existingFsId };
    }

    // 2. Lấy template items
    const itemsToAdd = await getTemplateItems(supabase, credentials, job.shop_id, token);
    
    if (itemsToAdd.length === 0) {
      const errorMsg = 'Không có sản phẩm mẫu để thêm vào Flash Sale';
      await supabase
        .from('apishopee_flash_sale_auto_history')
        .update({
          status: 'error',
          error_message: errorMsg,
          executed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return { success: false, message: errorMsg };
    }

    // 3. Tạo Flash Sale mới
    const createResult = await callShopeeAPI(
      supabase,
      credentials,
      '/api/v2/shop_flash_sale/create_shop_flash_sale',
      'POST',
      job.shop_id,
      token,
      { timeslot_id: job.timeslot_id }
    ) as { response?: { flash_sale_id?: number }; error?: string; message?: string };

    if (createResult.error || !createResult.response?.flash_sale_id) {
      const errorMsg = createResult.message || createResult.error || 'Không thể tạo Flash Sale';
      await supabase
        .from('apishopee_flash_sale_auto_history')
        .update({
          status: 'error',
          error_message: errorMsg,
          executed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      return { success: false, message: errorMsg };
    }

    const newFlashSaleId = createResult.response.flash_sale_id;
    console.log(`[SCHEDULER] Created Flash Sale #${newFlashSaleId}`);

    // 4. Thêm sản phẩm vào Flash Sale
    const addResult = await callShopeeAPI(
      supabase,
      credentials,
      '/api/v2/shop_flash_sale/add_shop_flash_sale_items',
      'POST',
      job.shop_id,
      token,
      { flash_sale_id: newFlashSaleId, items: itemsToAdd }
    ) as { error?: string; message?: string };

    let message = `Đã tạo Flash Sale #${newFlashSaleId}`;
    if (addResult.error) {
      message += ` (Lỗi thêm SP: ${addResult.message || addResult.error})`;
    } else {
      message += ` với ${itemsToAdd.length} sản phẩm`;
    }

    // 5. Update success
    await supabase
      .from('apishopee_flash_sale_auto_history')
      .update({
        status: 'success',
        flash_sale_id: newFlashSaleId,
        items_count: itemsToAdd.length,
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    console.log(`[SCHEDULER] Job ${job.id} completed: ${message}`);
    return { success: true, message, flashSaleId: newFlashSaleId };

  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error(`[SCHEDULER] Job ${job.id} failed:`, errorMsg);

    await supabase
      .from('apishopee_flash_sale_auto_history')
      .update({
        status: 'error',
        error_message: errorMsg,
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return { success: false, message: errorMsg };
  }
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const now = new Date().toISOString();

    console.log(`[SCHEDULER] Running at ${now}`);

    // Tìm các scheduled jobs đến hạn
    const { data: pendingJobs, error: queryError } = await supabase
      .from('apishopee_flash_sale_auto_history')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(10); // Xử lý tối đa 10 jobs mỗi lần

    if (queryError) {
      throw new Error(`Query error: ${queryError.message}`);
    }

    if (!pendingJobs || pendingJobs.length === 0) {
      console.log('[SCHEDULER] No pending jobs found');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No pending jobs',
        processed: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[SCHEDULER] Found ${pendingJobs.length} pending jobs`);

    // Xử lý từng job
    const results = [];
    for (const job of pendingJobs) {
      const result = await processJob(supabase, job as ScheduledJob);
      results.push({
        jobId: job.id,
        shopId: job.shop_id,
        timeslotId: job.timeslot_id,
        ...result,
      });

      // Delay giữa các jobs để tránh rate limit
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    console.log(`[SCHEDULER] Completed: ${successCount} success, ${errorCount} errors`);

    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${results.length} jobs`,
      processed: results.length,
      successCount,
      errorCount,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[SCHEDULER] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: (error as Error).message,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
