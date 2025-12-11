/**
 * Supabase Edge Function: Shopee Product
 * Quản lý Product API với Auto-Refresh Token
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

const TOKEN_BUFFER_MS = 5 * 60 * 1000;

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

        result = await callShopeeAPI(
          supabase,
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
        result = await callShopeeAPI(
          supabase,
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

        result = await callShopeeAPI(
          supabase,
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
