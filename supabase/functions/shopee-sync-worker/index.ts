/**
 * Supabase Edge Function: Shopee Sync Worker
 * Background worker để đồng bộ dữ liệu từ Shopee về Supabase
 * Hỗ trợ multi-partner: lấy credentials từ database
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// Shopee API config (fallback)
const DEFAULT_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const DEFAULT_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || ''; // VPS Proxy URL
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

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
  // Tìm partner từ shop
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

  // Fallback: dùng env
  console.log('[PARTNER] Using default partner from env:', DEFAULT_PARTNER_ID);
  return {
    partnerId: DEFAULT_PARTNER_ID,
    partnerKey: DEFAULT_PARTNER_KEY,
  };
}

async function createSignature(
  partnerKey: string,
  partnerId: number,
  path: string,
  timestamp: number,
  accessToken = '',
  shopId = 0
): Promise<string> {
  let baseString = `${partnerId}${path}${timestamp}`;
  if (accessToken) baseString += accessToken;
  if (shopId) baseString += shopId;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(partnerKey);
  const messageData = encoder.encode(baseString);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getTokenWithAutoRefresh(supabase: any, shopId: number, userId?: string) {
  console.log(`[SYNC] Looking for token - shop_id: ${shopId}, user_id: ${userId}`);
  
  // 1. Tìm token từ bảng shops (nơi frontend lưu token)
  const { data: shopData, error: shopError } = await supabase
    .from('shops')
    .select('shop_id, access_token, refresh_token, expired_at, merchant_id')
    .eq('shop_id', shopId)
    .single();

  console.log(`[SYNC] shops table query result:`, { 
    found: !!shopData, 
    error: shopError?.message,
    hasAccessToken: !!shopData?.access_token 
  });

  if (!shopError && shopData?.access_token) {
    return {
      access_token: shopData.access_token,
      refresh_token: shopData.refresh_token,
      shop_id: shopData.shop_id,
    };
  }

  // 2. Fallback: Tìm trong bảng user_shops (cũ)
  let query = supabase.from('user_shops').select('*').eq('shop_id', shopId);
  if (userId) {
    query = query.eq('user_id', userId);
  }
  
  const { data: userShopData, error: userShopError } = await query.single();

  console.log(`[SYNC] user_shops query result:`, { 
    found: !!userShopData, 
    error: userShopError?.message,
    hasAccessToken: !!userShopData?.access_token 
  });

  if (!userShopError && userShopData?.access_token) {
    return {
      access_token: userShopData.access_token,
      refresh_token: userShopData.refresh_token,
      shop_id: userShopData.shop_id,
    };
  }

  // 3. Fallback: Test tokens từ environment
  const testAccessToken = Deno.env.get('TEST_SHOPEE_ACCESS_TOKEN');
  const testRefreshToken = Deno.env.get('TEST_SHOPEE_REFRESH_TOKEN');
  
  if (testAccessToken && testRefreshToken) {
    console.log(`[SYNC] Using test tokens for shop ${shopId}`);
    return {
      access_token: testAccessToken,
      refresh_token: testRefreshToken,
      shop_id: shopId,
    };
  }
  
  throw new Error(`Token not found for shop ${shopId}. Please authenticate first. Check: 1) User logged into Supabase 2) Shopee token saved to database (shops table) 3) RLS policies allow access`);
}

/**
 * Helper function để gọi API qua proxy hoặc trực tiếp
 */
