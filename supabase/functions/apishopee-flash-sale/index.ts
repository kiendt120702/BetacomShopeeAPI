/**
 * Supabase Edge Function: Shopee Flash Sale
 * Quản lý Flash Sale API với Auto-Refresh Token
 * Hỗ trợ multi-partner: lấy credentials từ database
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

// Interface cho partner credentials
interface PartnerCredentials {
  partnerId: number;
  partnerKey: string;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Lấy partner credentials từ database hoặc fallback env
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

/**
 * Tạo signature cho Shopee API
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
 * Refresh access token
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
 * Lấy token với auto refresh nếu hết hạn
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
 * Gọi Shopee API với auto retry khi token invalid
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
    console.log('[FLASH-SALE] Calling Shopee API:', path);

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

  // Auto retry if token invalid
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


// ==================== FLASH SALE API ENDPOINTS ====================

const FLASH_SALE_PATHS = {
  GET_TIME_SLOTS: '/api/v2/shop_flash_sale/get_time_slot_id',
  CREATE: '/api/v2/shop_flash_sale/create_shop_flash_sale',
  GET_DETAIL: '/api/v2/shop_flash_sale/get_shop_flash_sale',
  GET_LIST: '/api/v2/shop_flash_sale/get_shop_flash_sale_list',
  UPDATE: '/api/v2/shop_flash_sale/update_shop_flash_sale',
  DELETE: '/api/v2/shop_flash_sale/delete_shop_flash_sale',
  ADD_ITEMS: '/api/v2/shop_flash_sale/add_shop_flash_sale_items',
  GET_ITEMS: '/api/v2/shop_flash_sale/get_shop_flash_sale_items',
  UPDATE_ITEMS: '/api/v2/shop_flash_sale/update_shop_flash_sale_items',
  DELETE_ITEMS: '/api/v2/shop_flash_sale/delete_shop_flash_sale_items',
  GET_CRITERIA: '/api/v2/shop_flash_sale/get_item_criteria',
};

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id } = body;

    if (!shop_id) {
      return new Response(JSON.stringify({ error: 'shop_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const credentials = await getPartnerCredentials(supabase, shop_id);
    const token = await getTokenWithAutoRefresh(supabase, shop_id);

    let result;

    switch (action) {
      // ==================== TIME SLOTS ====================
      case 'get-time-slots': {
        const { start_time, end_time } = body;
        const now = Math.floor(Date.now() / 1000);
        
        // Shopee API yêu cầu BẮT BUỘC cả start_time và end_time
        const extraParams: Record<string, number> = {
          start_time: start_time || now,
          end_time: end_time || (now + 30 * 24 * 60 * 60), // +30 days
        };

        console.log('[FLASH-SALE] get-time-slots params:', extraParams);

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.GET_TIME_SLOTS,
          'GET',
          shop_id,
          token,
          undefined,
          extraParams
        );
        
        console.log('[FLASH-SALE] get-time-slots result:', JSON.stringify(result));
        break;
      }

      // ==================== CREATE FLASH SALE ====================
      case 'create-flash-sale': {
        const { timeslot_id } = body;
        if (!timeslot_id) {
          return new Response(JSON.stringify({ error: 'timeslot_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.CREATE,
          'POST',
          shop_id,
          token,
          { timeslot_id }
        );
        break;
      }

      // ==================== GET FLASH SALE DETAIL ====================
      case 'get-flash-sale': {
        const { flash_sale_id } = body;
        if (!flash_sale_id) {
          return new Response(JSON.stringify({ error: 'flash_sale_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Đảm bảo flash_sale_id là số nguyên
        const flashSaleIdNum = Number(flash_sale_id);

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.GET_DETAIL,
          'GET',
          shop_id,
          token,
          undefined,
          { flash_sale_id: flashSaleIdNum }
        );
        break;
      }

      // ==================== GET FLASH SALE LIST ====================
      case 'get-flash-sale-list': {
        const { type = 0, offset = 0, limit = 100 } = body;

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.GET_LIST,
          'GET',
          shop_id,
          token,
          undefined,
          { type, offset, limit }
        );
        break;
      }

      // ==================== UPDATE FLASH SALE ====================
      case 'update-flash-sale': {
        const { flash_sale_id, status } = body;
        if (!flash_sale_id) {
          return new Response(JSON.stringify({ error: 'flash_sale_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Đảm bảo flash_sale_id là số nguyên
        const flashSaleIdNum = Number(flash_sale_id);
        const updateBody: Record<string, unknown> = { flash_sale_id: flashSaleIdNum };
        if (status !== undefined) updateBody.status = Number(status);

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.UPDATE,
          'POST',
          shop_id,
          token,
          updateBody
        );
        break;
      }

      // ==================== DELETE FLASH SALE ====================
      case 'delete-flash-sale': {
        const { flash_sale_id } = body;
        if (!flash_sale_id) {
          return new Response(JSON.stringify({ error: 'flash_sale_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Đảm bảo flash_sale_id là số nguyên
        const flashSaleIdNum = Number(flash_sale_id);

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.DELETE,
          'POST',
          shop_id,
          token,
          { flash_sale_id: flashSaleIdNum }
        );
        break;
      }

      // ==================== ADD ITEMS ====================
      case 'add-items': {
        const { flash_sale_id, items } = body;
        if (!flash_sale_id || !items || !Array.isArray(items)) {
          return new Response(JSON.stringify({ error: 'flash_sale_id and items array are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Đảm bảo flash_sale_id là số nguyên
        const flashSaleIdNum = Number(flash_sale_id);

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.ADD_ITEMS,
          'POST',
          shop_id,
          token,
          { flash_sale_id: flashSaleIdNum, items }
        );
        break;
      }

      // ==================== GET ITEMS ====================
      case 'get-items': {
        const { flash_sale_id, offset = 0, limit = 100 } = body;
        if (!flash_sale_id) {
          return new Response(JSON.stringify({ error: 'flash_sale_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Đảm bảo flash_sale_id là số nguyên (Shopee API yêu cầu)
        const flashSaleIdNum = Number(flash_sale_id);
        if (isNaN(flashSaleIdNum)) {
          return new Response(JSON.stringify({ error: 'flash_sale_id must be a valid number' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.GET_ITEMS,
          'GET',
          shop_id,
          token,
          undefined,
          { flash_sale_id: flashSaleIdNum, offset, limit }
        );
        break;
      }

      // ==================== UPDATE ITEMS ====================
      case 'update-items': {
        const { flash_sale_id, items } = body;
        if (!flash_sale_id || !items || !Array.isArray(items)) {
          return new Response(JSON.stringify({ error: 'flash_sale_id and items array are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Đảm bảo flash_sale_id là số nguyên
        const flashSaleIdNum = Number(flash_sale_id);

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.UPDATE_ITEMS,
          'POST',
          shop_id,
          token,
          { flash_sale_id: flashSaleIdNum, items }
        );
        break;
      }

      // ==================== DELETE ITEMS ====================
      case 'delete-items': {
        const { flash_sale_id, item_id } = body;
        if (!flash_sale_id || !item_id) {
          return new Response(JSON.stringify({ error: 'flash_sale_id and item_id are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Đảm bảo flash_sale_id và item_id là số nguyên
        const flashSaleIdNum = Number(flash_sale_id);
        const itemIdNum = Number(item_id);

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.DELETE_ITEMS,
          'POST',
          shop_id,
          token,
          { flash_sale_id: flashSaleIdNum, item_id: itemIdNum }
        );
        break;
      }

      // ==================== GET ITEM CRITERIA ====================
      case 'get-criteria': {
        const { item_id } = body;
        if (!item_id) {
          return new Response(JSON.stringify({ error: 'item_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          FLASH_SALE_PATHS.GET_CRITERIA,
          'GET',
          shop_id,
          token,
          undefined,
          { item_id }
        );
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
    console.error('[FLASH-SALE] Error:', error);
    // Return 200 with error in body to allow frontend to read error details
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
