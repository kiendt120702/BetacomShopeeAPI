/**
 * Supabase Edge Function: Shopee Product
 * Quản lý Product API với Auto-Refresh Token
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

// Supabase config
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
  const { error } = await supabase.from('shops').upsert(
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
    .from('shops')
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
      await supabase.from('shops').upsert({
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
    
    // Lấy partner credentials từ database
    const credentials = await getPartnerCredentials(supabase, shop_id);
    const token = await getTokenWithAutoRefresh(supabase, shop_id);

    let result;

    switch (action) {
      case 'get-item-base-info': {
        // item_id_list: array of item_ids (max 50)
        const itemIdList = params.item_id_list || [];
        if (itemIdList.length === 0) {
          return new Response(JSON.stringify({ error: 'item_id_list is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/product/get_item_base_info',
          'GET',
          shop_id,
          token,
          undefined,
          {
            item_id_list: itemIdList.join(','),
            need_tax_info: params.need_tax_info ?? false,
            need_complaint_policy: params.need_complaint_policy ?? false,
          }
        );
        break;
      }

      case 'get-item-list': {
        // Lấy danh sách item_id của shop
        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/product/get_item_list',
          'GET',
          shop_id,
          token,
          undefined,
          {
            offset: params.offset ?? 0,
            page_size: params.page_size ?? 20,
            item_status: params.item_status || 'NORMAL',
          }
        );
        break;
      }

      case 'get-model-list': {
        // Lấy danh sách models của item
        if (!params.item_id) {
          return new Response(JSON.stringify({ error: 'item_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/product/get_model_list',
          'GET',
          shop_id,
          token,
          undefined,
          { item_id: params.item_id }
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
