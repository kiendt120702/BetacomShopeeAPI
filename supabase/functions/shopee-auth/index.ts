/**
 * Supabase Edge Function: Shopee Authentication
 * Xử lý OAuth flow với Shopee API
 * Partner credentials được lưu trực tiếp trong bảng shops
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Shopee API config (fallback nếu không có partner_info)
const DEFAULT_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const DEFAULT_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || ''; // VPS Proxy URL

// Supabase config
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Interface cho partner credentials
interface PartnerCredentials {
  partnerId: number;
  partnerKey: string;
  partnerName?: string;
  partnerCreatedBy?: string;
}

// Interface cho partner info từ request
interface PartnerInfo {
  partner_id: number;
  partner_key: string;
  partner_name?: string;
  partner_created_by?: string;
}

/**
 * Lấy partner credentials từ request hoặc shop hoặc fallback env
 */
async function getPartnerCredentials(
  supabase: ReturnType<typeof createClient>,
  partnerInfo?: PartnerInfo,
  shopId?: number
): Promise<PartnerCredentials> {
  // Nếu có partner_info từ request, dùng trực tiếp
  if (partnerInfo?.partner_id && partnerInfo?.partner_key) {
    console.log('[PARTNER] Using partner from request:', partnerInfo.partner_id);
    return {
      partnerId: partnerInfo.partner_id,
      partnerKey: partnerInfo.partner_key,
      partnerName: partnerInfo.partner_name,
      partnerCreatedBy: partnerInfo.partner_created_by,
    };
  }

  // Nếu có shop_id, lấy partner từ shop
  if (shopId) {
    const { data, error } = await supabase
      .from('shops')
      .select('partner_id, partner_key, partner_name')
      .eq('shop_id', shopId)
      .single();

    if (data?.partner_id && data?.partner_key && !error) {
      console.log('[PARTNER] Using partner from shop:', data.partner_id);
      return {
        partnerId: data.partner_id,
        partnerKey: data.partner_key,
        partnerName: data.partner_name,
      };
    }
  }

  // Fallback: dùng env
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
  partnerId: number,
  partnerKey: string,
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

  const hmac = createHmac('sha256', partnerKey);
  hmac.update(baseString);
  return hmac.digest('hex');
}

/**
 * Tạo URL xác thực OAuth
 */
function getAuthUrl(credentials: PartnerCredentials, redirectUri: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/shop/auth_partner';
  const sign = createSignature(credentials.partnerId, credentials.partnerKey, path, timestamp);

  const params = new URLSearchParams({
    partner_id: credentials.partnerId.toString(),
    timestamp: timestamp.toString(),
    sign: sign,
    redirect: redirectUri,
  });

  return `${SHOPEE_BASE_URL}${path}?${params.toString()}`;
}

/**
 * Đổi code lấy access token
 */
