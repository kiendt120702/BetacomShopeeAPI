/**
 * Supabase Edge Function: Shopee Sync Worker
 * Background sync worker để đồng bộ Flash Sale data từ Shopee
 * 
 * Logic nghiệp vụ:
 * 1. Gọi API lấy toàn bộ Flash Sale từ Shopee
 * 2. Xóa dữ liệu cũ và insert dữ liệu mới
 * 3. Lọc Flash Sale đã kết thúc trong 30 ngày qua
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
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Constants
const DAYS_EXPIRED = 30; // Lấy Flash Sale đã kết thúc trong 30 ngày qua

// Interface cho partner credentials
interface PartnerCredentials {
  partnerId: number;
  partnerKey: string;
}

// Flash Sale data interface từ Shopee API
interface ShopeeFlashSale {
  flash_sale_id: number;
  timeslot_id: number;
  status: number;           // 0: Deleted, 1: Enabled, 2: Disabled, 3: Rejected
  start_time: number;       // Unix timestamp
  end_time: number;         // Unix timestamp
  enabled_item_count: number;
  item_count: number;
  type: number;             // 1: Upcoming, 2: Ongoing, 3: Expired
  remindme_count?: number;
  click_count?: number;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Lấy partner credentials từ shop hoặc fallback env
 */
async function getPartnerCredentials(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<PartnerCredentials> {
  const { data, error } = await supabase
    .from('apishopee_shops')
    .select('partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  if (data?.partner_id && data?.partner_key && !error) {
    console.log('[SYNC-WORKER] Using partner from shop:', data.partner_id);
    return {
      partnerId: data.partner_id,
      partnerKey: data.partner_key,
    };
  }

  console.log('[SYNC-WORKER] Using default partner from env:', DEFAULT_PARTNER_ID);
  return {
    partnerId: DEFAULT_PARTNER_ID,
    partnerKey: DEFAULT_PARTNER_KEY,
  };
}

/**
 * Gọi API qua proxy hoặc trực tiếp
 */
async function fetchWithProxy(targetUrl: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
    console.log('[PROXY] Calling via proxy:', PROXY_URL);
    return await fetch(proxyUrl, options);
  }
  return await fetch(targetUrl, options);
}

/**
 * Tạo HMAC-SHA256 signature cho Shopee API
 */
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

/**
 * Refresh access token khi hết hạn
 */
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

/**
 * Lưu token mới vào database
 */
async function saveToken(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  token: Record<string, unknown>
) {
  const { error } = await supabase.from('apishopee_shops').upsert(
    {
      shop_id: shopId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expire_in: token.expire_in,
      expired_at: Date.now() + (token.expire_in as number) * 1000,
      token_updated_at: new Date().toISOString(),
    },
    { onConflict: 'shop_id' }
  );

  if (error) {
    console.error('Failed to save token:', error);
    throw error;
  }
}

/**
 * Lấy token từ database với auto-refresh
 */
async function getTokenWithAutoRefresh(
  supabase: ReturnType<typeof createClient>,
  shopId: number
) {
  const { data: shopData, error: shopError } = await supabase
    .from('apishopee_shops')
    .select('shop_id, access_token, refresh_token, expired_at, merchant_id')
    .eq('shop_id', shopId)
    .single();

  if (!shopError && shopData?.access_token) {
    return shopData;
  }

  throw new Error('Token not found. Please authenticate first.');
}

/**
 * Gọi Shopee API với auto-retry khi token hết hạn
 */
async function callShopeeAPIWithRetry(
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
    console.log('[SYNC-WORKER] Calling Shopee API:', path, 'params:', extraParams);

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

  // Auto-retry khi token hết hạn
  if (result.error === 'error_auth' || result.message?.includes('Invalid access_token')) {
    console.log('[AUTO-RETRY] Invalid token detected, refreshing...');

    const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);

    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      result = await makeRequest(newToken.access_token);
    }
  }

  return result;
}

// ==================== FLASH SALE SYNC FUNCTIONS ====================

// Endpoint đúng theo Shopee API v2
const FLASH_SALE_LIST_PATH = '/api/v2/shop_flash_sale/get_shop_flash_sale_list';

/**
 * Lấy danh sách Flash Sale từ Shopee API
 * Endpoint: /api/v2/shop_flash_sale/get_shop_flash_sale_list
 * @param type 0: All, 1: Upcoming, 2: Ongoing, 3: Expired
 */
async function fetchFlashSaleList(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  type: 0 | 1 | 2 | 3 = 0
): Promise<ShopeeFlashSale[]> {
  const result = await callShopeeAPIWithRetry(
    supabase,
    credentials,
    FLASH_SALE_LIST_PATH,
    'GET',
    shopId,
    token,
    undefined,
    { type, offset: 0, limit: 100 }
  ) as { error?: string; message?: string; response?: { flash_sale_list?: ShopeeFlashSale[]; total_count?: number } };

  console.log(`[SYNC-WORKER] API Response for type=${type}:`, JSON.stringify({
    error: result.error,
    message: result.message,
    total_count: result.response?.total_count,
    flash_sale_count: result.response?.flash_sale_list?.length || 0,
  }));

  if (result.error) {
    console.error(`[SYNC-WORKER] Error fetching flash sales (type=${type}):`, result.message || result.error);
    return [];
  }

  return result.response?.flash_sale_list || [];
}

/**
 * Lọc Flash Sale theo thời gian
 * - Upcoming/Ongoing: Lấy tất cả (không filter)
 * - Expired: end_time trong 30 ngày qua
 */
