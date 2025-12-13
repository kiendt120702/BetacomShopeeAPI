/**
 * Supabase Edge Function: Shopee Flash Sale
 * Quản lý Shop Flash Sale với Auto-Refresh Token
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Shopee API config
const SHOPEE_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const SHOPEE_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';

// Supabase config
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Token buffer time (5 phút trước khi hết hạn sẽ refresh)
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

/**
 * Tạo signature cho Shopee API
 */
function createSignature(
  partnerId: number,
  path: string,
  timestamp: number,
  accessToken = '',
  shopId = 0
): string {
  let baseString = `${partnerId}${path}${timestamp}`;
  if (accessToken) baseString += accessToken;
  if (shopId) baseString += shopId;

  const hmac = createHmac('sha256', SHOPEE_PARTNER_KEY);
  hmac.update(baseString);
  return hmac.digest('hex');
}

/**
 * Refresh access token từ Shopee
 */
async function refreshAccessToken(refreshToken: string, shopId: number) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const sign = createSignature(SHOPEE_PARTNER_ID, path, timestamp);

  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      partner_id: SHOPEE_PARTNER_ID,
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
  const { error } = await supabase.from('shopee_tokens').upsert(
    {
      shop_id: shopId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expire_in: token.expire_in,
      expired_at: Date.now() + (token.expire_in as number) * 1000,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'shop_id' }
  );

  if (error) {
    console.error('Failed to save token:', error);
    throw error;
  }

  console.log('[AUTO-REFRESH] Token saved successfully for shop:', shopId);
}

/**
 * Lấy token từ database, tự động refresh nếu hết hạn
 */
async function getTokenWithAutoRefresh(
  supabase: ReturnType<typeof createClient>,
  shopId: number
) {
  // 1. Tìm token từ bảng shops (nơi frontend lưu token)
  const { data: shopData, error: shopError } = await supabase
    .from('shops')
    .select('shop_id, access_token, refresh_token, expired_at, merchant_id')
    .eq('shop_id', shopId)
    .single();

  console.log(`[TOKEN] shops table query:`, { 
    found: !!shopData, 
    error: shopError?.message,
    hasAccessToken: !!shopData?.access_token 
  });

  let data = shopData;

  // 2. Fallback: Tìm trong bảng shopee_tokens (cũ)
  if (shopError || !shopData?.access_token) {
    const { data: tokenData, error: tokenError } = await supabase
      .from('shopee_tokens')
      .select('*')
      .eq('shop_id', shopId)
      .single();

    console.log(`[TOKEN] shopee_tokens query:`, { 
      found: !!tokenData, 
      error: tokenError?.message 
    });

    if (tokenError || !tokenData) {
      throw new Error('Token not found. Please authenticate first.');
    }
    data = tokenData;
  }

  // Kiểm tra token có sắp hết hạn không (buffer 5 phút)
  const now = Date.now();
  const isExpiringSoon = data.expired_at && (data.expired_at - now) < TOKEN_BUFFER_MS;

  if (isExpiringSoon) {
    console.log('[AUTO-REFRESH] Token expiring soon, refreshing...');
    
    try {
      const newToken = await refreshAccessToken(data.refresh_token, shopId);

      if (newToken.error) {
        console.error('[AUTO-REFRESH] Failed:', newToken.error, newToken.message);
        // Nếu refresh thất bại, vẫn thử dùng token cũ
        return data;
      }

      // Lưu token mới vào cả 2 bảng
      await saveToken(supabase, shopId, newToken);
      
      // Cập nhật bảng shops
      await supabase.from('shops').upsert({
        shop_id: shopId,
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token,
        expired_at: Date.now() + newToken.expire_in * 1000,
        token_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'shop_id' });

      console.log('[AUTO-REFRESH] Token refreshed successfully');
      
      return {
        ...data,
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token,
        expired_at: Date.now() + newToken.expire_in * 1000,
      };
    } catch (refreshError) {
      console.error('[AUTO-REFRESH] Error:', refreshError);
      // Fallback to old token
      return data;
    }
  }

  return data;
}

/**
 * Gọi Shopee API với auto-retry khi token invalid
 */