async function getAccessToken(
  credentials: PartnerCredentials,
  code: string,
  shopId?: number,
  mainAccountId?: number
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/token/get';
  const sign = createSignature(credentials.partnerId, credentials.partnerKey, path, timestamp);

  const body: Record<string, unknown> = {
    code,
    partner_id: credentials.partnerId,
  };

  if (shopId) {
    body.shop_id = shopId;
  }
  if (mainAccountId) {
    body.main_account_id = mainAccountId;
  }

  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${credentials.partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetchWithProxy(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return await response.json();
}

/**
 * Refresh access token
 */
async function refreshAccessToken(
  credentials: PartnerCredentials,
  refreshToken: string,
  shopId?: number,
  merchantId?: number
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const sign = createSignature(credentials.partnerId, credentials.partnerKey, path, timestamp);

  const body: Record<string, unknown> = {
    refresh_token: refreshToken,
    partner_id: credentials.partnerId,
  };

  if (shopId) {
    body.shop_id = shopId;
  }
  if (merchantId) {
    body.merchant_id = merchantId;
  }

  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${credentials.partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetchWithProxy(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return await response.json();
}

/**
 * Lưu token vào Supabase (bảng shops)
 */
async function saveToken(
  supabase: ReturnType<typeof createClient>,
  token: Record<string, unknown>,
  userId?: string,
  partnerInfo?: PartnerCredentials
) {
  const now = Date.now();
  const shopData: Record<string, unknown> = {
    shop_id: token.shop_id,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expire_in: token.expire_in,
    expired_at: now + (token.expire_in as number) * 1000,
    token_updated_at: new Date().toISOString(),
  };

  // Lưu auth_time (thời điểm ủy quyền) và expire_time (thời hạn ủy quyền) từ Shopee
  // Shopee trả về expire_time là timestamp (giây) khi authorization hết hạn
  if (token.expire_time) {
    shopData.expire_time = token.expire_time;
    // auth_time = expire_time - authorization_period (thường là 365 ngày = 31536000 giây)
    // Nếu không có auth_time, tính từ expire_time
    shopData.auth_time = token.auth_time || Math.floor(now / 1000);
  }

  // Thêm partner info nếu có
  if (partnerInfo) {
    shopData.partner_id = partnerInfo.partnerId;
    shopData.partner_key = partnerInfo.partnerKey;
    if (partnerInfo.partnerName) {
      shopData.partner_name = partnerInfo.partnerName;
    }
    if (partnerInfo.partnerCreatedBy) {
      shopData.partner_created_by = partnerInfo.partnerCreatedBy;
    }
  }

  const { error } = await supabase.from('shops').upsert(shopData, {
    onConflict: 'shop_id',
  });

  if (error) {
    console.error('Failed to save token:', error);
    throw error;
  }
}

/**
 * Lấy token từ Supabase (bảng shops)
 */
async function getToken(supabase: ReturnType<typeof createClient>, shopId: number) {
  const { data, error } = await supabase
    .from('shops')
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
        const partnerInfo = body.partner_info as PartnerInfo | undefined;
        
        // Lấy partner credentials
        const credentials = await getPartnerCredentials(supabase, partnerInfo);
        const authUrl = getAuthUrl(credentials, redirectUri);

        return new Response(JSON.stringify({ 
          auth_url: authUrl,
          partner_id: credentials.partnerId,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-token': {
        const code = body.code || '';
        const shopId = body.shop_id ? Number(body.shop_id) : undefined;
        const mainAccountId = body.main_account_id ? Number(body.main_account_id) : undefined;
        const partnerInfo = body.partner_info as PartnerInfo | undefined;

        // Lấy partner credentials
        const credentials = await getPartnerCredentials(supabase, partnerInfo, shopId);
        const token = await getAccessToken(credentials, code, shopId, mainAccountId);

        if (token.error) {
          return new Response(JSON.stringify({ error: token.error, message: token.message, success: false }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Đảm bảo shop_id có giá trị (lấy từ request nếu API không trả về)
        const tokenWithShopId = {
          ...token,
          shop_id: token.shop_id || shopId,
        };

        // Save token to database với partner info
        await saveToken(supabase, tokenWithShopId, userId, credentials);

        return new Response(JSON.stringify(tokenWithShopId), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'refresh-token': {
        const { refresh_token, shop_id, merchant_id } = body;
        const partnerInfo = body.partner_info as PartnerInfo | undefined;

        // Lấy partner credentials
        const credentials = await getPartnerCredentials(supabase, partnerInfo, shop_id);
        const token = await refreshAccessToken(credentials, refresh_token, shop_id, merchant_id);

        if (token.error) {
          return new Response(JSON.stringify({ error: token.error, message: token.message, success: false }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Save new token to database
        await saveToken(supabase, { ...token, shop_id }, userId, credentials);

        return new Response(JSON.stringify(token), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      case 'get-stored-token': {
        const shopId = Number(body.shop_id);

        if (!shopId) {
          // Return 200 with error in body so frontend can read the message
          return new Response(JSON.stringify({ error: 'shop_id is required', success: false }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const token = await getToken(supabase, shopId);

        return new Response(JSON.stringify(token || { error: 'Token not found' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        // Return 200 with error in body so frontend can read the message
        return new Response(JSON.stringify({ error: 'Invalid action', success: false }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Error:', error);
    // Return 200 with error in body so frontend can read the message
    return new Response(JSON.stringify({ error: (error as Error).message, success: false }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
