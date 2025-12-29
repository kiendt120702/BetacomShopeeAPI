/**
 * Supabase Edge Function: Shopee Ads
 * Quản lý Ads API với Auto-Refresh Token
 * Hỗ trợ multi-partner: lấy credentials từ database
 * 
 * Endpoints:
 * - get_product_level_campaign_id_list: Lấy danh sách campaign IDs
 * - get_product_level_campaign_setting_info: Lấy thông tin chi tiết campaign
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
    console.log('Calling Shopee Ads API:', path);

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
      case 'get-campaign-id-list': {
        // Lấy danh sách campaign IDs
        // ad_type: 'all' | 'auto' | 'manual' | '' (optional)
        // offset: number (optional, default 0)
        // limit: number (optional, default 5000, max 5000)
        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/ads/get_product_level_campaign_id_list',
          'GET',
          shop_id,
          token,
          undefined,
          {
            ...(params.ad_type && { ad_type: params.ad_type }),
            ...(params.offset !== undefined && { offset: params.offset }),
            ...(params.limit !== undefined && { limit: params.limit }),
          }
        );
        break;
      }

      case 'get-campaign-setting-info': {
        // Lấy thông tin chi tiết campaign
        // campaign_id_list: string (required) - comma separated, max 100
        // info_type_list: string (required) - comma separated
        //   1: Common Info, 2: Manual Bidding Info, 3: Auto Bidding Info, 4: Auto Product Ads Info
        if (!params.campaign_id_list) {
          return new Response(JSON.stringify({ error: 'campaign_id_list is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (!params.info_type_list) {
          return new Response(JSON.stringify({ error: 'info_type_list is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Convert arrays to comma-separated strings if needed
        const campaignIdList = Array.isArray(params.campaign_id_list)
          ? params.campaign_id_list.join(',')
          : params.campaign_id_list;

        const infoTypeList = Array.isArray(params.info_type_list)
          ? params.info_type_list.join(',')
          : params.info_type_list;

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/ads/get_product_level_campaign_setting_info',
          'GET',
          shop_id,
          token,
          undefined,
          {
            campaign_id_list: campaignIdList,
            info_type_list: infoTypeList,
          }
        );
        break;
      }

      case 'edit-manual-product-ads': {
        // Chỉnh sửa Manual Product Ads
        // Required: reference_id, campaign_id, edit_action
        if (!params.reference_id || !params.campaign_id || !params.edit_action) {
          return new Response(JSON.stringify({ error: 'reference_id, campaign_id, edit_action are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const manualBody: Record<string, unknown> = {
          reference_id: params.reference_id,
          campaign_id: params.campaign_id,
          edit_action: params.edit_action,
        };

        // Optional params
        if (params.budget !== undefined) manualBody.budget = params.budget;
        if (params.start_date) manualBody.start_date = params.start_date;
        if (params.end_date !== undefined) manualBody.end_date = params.end_date;
        if (params.roas_target !== undefined) manualBody.roas_target = params.roas_target;
        if (params.discovery_ads_locations) manualBody.discovery_ads_locations = params.discovery_ads_locations;
        if (params.enhanced_cpc !== undefined) manualBody.enhanced_cpc = params.enhanced_cpc;
        if (params.smart_creative_setting) manualBody.smart_creative_setting = params.smart_creative_setting;

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/ads/edit_manual_product_ads',
          'POST',
          shop_id,
          token,
          manualBody
        );
        break;
      }

      case 'edit-auto-product-ads': {
        // Chỉnh sửa Auto Product Ads
        // Required: reference_id, campaign_id, edit_action
        if (!params.reference_id || !params.campaign_id || !params.edit_action) {
          return new Response(JSON.stringify({ error: 'reference_id, campaign_id, edit_action are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const autoBody: Record<string, unknown> = {
          reference_id: params.reference_id,
          campaign_id: params.campaign_id,
          edit_action: params.edit_action,
        };

        // Optional params
        if (params.budget !== undefined) autoBody.budget = params.budget;
        if (params.start_date) autoBody.start_date = params.start_date;
        if (params.end_date !== undefined) autoBody.end_date = params.end_date;

        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/ads/edit_auto_product_ads',
          'POST',
          shop_id,
          token,
          autoBody
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