async function fetchWithProxy(targetUrl: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    // Gọi qua VPS proxy
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
    console.log('[PROXY] Calling via proxy:', PROXY_URL);
    return await fetch(proxyUrl, options);
  }
  // Gọi trực tiếp
  return await fetch(targetUrl, options);
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(
  credentials: PartnerCredentials,
  refreshToken: string,
  shopId: number
): Promise<{ access_token: string; refresh_token: string; expire_in: number } | null> {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/api/v2/auth/access_token/get';
  const sign = await createSignature(credentials.partnerKey, credentials.partnerId, path, timestamp);
  
  const url = `${SHOPEE_BASE_URL}${path}?partner_id=${credentials.partnerId}&timestamp=${timestamp}&sign=${sign}`;
  
  console.log('[SYNC] Refreshing access token for shop:', shopId);
  
  const response = await fetchWithProxy(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      partner_id: credentials.partnerId,
      shop_id: shopId,
    }),
  });
  
  const result = await response.json();
  
  if (result.error) {
    console.error('[SYNC] Token refresh failed:', result);
    return null;
  }
  
  console.log('[SYNC] Token refreshed successfully');
  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expire_in: result.expire_in,
  };
}

/**
 * Save refreshed token to database
 */
async function saveRefreshedToken(
  supabase: any,
  shopId: number,
  newToken: { access_token: string; refresh_token: string; expire_in: number }
) {
  const expiredAt = Date.now() + newToken.expire_in * 1000;
  
  const { error } = await supabase
    .from('shops')
    .update({
      access_token: newToken.access_token,
      refresh_token: newToken.refresh_token,
      expired_at: expiredAt,
      expire_in: newToken.expire_in,
      token_updated_at: new Date().toISOString(),
    })
    .eq('shop_id', shopId);
  
  if (error) {
    console.error('[SYNC] Failed to save refreshed token:', error);
  } else {
    console.log('[SYNC] Refreshed token saved to database');
  }
}

async function callShopeeAPI(
  supabase: any,
  credentials: PartnerCredentials,
  path: string,
  shopId: number,
  token: any
): Promise<any> {
  return callShopeeAPIWithParams(supabase, credentials, path, shopId, token, {});
}

async function callShopeeAPIWithParams(
  supabase: any,
  credentials: PartnerCredentials,
  path: string,
  shopId: number,
  token: any,
  extraParams: Record<string, string> = {}
): Promise<any> {
  const makeRequest = async (accessToken: string) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = await createSignature(credentials.partnerKey, credentials.partnerId, path, timestamp, accessToken, shopId);

    const params = new URLSearchParams({
      partner_id: credentials.partnerId.toString(),
      timestamp: timestamp.toString(),
      access_token: accessToken,
      shop_id: shopId.toString(),
      sign: sign,
      ...extraParams,
    });

    const url = `${SHOPEE_BASE_URL}${path}?${params.toString()}`;
    console.log('Calling Shopee API:', path);

    const response = await fetchWithProxy(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    return await response.json();
  };

  // First attempt
  let result = await makeRequest(token.access_token);
  
  // Check if token expired and retry with refresh
  if (result.error === 'error_auth' || result.error === 'invalid_acceess_token' || 
      (result.message && result.message.includes('Invalid access_token'))) {
    console.log('[SYNC] Token expired, attempting refresh...');
    
    const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);
    
    if (newToken) {
      // Save new token
      await saveRefreshedToken(supabase, shopId, newToken);
      
      // Update token object for subsequent calls
      token.access_token = newToken.access_token;
      token.refresh_token = newToken.refresh_token;
      
      // Retry with new token
      result = await makeRequest(newToken.access_token);
    }
  }
  
  return result;
}

// Helper function to update sync progress (realtime)
async function updateSyncProgress(supabase: any, shopId: number, userId: string, progress: {
  current_step: string;
  total_items: number;
  processed_items: number;
  is_syncing: boolean;
}) {
  await supabase
    .from('sync_status')
    .upsert({
      shop_id: shopId,
      user_id: userId,
      sync_progress: progress,
      is_syncing: progress.is_syncing,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'shop_id,user_id',
    });
}

