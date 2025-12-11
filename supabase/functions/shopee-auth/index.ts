/**
 * Supabase Edge Function: Shopee Authentication
 * Xử lý OAuth flow với Shopee API
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

  if (accessToken) {
    baseString += accessToken;
  }
  if (shopId) {
    baseString += shopId;
  }

  const hmac = createHmac('sha256', SHOPEE_PARTNER_KEY);
  hmac.update(baseString);
  return hmac.digest('hex');
}

/**
 * Tạo URL xác thực OAuth
 */
function getAuthUrl(redirectUri: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/shop/auth_partner';
  const sign = createSignature(SHOPEE_PARTNER_ID, path, timestamp);

  const params = new URLSearchParams({
    partner_id: SHOPEE_PARTNER_ID.toString(),
    timestamp: timestamp.toString(),
    sign: sign,
    redirect: redirectUri,
  });

  return `${SHOPEE_BASE_URL}${path}?${params.toString()}`;
}

/**
 * Đổi code lấy access token
 */
async function getAccessToken(code: string, shopId?: number, mainAccountId?: number) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/token/get';
  const sign = createSignature(SHOPEE_PARTNER_ID, path, timestamp);

  const body: Record<string, unknown> = {
    code,
    partner_id: SHOPEE_PARTNER_ID,
  };

  if (shopId) {
    body.shop_id = shopId;
  }
  if (mainAccountId) {
    body.main_account_id = mainAccountId;
  }

  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return await response.json();
}

/**
 * Refresh access token
 */
async function refreshAccessToken(refreshToken: string, shopId?: number, merchantId?: number) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const sign = createSignature(SHOPEE_PARTNER_ID, path, timestamp);

  const body: Record<string, unknown> = {
    refresh_token: refreshToken,
    partner_id: SHOPEE_PARTNER_ID,
  };

  if (shopId) {
    body.shop_id = shopId;
  }
  if (merchantId) {
    body.merchant_id = merchantId;
  }

  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return await response.json();
}

/**
 * Lưu token vào Supabase
 */
async function saveToken(
  supabase: ReturnType<typeof createClient>,
  token: Record<string, unknown>,
  userId?: string
) {
  const { error } = await supabase.from('shopee_tokens').upsert(
    {
      shop_id: token.shop_id,
      user_id: userId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expire_in: token.expire_in,
      expired_at: Date.now() + (token.expire_in as number) * 1000,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'shop_id',
    }
  );

  if (error) {
    console.error('Failed to save token:', error);
    throw error;
  }
}

/**
 * Lấy token từ Supabase
 */
async function getToken(supabase: ReturnType<typeof createClient>, shopId: number) {
  const { data, error } = await supabase
    .from('shopee_tokens')
    .select('*')
    .eq('shop_id', shopId)
    .single();

  if (error) {
    console.error('Failed to get token:', error);
    return null;
  }

  return data;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body.action;

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get user from auth header (optional)
    const authHeader = req.headers.get('Authorization');
    let userId: string | undefined;

    if (authHeader) {
      const {
        data: { user },
      } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id;
    }

    switch (action) {
      case 'get-auth-url': {
        const redirectUri = body.redirect_uri || '';
        const authUrl = getAuthUrl(redirectUri);

        return new Response(JSON.stringify({ auth_url: authUrl }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-token': {
        const code = body.code || '';
        const shopId = body.shop_id ? Number(body.shop_id) : undefined;
        const mainAccountId = body.main_account_id ? Number(body.main_account_id) : undefined;

        const token = await getAccessToken(code, shopId, mainAccountId);

        if (token.error) {
          return new Response(JSON.stringify({ error: token.error, message: token.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Đảm bảo shop_id có giá trị (lấy từ request nếu API không trả về)
        const tokenWithShopId = {
          ...token,
          shop_id: token.shop_id || shopId,
        };

        // Save token to database
        await saveToken(supabase, tokenWithShopId, userId);

        return new Response(JSON.stringify(tokenWithShopId), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'refresh-token': {
        const { refresh_token, shop_id, merchant_id } = body;

        const token = await refreshAccessToken(refresh_token, shop_id, merchant_id);

        if (token.error) {
          return new Response(JSON.stringify({ error: token.error, message: token.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Save new token to database
        await saveToken(supabase, { ...token, shop_id }, userId);

        return new Response(JSON.stringify(token), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-stored-token': {
        const shopId = Number(body.shop_id);

        if (!shopId) {
          return new Response(JSON.stringify({ error: 'shop_id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const token = await getToken(supabase, shopId);

        return new Response(JSON.stringify(token || { error: 'Token not found' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
