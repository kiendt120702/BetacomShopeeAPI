/**
 * API Proxy - Gọi Shopee API và trả về response
 * Dùng cho tab API Response để test API
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SHOPEE_HOST = 'https://partner.shopeemobile.com';

// HMAC-SHA256 using Web Crypto API
async function hmacSha256(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      api_path,      // e.g. "/api/v2/product/get_item_base_info"
      method = 'GET',
      params = {},   // Query params
      body = null,   // Request body for POST
      shop_id,
    } = await req.json();

    if (!api_path) {
      return new Response(
        JSON.stringify({ error: 'api_path is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!shop_id) {
      return new Response(
        JSON.stringify({ error: 'shop_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get shop credentials - chỉ cần shop_id
    const { data: shop, error: shopError } = await supabase
      .from('apishopee_shops')
      .select('access_token, partner_id, partner_key')
      .eq('shop_id', shop_id)
      .single();

    if (shopError || !shop) {
      return new Response(
        JSON.stringify({ error: 'Shop not found', details: shopError?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { access_token, partner_id, partner_key } = shop;

    if (!access_token) {
      return new Response(
        JSON.stringify({ error: 'Shop access_token not found. Please re-authorize.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!partner_id || !partner_key) {
      return new Response(
        JSON.stringify({ error: 'Partner credentials not found for this shop.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build timestamp
    const timestamp = Math.floor(Date.now() / 1000);

    // Build base string for signature
    const baseString = `${partner_id}${api_path}${timestamp}${access_token}${shop_id}`;
    const sign = await hmacSha256(partner_key, baseString);

    // Build query params
    const queryParams = new URLSearchParams();
    queryParams.set('partner_id', partner_id.toString());
    queryParams.set('timestamp', timestamp.toString());
    queryParams.set('access_token', access_token);
    queryParams.set('shop_id', shop_id.toString());
    queryParams.set('sign', sign);

    // Add custom params
    if (params && typeof params === 'object') {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          queryParams.set(key, String(value));
        }
      }
    }

    const url = `${SHOPEE_HOST}${api_path}?${queryParams.toString()}`;

    console.log(`[API Proxy] ${method} ${api_path}`);
    console.log(`[API Proxy] Request body:`, body ? JSON.stringify(body) : 'null');

    // Make request to Shopee
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      fetchOptions.body = JSON.stringify(body);
    }

    const startTime = Date.now();
    const response = await fetch(url, fetchOptions);
    const endTime = Date.now();

    const responseData = await response.json();

    return new Response(
      JSON.stringify({
        request: {
          method,
          url: `${SHOPEE_HOST}${api_path}`,
          params: { ...params, shop_id, partner_id },
          body,
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          time_ms: endTime - startTime,
          data: responseData,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (err) {
    console.error('[API Proxy] Error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