async function syncFlashSaleData(supabase: any, shopId: number, userId: string) {
  console.log(`[SYNC] Starting flash sale sync for shop ${shopId}, user ${userId}`);
  
  try {
    // Update progress: Bắt đầu
    await updateSyncProgress(supabase, shopId, userId, {
      current_step: 'Đang lấy token...',
      total_items: 0,
      processed_items: 0,
      is_syncing: true,
    });

    // Lấy partner credentials từ database
    const credentials = await getPartnerCredentials(supabase, shopId);

    // Get token with userId for better lookup
    const token = await getTokenWithAutoRefresh(supabase, shopId, userId);

    // Update progress: Đang gọi API
    await updateSyncProgress(supabase, shopId, userId, {
      current_step: 'Đang lấy danh sách Flash Sale từ Shopee...',
      total_items: 0,
      processed_items: 0,
      is_syncing: true,
    });

    // Call Shopee API with auto-refresh token
    const path = '/api/v2/shop_flash_sale/get_shop_flash_sale_list';
    const apiResponse = await callShopeeAPIWithParams(
      supabase,
      credentials,
      path,
      shopId,
      token,
      { type: '0', offset: '0', limit: '100' }
    );
    
    console.log('[SYNC] Shopee API response:', JSON.stringify(apiResponse).substring(0, 500));

    // Shopee trả về error = "" hoặc "-" khi thành công
    if (apiResponse.error && apiResponse.error !== '' && apiResponse.error !== '-') {
      const errorMsg = apiResponse.message || apiResponse.msg || apiResponse.error || 'Unknown error';
      console.error('[SYNC] Shopee API error details:', JSON.stringify(apiResponse));
      throw new Error(`Shopee API error: ${errorMsg}`);
    }

    const flashSaleList = apiResponse.response?.flash_sale_list || [];
    console.log(`[SYNC] Found ${flashSaleList.length} flash sales`);

    // Update progress: Tìm thấy flash sales
    await updateSyncProgress(supabase, shopId, userId, {
      current_step: `Tìm thấy ${flashSaleList.length} chương trình, đang xóa dữ liệu cũ...`,
      total_items: flashSaleList.length,
      processed_items: 0,
      is_syncing: true,
    });

    // Clear old data for this shop (không filter user_id để tất cả user có quyền truy cập shop đều thấy dữ liệu mới)
    await supabase
      .from('flash_sale_data')
      .delete()
      .eq('shop_id', shopId);

    // Batch insert tất cả flash sales cùng lúc (nhanh hơn nhiều)
    if (flashSaleList.length > 0) {
      const now = new Date().toISOString();
      const dataToInsert = flashSaleList.map((flashSale: any) => ({
        shop_id: shopId,
        user_id: userId,
        flash_sale_id: flashSale.flash_sale_id,
        timeslot_id: flashSale.timeslot_id,
        status: flashSale.status,
        start_time: flashSale.start_time,
        end_time: flashSale.end_time,
        enabled_item_count: flashSale.enabled_item_count,
        item_count: flashSale.item_count,
        type: flashSale.type,
        remindme_count: flashSale.remindme_count,
        click_count: flashSale.click_count,
        raw_response: flashSale,
        synced_at: now,
      }));

      // Update progress: Đang lưu
      await updateSyncProgress(supabase, shopId, userId, {
        current_step: `Đang lưu ${flashSaleList.length} chương trình vào database...`,
        total_items: flashSaleList.length,
        processed_items: Math.floor(flashSaleList.length / 2),
        is_syncing: true,
      });

      const { error: insertError } = await supabase
        .from('flash_sale_data')
        .insert(dataToInsert);

      if (insertError) {
        console.error('[SYNC] Failed to batch insert flash sales:', insertError);
      }
    }

    // Update progress: Hoàn thành
    await updateSyncProgress(supabase, shopId, userId, {
      current_step: `Hoàn thành! Đã đồng bộ ${flashSaleList.length} chương trình`,
      total_items: flashSaleList.length,
      processed_items: flashSaleList.length,
      is_syncing: false,
    });

    // Update sync_status
    await updateSyncStatus(supabase, shopId, userId, 'flash_sales_synced_at');

    console.log(`[SYNC] Completed flash sale sync for shop ${shopId}, saved ${flashSaleList.length} items`);
    return { success: true, flash_sale_count: flashSaleList.length };

  } catch (error) {
    console.error(`[SYNC] Failed flash sale sync for shop ${shopId}:`, error);
    throw error;
  }
}

