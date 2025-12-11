/**
 * Supabase Edge Function: Shopee Shop
 * Quản lý Shop API với Auto-Refresh Token và Caching
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
const CACHE_TTL_MS = 30 * 60 * 1000; // Cache 30 phút

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
}

async function getTokenWithAutoRefresh(
  supabase: ReturnType<typeof createClient>,
  shopId: number
) {
  const { data, error } = await supabase
    .from('shopee_tokens')
    .select('*')
    .eq('shop_id', shopId)
    .single();

  if (error || !data) {
    throw new Error('Token not found. Please authenticate first.');
  }

  const now = Date.now();
  const isExpiringSoon = data.expired_at && (data.expired_at - now) < TOKEN_BUFFER_MS;

  if (isExpiringSoon) {
    console.log('[AUTO-REFRESH] Token expiring soon, refreshing...');
    
    try {
      const newToken = await refreshAccessToken(data.refresh_token, shopId);

      if (newToken.error) {
        console.error('[AUTO-REFRESH] Failed:', newToken.error, newToken.message);
        return data;
      }

      await saveToken(supabase, shopId, newToken);
      
      return {
        ...data,
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token,
        expired_at: Date.now() + newToken.expire_in * 1000,
      };
    } catch (refreshError) {
      console.error('[AUTO-REFRESH] Error:', refreshError);
      return data;
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
  extraParams?: Record<string, string | number | boolean>
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

  let result = await makeRequest(token.access_token);

  if (result.error === 'error_auth' || result.message?.includes('Invalid access_token')) {
    console.log('[AUTO-RETRY] Invalid token detected, refreshing...');

    const newToken = await refreshAccessToken(token.refresh_token, shopId);

    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      result = await makeRequest(newToken.access_token);
    }
  }

  return result;
}


// ==================== CACHE FUNCTIONS ====================

interface ShopInfoCache {
  shop_id: number;
  shop_name: string | null;
  region: string | null;
  status: string | null;
  is_cb: boolean;
  is_sip: boolean;
  is_upgraded_cbsc: boolean;
  merchant_id: number | null;
  shop_fulfillment_flag: string | null;
  is_main_shop: boolean;
  is_direct_shop: boolean;
  linked_main_shop_id: number | null;
  linked_direct_shop_list: unknown[] | null;
  sip_affi_shops: unknown[] | null;
  is_one_awb: boolean | null;
  is_mart_shop: boolean | null;
  is_outlet_shop: boolean | null;
  auth_time: number | null;
  expire_time: number | null;
  shop_logo: string | null;
  description: string | null;
  cached_at: string;
}

async function getCachedShopInfo(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<ShopInfoCache | null> {
  const { data, error } = await supabase
    .from('shop_info_cache')
    .select('*')
    .eq('shop_id', shopId)
    .single();

  if (error || !data) {
    return null;
  }

  // Kiểm tra cache còn hạn không
  const cachedAt = new Date(data.cached_at).getTime();
  const now = Date.now();
  
  if (now - cachedAt > CACHE_TTL_MS) {
    console.log('[CACHE] Cache expired for shop:', shopId);
    return null;
  }

  console.log('[CACHE] Cache hit for shop:', shopId);
  return data as ShopInfoCache;
}

async function saveShopInfoCache(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  shopInfo: Record<string, unknown>,
  shopProfile: Record<string, unknown>
) {
  const cacheData = {
    shop_id: shopId,
    shop_name: shopInfo.shop_name || null,
    region: shopInfo.region || null,
    status: shopInfo.status || null,
    is_cb: shopInfo.is_cb || false,
    is_sip: shopInfo.is_sip || false,
    is_upgraded_cbsc: shopInfo.is_upgraded_cbsc || false,
    merchant_id: shopInfo.merchant_id || null,
    shop_fulfillment_flag: shopInfo.shop_fulfillment_flag || null,
    is_main_shop: shopInfo.is_main_shop || false,
    is_direct_shop: shopInfo.is_direct_shop || false,
    linked_main_shop_id: shopInfo.linked_main_shop_id || null,
    linked_direct_shop_list: shopInfo.linked_direct_shop_list || null,
    sip_affi_shops: shopInfo.sip_affi_shops || null,
    is_one_awb: shopInfo.is_one_awb ?? null,
    is_mart_shop: shopInfo.is_mart_shop ?? null,
    is_outlet_shop: shopInfo.is_outlet_shop ?? null,
    auth_time: shopInfo.auth_time || null,
    expire_time: shopInfo.expire_time || null,
    shop_logo: (shopProfile.response as Record<string, unknown>)?.shop_logo || null,
    description: (shopProfile.response as Record<string, unknown>)?.description || null,
    cached_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('shop_info_cache')
    .upsert(cacheData, { onConflict: 'shop_id' });

  if (error) {
    console.error('[CACHE] Failed to save cache:', error);
  } else {
    console.log('[CACHE] Saved cache for shop:', shopId);
  }
}

function formatCacheToResponse(cache: ShopInfoCache) {
  return {
    info: {
      error: '',
      message: '',
      request_id: 'cached',
      shop_name: cache.shop_name,
      region: cache.region,
      status: cache.status,
      is_cb: cache.is_cb,
      is_sip: cache.is_sip,
      is_upgraded_cbsc: cache.is_upgraded_cbsc,
      merchant_id: cache.merchant_id,
      shop_fulfillment_flag: cache.shop_fulfillment_flag,
      is_main_shop: cache.is_main_shop,
      is_direct_shop: cache.is_direct_shop,
      linked_main_shop_id: cache.linked_main_shop_id,
      linked_direct_shop_list: cache.linked_direct_shop_list,
      sip_affi_shops: cache.sip_affi_shops,
      is_one_awb: cache.is_one_awb,
      is_mart_shop: cache.is_mart_shop,
      is_outlet_shop: cache.is_outlet_shop,
      auth_time: cache.auth_time,
      expire_time: cache.expire_time,
    },
    profile: {
      error: '',
      message: '',
      request_id: 'cached',
      response: {
        shop_logo: cache.shop_logo,
        description: cache.description,
        shop_name: cache.shop_name,
      },
    },
    cached: true,
    cached_at: cache.cached_at,
  };
}


// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id, force_refresh } = body;

    if (!shop_id) {
      return new Response(JSON.stringify({ error: 'shop_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let result;

    switch (action) {
      // Action mới: lấy cả info + profile với caching
      case 'get-full-info': {
        // Kiểm tra cache trước (trừ khi force_refresh)
        if (!force_refresh) {
          const cached = await getCachedShopInfo(supabase, shop_id);
          if (cached) {
            return new Response(JSON.stringify(formatCacheToResponse(cached)), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }

        // Cache miss hoặc force refresh -> gọi API
        const token = await getTokenWithAutoRefresh(supabase, shop_id);
        
        const [shopInfo, shopProfile] = await Promise.all([
          callShopeeAPI(supabase, '/api/v2/shop/get_shop_info', 'GET', shop_id, token),
          callShopeeAPI(supabase, '/api/v2/shop/get_profile', 'GET', shop_id, token),
        ]);

        // Lưu cache nếu không có lỗi
        const infoResult = shopInfo as Record<string, unknown>;
        const profileResult = shopProfile as Record<string, unknown>;
        
        if (!infoResult.error) {
          await saveShopInfoCache(supabase, shop_id, infoResult, profileResult);
        }

        result = {
          info: shopInfo,
          profile: shopProfile,
          cached: false,
        };
        break;
      }

      case 'get-shop-info': {
        const token = await getTokenWithAutoRefresh(supabase, shop_id);
        result = await callShopeeAPI(
          supabase,
          '/api/v2/shop/get_shop_info',
          'GET',
          shop_id,
          token
        );
        break;
      }

      case 'get-profile': {
        const token = await getTokenWithAutoRefresh(supabase, shop_id);
        result = await callShopeeAPI(
          supabase,
          '/api/v2/shop/get_profile',
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