async function callShopeeAPIWithRetry(
  supabase: ReturnType<typeof createClient>,
  path: string,
  method: 'GET' | 'POST',
  shopId: number,
  token: { access_token: string; refresh_token: string },
  body?: Record<string, unknown>,
  extraParams?: Record<string, string | number>
): Promise<unknown> {
  const makeRequest = async (accessToken: string) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = createSignature(SHOPEE_PARTNER_ID, path, timestamp, accessToken, shopId);

    const params = new URLSearchParams({
      partner_id: SHOPEE_PARTNER_ID.toString(),
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
    console.log('Calling Shopee API:', path);

    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (method === 'POST' && body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    return await response.json();
  };

  // Gọi API lần đầu
  let result = await makeRequest(token.access_token);

  // Nếu lỗi invalid token, thử refresh và gọi lại
  if (result.error === 'error_auth' || result.message?.includes('Invalid access_token')) {
    console.log('[AUTO-RETRY] Invalid token detected, refreshing...');

    const newToken = await refreshAccessToken(token.refresh_token, shopId);

    if (!newToken.error) {
      // Lưu token mới
      await saveToken(supabase, shopId, newToken);
      
      // Gọi lại API với token mới
      result = await makeRequest(newToken.access_token);
      console.log('[AUTO-RETRY] Retried with new token');
    }
  }

  return result;
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id, ...params } = body;

    if (!shop_id) {
      return new Response(JSON.stringify({ error: 'shop_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    // Lấy token với auto-refresh
    const token = await getTokenWithAutoRefresh(supabase, shop_id);

    let result;

    switch (action) {
      case 'get-time-slots': {
        const now = Math.floor(Date.now() / 1000);
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/get_time_slot_id',
          'GET',
          shop_id,
          token,
          undefined,
          {
            start_time: params.start_time || now,
            end_time: params.end_time || now + 30 * 86400,
          }
        );
        break;
      }

      case 'create-flash-sale': {
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/create_shop_flash_sale',
          'POST',
          shop_id,
          token,
          { timeslot_id: params.timeslot_id }
        );
        break;
      }

      case 'get-flash-sale': {
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/get_shop_flash_sale',
          'GET',
          shop_id,
          token,
          undefined,
          { flash_sale_id: params.flash_sale_id }
        );
        break;
      }

      case 'get-flash-sale-list': {
        const extraParams: Record<string, string | number> = {
          type: params.type ?? 0,
          offset: params.offset ?? 0,
          limit: params.limit ?? 20,
        };
        
        const now = Math.floor(Date.now() / 1000);
        if (params.start_time && params.start_time >= now) {
          extraParams.start_time = params.start_time;
        }
        if (params.end_time) {
          extraParams.end_time = params.end_time;
        }
        
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/get_shop_flash_sale_list',
          'GET',
          shop_id,
          token,
          undefined,
          extraParams
        );
        break;
      }

      case 'update-flash-sale': {
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/update_shop_flash_sale',
          'POST',
          shop_id,
          token,
          {
            flash_sale_id: params.flash_sale_id,
            status: params.status,
          }
        );
        break;
      }

      case 'delete-flash-sale': {
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/delete_shop_flash_sale',
          'POST',
          shop_id,
          token,
          { flash_sale_id: params.flash_sale_id }
        );
        break;
      }

      case 'add-items': {
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/add_shop_flash_sale_items',
          'POST',
          shop_id,
          token,
          {
            flash_sale_id: params.flash_sale_id,
            items: params.items,
          }
        );
        break;
      }

      case 'get-items': {
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/get_shop_flash_sale_items',
          'GET',
          shop_id,
          token,
          undefined,
          {
            flash_sale_id: params.flash_sale_id,
            offset: params.offset ?? 0,
            limit: params.limit ?? 50,
          }
        );
        break;
      }

      case 'update-items': {
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/update_shop_flash_sale_items',
          'POST',
          shop_id,
          token,
          {
            flash_sale_id: params.flash_sale_id,
            items: params.items,
          }
        );
        break;
      }

      case 'delete-items': {
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/delete_shop_flash_sale_items',
          'POST',
          shop_id,
          token,
          {
            flash_sale_id: params.flash_sale_id,
            item_ids: params.item_ids,
          }
        );
        break;
      }

      case 'get-criteria': {
        result = await callShopeeAPIWithRetry(
          supabase,
          '/api/v2/shop_flash_sale/get_item_criteria',
          'GET',
          shop_id,
          token
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
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