function filterFlashSalesByTime(flashSales: ShopeeFlashSale[]): ShopeeFlashSale[] {
  const now = Math.floor(Date.now() / 1000);
  const daysExpiredBefore = now - (DAYS_EXPIRED * 24 * 60 * 60); // 30 ngày trước

  return flashSales.filter(sale => {
    // Flash Sale sắp diễn ra hoặc đang diễn ra - lấy tất cả
    if (sale.type === 1 || sale.type === 2) {
      return true;
    }
    // Flash Sale đã kết thúc - lấy trong 30 ngày qua
    if (sale.type === 3) {
      return sale.end_time >= daysExpiredBefore;
    }
    return false;
  });
}

/**
 * Update sync status in database
 */
async function updateSyncStatus(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  userId: string,
  updates: {
    is_syncing?: boolean;
    flash_sales_synced_at?: string;
    last_sync_error?: string | null;
    sync_progress?: Record<string, unknown> | null;
  }
) {
  const { error } = await supabase
    .from('apishopee_sync_status')
    .upsert(
      {
        shop_id: shopId,
        user_id: userId,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id,user_id' }
    );

  if (error) {
    console.error('[SYNC-WORKER] Failed to update sync status:', error);
  }
}

/**
 * Sync Flash Sale data từ Shopee API
 * Luôn gọi API lấy toàn bộ dữ liệu, sau đó upsert vào database
 */
async function syncFlashSaleData(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  userId: string,
  token: { access_token: string; refresh_token: string },
  _forceSync = false
): Promise<{ success: boolean; synced_count: number; error?: string }> {
  try {
    // Update sync status to syncing
    await updateSyncStatus(supabase, shopId, userId, {
      is_syncing: true,
      last_sync_error: null,
      sync_progress: { current_step: 'fetching', total_items: 0, processed_items: 0 },
    });

    // Fetch tất cả Flash Sales từ Shopee API với type=0 (All)
    console.log('[SYNC-WORKER] Fetching all Flash Sales (type=0)...');
    const allFlashSales = await fetchFlashSaleList(supabase, credentials, shopId, token, 0);

    console.log(`[SYNC-WORKER] Total fetched: ${allFlashSales.length}`);

    // Lọc theo thời gian
    const filteredFlashSales = filterFlashSalesByTime(allFlashSales);
    console.log(`[SYNC-WORKER] After time filter: ${filteredFlashSales.length} flash sales`);

    if (filteredFlashSales.length === 0) {
      console.log('[SYNC-WORKER] No flash sales to sync');
      await updateSyncStatus(supabase, shopId, userId, {
        is_syncing: false,
        flash_sales_synced_at: new Date().toISOString(),
        last_sync_error: null,
        sync_progress: { current_step: 'completed', total_items: 0, processed_items: 0 },
      });
      return { success: true, synced_count: 0 };
    }

    // Xóa dữ liệu cũ của shop này (shared data, không theo user)
    console.log('[SYNC-WORKER] Deleting old data for shop...');
    const { error: deleteError } = await supabase
      .from('apishopee_flash_sale_data')
      .delete()
      .eq('shop_id', shopId);

    if (deleteError) {
      console.error('[SYNC-WORKER] Delete error:', deleteError);
    }

    // Insert tất cả dữ liệu mới (shared per shop, synced_by tracks who synced)
    console.log('[SYNC-WORKER] Inserting new data...');
    const insertData = filteredFlashSales.map(sale => ({
      shop_id: shopId,
      user_id: null, // Data is shared per shop
      synced_by: userId, // Track who performed the sync
      flash_sale_id: sale.flash_sale_id,
      timeslot_id: sale.timeslot_id,
      status: sale.status,
      start_time: sale.start_time,
      end_time: sale.end_time,
      enabled_item_count: sale.enabled_item_count || 0,
      item_count: sale.item_count || 0,
      type: sale.type,
      remindme_count: sale.remindme_count || 0,
      click_count: sale.click_count || 0,
      raw_response: sale,
      synced_at: new Date().toISOString(),
    }));

    const { error: insertError } = await supabase
      .from('apishopee_flash_sale_data')
      .insert(insertData);

    if (insertError) {
      console.error('[SYNC-WORKER] Insert error:', insertError);
      throw new Error(`Failed to insert flash sales: ${insertError.message}`);
    }

    console.log(`[SYNC-WORKER] Successfully synced ${filteredFlashSales.length} flash sales`);

    // Update sync status to completed
    await updateSyncStatus(supabase, shopId, userId, {
      is_syncing: false,
      flash_sales_synced_at: new Date().toISOString(),
      last_sync_error: null,
      sync_progress: { 
        current_step: 'completed', 
        total_items: filteredFlashSales.length, 
        processed_items: filteredFlashSales.length 
      },
    });

    return { success: true, synced_count: filteredFlashSales.length };
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error('[SYNC-WORKER] Sync failed:', errorMessage);

    // Update sync status with error
    await updateSyncStatus(supabase, shopId, userId, {
      is_syncing: false,
      last_sync_error: errorMessage,
      sync_progress: null,
    });

    return { success: false, synced_count: 0, error: errorMessage };
  }
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id, user_id, force_sync } = body;

    if (!shop_id) {
      return new Response(JSON.stringify({ error: 'shop_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let result;

    switch (action) {
      case 'sync-flash-sale-data': {
        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);

        result = await syncFlashSaleData(supabase, credentials, shop_id, user_id, token, force_sync === true);
        break;
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[SYNC-WORKER] Error:', error);
    return new Response(JSON.stringify({ 
      error: (error as Error).message,
      success: false,
      details: 'Check Supabase Edge Function logs for more details'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