async function syncAdsCampaignData(supabase: any, shopId: number, userId: string) {
  console.log(`[SYNC] Starting ads campaign sync for shop ${shopId}, user ${userId}`);
  
  try {
    // Lấy partner credentials từ database
    const credentials = await getPartnerCredentials(supabase, shopId);

    // Get token with userId for better lookup
    const token = await getTokenWithAutoRefresh(supabase, shopId, userId);
    
    // Call Shopee API for campaign list with auto-refresh
    const path = '/api/v2/ads/get_campaign_id_list';
    const apiResponse = await callShopeeAPIWithParams(
      supabase,
      credentials,
      path,
      shopId,
      token,
      { ad_type: 'all' }
    );

    console.log('Calling Ads Campaign API:', path);

    if (apiResponse.error && apiResponse.error !== '-') {
      throw new Error(`Shopee API error: ${apiResponse.message}`);
    }

    const campaignList = apiResponse.response?.campaign_list || [];

    // Clear old data for this shop (không filter user_id để tất cả user có quyền truy cập shop đều thấy dữ liệu mới)
    await supabase
      .from('ads_campaign_data')
      .delete()
      .eq('shop_id', shopId);

    // Get detailed info for campaigns in batches
    const batchSize = 100;
    let totalSaved = 0;

    for (let i = 0; i < campaignList.length; i += batchSize) {
      const batch = campaignList.slice(i, i + batchSize);
      const campaignIds = batch.map((c: any) => c.campaign_id);

      try {
        // Get campaign details with auto-refresh
        const detailPath = '/api/v2/ads/get_campaign_setting_info';
        console.log('Calling Campaign Detail API:', detailPath);

        const detailApiResponse = await callShopeeAPIWithParams(
          supabase,
          credentials,
          detailPath,
          shopId,
          token,
          {
            campaign_id_list: campaignIds.join(','),
            info_type_list: '1,3', // common_info and auto_bidding_info
          }
        );

        const detailResponse = { response: detailApiResponse };

        if (detailResponse.response?.campaign_list) {
          // Batch insert tất cả campaigns trong batch này
          const now = new Date().toISOString();
          const campaignsToInsert = detailResponse.response.campaign_list.map((campaign: any) => ({
            shop_id: shopId,
            user_id: userId,
            campaign_id: campaign.campaign_id,
            ad_type: campaign.common_info?.ad_type || 'auto',
            name: campaign.common_info?.ad_name || '',
            status: campaign.common_info?.campaign_status || 'unknown',
            campaign_placement: campaign.common_info?.campaign_placement || '',
            bidding_method: campaign.common_info?.bidding_method || '',
            campaign_budget: campaign.common_info?.campaign_budget || 0,
            start_time: campaign.common_info?.campaign_duration?.start_time || 0,
            end_time: campaign.common_info?.campaign_duration?.end_time || 0,
            item_count: campaign.common_info?.item_id_list?.length || 0,
            roas_target: campaign.auto_bidding_info?.roas_target || null,
            raw_response: campaign,
            synced_at: now,
          }));

          const { error: insertError } = await supabase
            .from('ads_campaign_data')
            .insert(campaignsToInsert);

          if (insertError) {
            console.error('[SYNC] Failed to batch insert campaigns:', insertError);
          } else {
            totalSaved += campaignsToInsert.length;
          }
        }
      } catch (batchError) {
        console.error('Error processing campaign batch:', batchError);
      }
    }

    // Update sync_status
    await updateSyncStatus(supabase, shopId, userId, 'campaigns_synced_at');

    console.log(`[SYNC] Completed ads campaign sync for shop ${shopId}, saved ${totalSaved} campaigns`);
    return { success: true, campaign_count: totalSaved };

  } catch (error) {
    console.error(`[SYNC] Failed ads campaign sync for shop ${shopId}:`, error);
    throw error;
  }
}

