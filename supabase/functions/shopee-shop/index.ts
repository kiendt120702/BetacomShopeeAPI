/**
 * Supabase Edge Function: Shopee Shop
 * Quản lý Shop API với Auto-Refresh Token và Caching
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
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || ''; // VPS Proxy URL
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const TOKEN_BUFFER_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000; // Cache 30 phút

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

async function getTokenWithAutoRefresh(
  supabase: ReturnType<typeof createClient>,
  shopId: number
) {
  // 1. Tìm token từ bảng shops (nơi frontend lưu token)
  const { data: shopData, error: shopError } = await supabase
    .from('apishopee_shops')
    .select('shop_id, access_token, refresh_token, expired_at, merchant_id')
    .eq('shop_id', shopId)
    .single();

  if (!shopError && shopData?.access_token) {
    return shopData;
  }

  // Token not found after schema consolidation
  throw new Error('Token not found. Please authenticate first.');
}

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
    console.log('Calling Shopee API:', path);

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
    console.log('[AUTO-RETRY] Invalid token detected, refreshing...');

    const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);

    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      
      // Cập nhật bảng shops
      await supabase.from('apishopee_shops').upsert({
        shop_id: shopId,
        access_token: newToken.access_token,
        refresh_token: newToken.refresh_token,
        expired_at: Date.now() + newToken.expire_in * 1000,
        token_updated_at: new Date().toISOString(),
      }, { onConflict: 'shop_id' });
      
      result = await makeRequest(newToken.access_token);
    }
  }

  return result;
}


// ==================== CACHE FUNCTIONS ====================

// Cache được lưu trực tiếp trong bảng shops
interface ShopCacheData {
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
  updated_at: string;
}

async function getCachedShopInfo(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<ShopCacheData | null> {
  const { data, error } = await supabase
    .from('apishopee_shops')
    .select('*')
    .eq('shop_id', shopId)
    .single();

  if (error || !data) {
    return null;
  }

  // Kiểm tra cache còn hạn không (dựa vào updated_at)
  const updatedAt = new Date(data.updated_at).getTime();
  const now = Date.now();
  
  // Chỉ dùng cache nếu đã có shop_name và cache chưa quá 30 phút
  if (!data.shop_name || (now - updatedAt > CACHE_TTL_MS)) {
    console.log('[CACHE] Cache expired or no shop_name for shop:', shopId);
    return null;
  }

  console.log('[CACHE] Cache hit for shop:', shopId);
  return data as ShopCacheData;
}

async function saveShopInfoCache(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  shopInfo: Record<string, unknown>,
  shopProfile: Record<string, unknown>
) {
  const shopName = shopInfo.shop_name as string || null;
  const shopLogo = (shopProfile.response as Record<string, unknown>)?.shop_logo as string || null;
  const region = shopInfo.region as string || null;
  const description = (shopProfile.response as Record<string, unknown>)?.description as string || null;
  
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  
  // Cập nhật tất cả thông tin shop vào bảng shops
  if (shopName) updateData.shop_name = shopName;
  if (shopLogo) updateData.shop_logo = shopLogo;
  if (region) updateData.region = region;
  if (description) updateData.description = description;
  if (shopInfo.status !== undefined) updateData.status = shopInfo.status;
  if (shopInfo.is_cb !== undefined) updateData.is_cb = shopInfo.is_cb;
  if (shopInfo.is_sip !== undefined) updateData.is_sip = shopInfo.is_sip;
  if (shopInfo.is_upgraded_cbsc !== undefined) updateData.is_upgraded_cbsc = shopInfo.is_upgraded_cbsc;
  if (shopInfo.merchant_id !== undefined) updateData.merchant_id = shopInfo.merchant_id;
  if (shopInfo.shop_fulfillment_flag !== undefined) updateData.shop_fulfillment_flag = shopInfo.shop_fulfillment_flag;
  if (shopInfo.is_main_shop !== undefined) updateData.is_main_shop = shopInfo.is_main_shop;
  if (shopInfo.is_direct_shop !== undefined) updateData.is_direct_shop = shopInfo.is_direct_shop;
  if (shopInfo.linked_main_shop_id !== undefined) updateData.linked_main_shop_id = shopInfo.linked_main_shop_id;
  if (shopInfo.linked_direct_shop_list !== undefined) updateData.linked_direct_shop_list = shopInfo.linked_direct_shop_list;
  if (shopInfo.sip_affi_shops !== undefined) updateData.sip_affi_shops = shopInfo.sip_affi_shops;
  if (shopInfo.is_one_awb !== undefined) updateData.is_one_awb = shopInfo.is_one_awb;
  if (shopInfo.is_mart_shop !== undefined) updateData.is_mart_shop = shopInfo.is_mart_shop;
  if (shopInfo.is_outlet_shop !== undefined) updateData.is_outlet_shop = shopInfo.is_outlet_shop;
  if (shopInfo.auth_time !== undefined) updateData.auth_time = shopInfo.auth_time;
  if (shopInfo.expire_time !== undefined) updateData.expire_time = shopInfo.expire_time;

  const { error } = await supabase
    .from('apishopee_shops')
    .update(updateData)
    .eq('shop_id', shopId);

  if (error) {
    console.error('[CACHE] Failed to update shops:', error);
  } else {
    console.log('[CACHE] Updated shops table for shop:', shopId, 'with name:', shopName);
  }
}

function formatCacheToResponse(cache: ShopCacheData) {
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
    cached_at: cache.updated_at,
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
        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);
        
        const [shopInfo, shopProfile] = await Promise.all([
          callShopeeAPIWithRetry(supabase, credentials, '/api/v2/shop/get_shop_info', 'GET', shop_id, token),
          callShopeeAPIWithRetry(supabase, credentials, '/api/v2/shop/get_profile', 'GET', shop_id, token),
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
        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);
        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/shop/get_shop_info',
          'GET',
          shop_id,
          token
        );
        break;
      }

      case 'get-profile': {
        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);
        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/shop/get_profile',
          'GET',
          shop_id,
          token
        );
        break;
      }

      case 'get-notification': {
        const { cursor, page_size } = body;
        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);
        
        const extraParams: Record<string, number> = {};
        if (cursor !== undefined && cursor !== null) {
          extraParams.cursor = cursor;
        }
        if (page_size !== undefined && page_size !== null) {
          extraParams.page_size = page_size;
        }

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/shop/get_shop_notification',
          'GET',
          shop_id,
          token,
          undefined,
          extraParams
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