// Helper function to update sync_status table
async function updateSyncStatus(supabase: any, shopId: number, userId: string, field: string) {
  const now = new Date().toISOString();
  
  // Upsert sync_status
  const { error } = await supabase
    .from('sync_status')
    .upsert({
      shop_id: shopId,
      user_id: userId,
      [field]: now,
      is_syncing: false,
      last_sync_error: null,
      updated_at: now,
    }, {
      onConflict: 'shop_id,user_id',
    });

  if (error) {
    console.error(`Failed to update sync_status for ${field}:`, error);
  }
}

async function updateSyncJob(supabase: any, jobId: string, updates: any) {
  const { error } = await supabase
    .from('sync_jobs')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);

  if (error) {
    console.error('Failed to update sync job:', error);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id, user_id, job_id } = body;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    switch (action) {
      case 'sync-flash-sale-data': {
        if (!shop_id || !user_id) {
          return new Response(JSON.stringify({ error: 'shop_id and user_id are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Update job status to running
        if (job_id) {
          await updateSyncJob(supabase, job_id, {
            status: 'running',
            started_at: new Date().toISOString()
          });
        }

        try {
          const result = await syncFlashSaleData(supabase, shop_id, user_id);
          
          // Update job status to completed
          if (job_id) {
            await updateSyncJob(supabase, job_id, {
              status: 'completed',
              completed_at: new Date().toISOString(),
              processed_items: result.flash_sale_count,
              total_items: result.flash_sale_count
            });
          }

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });

        } catch (syncError) {
          // Update job status to failed
          if (job_id) {
            await updateSyncJob(supabase, job_id, {
              status: 'failed',
              error_message: (syncError as Error).message,
              completed_at: new Date().toISOString()
            });
          }
          throw syncError;
        }
      }

      case 'sync-ads-campaign-data': {
        if (!shop_id || !user_id) {
          return new Response(JSON.stringify({ error: 'shop_id and user_id are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Update job status to running
        if (job_id) {
          await updateSyncJob(supabase, job_id, {
            status: 'running',
            started_at: new Date().toISOString()
          });
        }

        try {
          const result = await syncAdsCampaignData(supabase, shop_id, user_id);
          
          // Update job status to completed
          if (job_id) {
            await updateSyncJob(supabase, job_id, {
              status: 'completed',
              completed_at: new Date().toISOString(),
              processed_items: result.campaign_count,
              total_items: result.campaign_count
            });
          }

          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });

        } catch (syncError) {
          // Update job status to failed
          if (job_id) {
            await updateSyncJob(supabase, job_id, {
              status: 'failed',
              error_message: (syncError as Error).message,
              completed_at: new Date().toISOString()
            });
          }
          throw syncError;
        }
      }

      case 'schedule-sync': {
        if (!shop_id || !user_id) {
          return new Response(JSON.stringify({ error: 'shop_id and user_id are required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { job_type = 'shop_performance' } = body;

        // Create sync job
        const { data: job, error: jobError } = await supabase
          .from('sync_jobs')
          .insert({
            shop_id,
            user_id,
            job_type,
            status: 'pending',
            next_run_at: new Date().toISOString()
          })
          .select()
          .single();

        if (jobError) {
          throw jobError;
        }

        return new Response(JSON.stringify({ job_id: job.id, status: 'scheduled' }), {
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
    console.error('Sync worker error:', error);
    // Trả về 200 với error trong body để frontend có thể đọc được message
    // Thay vì 500 sẽ gây ra "non-2xx status code" không rõ ràng
    return new Response(JSON.stringify({ 
      error: (error as Error).message,
      success: false,
      details: 'Check Supabase Edge Function logs for more details'
    }), {
      status: 200, // Return 200 so frontend can read the error message
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});