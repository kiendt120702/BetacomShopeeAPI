/**
 * Supabase Edge Function: Shopee Reviews Sync
 * Đồng bộ đánh giá sản phẩm từ Shopee API
 * 
 * Logic nghiệp vụ:
 * A. Initial Load (lần đầu): Lấy toàn bộ đánh giá (while more == true)
 * B. Periodic Sync (30 phút/lần): Lấy từ đầu, dừng khi gặp đánh giá cũ hơn last_sync - 30 ngày
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Config
const DEFAULT_PARTNER_ID = Number(Deno.env.get('SHOPEE_PARTNER_ID'));
const DEFAULT_PARTNER_KEY = Deno.env.get('SHOPEE_PARTNER_KEY') || '';
const SHOPEE_BASE_URL = Deno.env.get('SHOPEE_BASE_URL') || 'https://partner.shopeemobile.com';
const PROXY_URL = Deno.env.get('SHOPEE_PROXY_URL') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Constants
const PAGE_SIZE = 50;
const SAFETY_BUFFER_DAYS = 30; // Khoảng đệm an toàn 30 ngày để bắt các đánh giá được sửa

// ==================== INTERFACES ====================

interface PartnerCredentials {
  partnerId: number;
  partnerKey: string;
}

interface ShopeeComment {
  comment_id: number;
  order_sn: string;
  item_id: number;
  model_id: number;
  buyer_username: string;
  rating_star: number;
  comment: string;
  create_time: number;
  // Reply theo doc Shopee API - field chính xác là comment_reply
  comment_reply?: {
    reply: string;
    hidden: boolean;
    create_time?: number;
  };
  // Các format cũ để backward compatible
  reply?: {
    reply: string;
    create_time: number;
  };
  seller_reply?: string;
  seller_reply_time?: number;
  images?: string[];
  videos?: { url: string }[];
  media?: {
    images?: string[];
    videos?: { url: string }[];
  };
  editable?: boolean | string;
  model_id_list?: number[];
}

interface SyncStatus {
  shop_id: number;
  is_syncing: boolean;
  is_initial_sync_done: boolean;
  last_sync_at: string | null;
  last_sync_create_time: number | null;
  total_synced: number;
  last_batch_count?: number;
}

// ==================== HELPER FUNCTIONS ====================

async function getPartnerCredentials(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<PartnerCredentials> {
  const { data } = await supabase
    .from('apishopee_shops')
    .select('partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  if (data?.partner_id && data?.partner_key) {
    return { partnerId: data.partner_id, partnerKey: data.partner_key };
  }
  return { partnerId: DEFAULT_PARTNER_ID, partnerKey: DEFAULT_PARTNER_KEY };
}

async function fetchWithProxy(targetUrl: string, options: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
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
  await supabase.from('apishopee_shops').upsert(
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
}

async function getTokenWithAutoRefresh(
  supabase: ReturnType<typeof createClient>,
  shopId: number
) {
  const { data, error } = await supabase
    .from('apishopee_shops')
    .select('shop_id, access_token, refresh_token, expired_at')
    .eq('shop_id', shopId)
    .single();

  if (!error && data?.access_token) {
    return data;
  }
  throw new Error('Token not found. Please authenticate first.');
}


async function callShopeeAPI(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  path: string,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  extraParams?: Record<string, string | number>
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
    console.log('[REVIEWS-SYNC] Calling:', path);

    const response = await fetchWithProxy(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    return await response.json();
  };

  let result = await makeRequest(token.access_token);

  // Auto-retry khi token hết hạn
  if (result.error === 'error_auth' || result.message?.includes('Invalid access_token')) {
    console.log('[REVIEWS-SYNC] Token expired, refreshing...');
    const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);

    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      result = await makeRequest(newToken.access_token);
    }
  }

  return result;
}

// ==================== SYNC STATUS FUNCTIONS ====================

async function getSyncStatus(
  supabase: ReturnType<typeof createClient>,
  shopId: number
): Promise<SyncStatus | null> {
  const { data } = await supabase
    .from('apishopee_reviews_sync_status')
    .select('*')
    .eq('shop_id', shopId)
    .single();

  return data;
}

async function updateSyncStatus(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  updates: Partial<SyncStatus> & { last_error?: string | null }
) {
  await supabase
    .from('apishopee_reviews_sync_status')
    .upsert(
      {
        shop_id: shopId,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id' }
    );
}

// ==================== REVIEWS SYNC FUNCTIONS ====================

const COMMENT_API_PATH = '/api/v2/product/get_comment';

interface CommentApiResponse {
  error?: string;
  message?: string;
  response?: {
    item_comment_list?: ShopeeComment[];
    next_cursor?: string;
    more?: boolean;
  };
}

/**
 * Fetch một trang đánh giá từ Shopee API
 */
async function fetchCommentPageByType(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  commentType: number,
  cursor: string = ''
): Promise<{ comments: ShopeeComment[]; nextCursor: string; more: boolean }> {
  const params: Record<string, string | number> = { 
    page_size: PAGE_SIZE,
    comment_type: commentType
  };
  if (cursor) params.cursor = cursor;

  const result = await callShopeeAPI(supabase, credentials, COMMENT_API_PATH, shopId, token, params) as CommentApiResponse;

  if (result.error) {
    console.error('[REVIEWS-SYNC] API Error:', result.message || result.error);
    throw new Error(result.message || result.error);
  }

  const comments = result.response?.item_comment_list || [];
  
  // Log để debug
  if (comments.length > 0) {
    console.log(`[REVIEWS-SYNC] comment_type=${commentType}, sample:`, JSON.stringify(comments[0], null, 2));
  }

  return {
    comments,
    nextCursor: result.response?.next_cursor || '',
    more: result.response?.more || false,
  };
}

/**
 * Fetch một trang đánh giá - lấy tất cả comments
 */
async function fetchCommentPage(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  cursor: string = ''
): Promise<{ comments: ShopeeComment[]; nextCursor: string; more: boolean }> {
  // comment_type: 0 = All comments
  return fetchCommentPageByType(supabase, credentials, shopId, token, 0, cursor);
}

/**
 * Fetch tất cả comments đã có reply để cập nhật reply_text
 */
async function fetchAllRepliedComments(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string }
): Promise<Map<number, ShopeeComment>> {
  console.log('[REVIEWS-SYNC] Fetching replied comments...');
  
  const repliedMap = new Map<number, ShopeeComment>();
  let cursor = '';
  let more = true;
  
  while (more) {
    // comment_type: 2 = With reply
    const { comments, nextCursor, more: hasMore } = await fetchCommentPageByType(
      supabase, credentials, shopId, token, 2, cursor
    );
    
    console.log(`[REVIEWS-SYNC] Fetched ${comments.length} replied comments`);
    
    for (const comment of comments) {
      repliedMap.set(comment.comment_id, comment);
    }
    
    cursor = nextCursor;
    more = hasMore;
    
    if (more) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  console.log(`[REVIEWS-SYNC] Total replied comments: ${repliedMap.size}`);
  return repliedMap;
}

/**
 * Upsert reviews vào database
 */
/**
 * Extract reply từ comment - hỗ trợ nhiều format từ Shopee API
 * Theo doc Shopee: field chính xác là comment_reply với cấu trúc:
 * { reply: string, hidden: boolean, create_time?: number }
 */
function extractReply(c: ShopeeComment): { text: string | null; time: number | null; hidden: boolean } {
  // Format chính theo doc Shopee: comment_reply
  if (c.comment_reply?.reply) {
    return { 
      text: c.comment_reply.reply, 
      time: c.comment_reply.create_time || null,
      hidden: c.comment_reply.hidden || false
    };
  }
  // Format cũ: reply object
  if (c.reply?.reply) {
    return { text: c.reply.reply, time: c.reply.create_time || null, hidden: false };
  }
  // Format cũ: seller_reply field
  if (c.seller_reply) {
    return { text: c.seller_reply, time: c.seller_reply_time || null, hidden: false };
  }
  return { text: null, time: null, hidden: false };
}

/**
 * Extract media từ comment - hỗ trợ nhiều format
 */
function extractMedia(c: ShopeeComment): { images: string[]; videos: { url: string }[] } {
  // Format 1: direct arrays
  if (c.images || c.videos) {
    return { images: c.images || [], videos: c.videos || [] };
  }
  // Format 2: nested in media object
  if (c.media) {
    return { images: c.media.images || [], videos: c.media.videos || [] };
  }
  return { images: [], videos: [] };
}

async function upsertReviews(
  supabase: ReturnType<typeof createClient>,
  shopId: number,
  comments: ShopeeComment[],
  syncedBy?: string
): Promise<number> {
  if (comments.length === 0) return 0;

  // Lấy existing reviews để không ghi đè reply_text nếu đã có
  const commentIds = comments.map(c => c.comment_id);
  const { data: existingReviews } = await supabase
    .from('apishopee_reviews')
    .select('comment_id, reply_text, reply_time, reply_hidden')
    .eq('shop_id', shopId)
    .in('comment_id', commentIds);

  const existingMap = new Map(
    existingReviews?.map(r => [r.comment_id, r]) || []
  );

  const records = comments.map(c => {
    const reply = extractReply(c);
    const media = extractMedia(c);
    const existing = existingMap.get(c.comment_id);
    
    // Giữ lại reply cũ nếu không có reply mới
    const finalReplyText = reply.text || existing?.reply_text || null;
    const finalReplyTime = reply.time || existing?.reply_time || null;
    const finalReplyHidden = reply.text ? reply.hidden : (existing?.reply_hidden || false);
    
    return {
      shop_id: shopId,
      comment_id: c.comment_id,
      order_sn: c.order_sn,
      item_id: c.item_id,
      model_id: c.model_id,
      buyer_username: c.buyer_username,
      rating_star: c.rating_star,
      comment: c.comment,
      create_time: c.create_time,
      reply_text: finalReplyText,
      reply_time: finalReplyTime,
      reply_hidden: finalReplyHidden,
      images: media.images,
      videos: media.videos,
      editable: c.editable === true || c.editable === 'EDITABLE',
      raw_response: c,
      synced_at: new Date().toISOString(),
      synced_by: syncedBy || null,
    };
  });

  const { error } = await supabase
    .from('apishopee_reviews')
    .upsert(records, { onConflict: 'shop_id,comment_id' });

  if (error) {
    console.error('[REVIEWS-SYNC] Upsert error:', error);
    throw error;
  }

  return records.length;
}


/**
 * A. Initial Load - Lấy toàn bộ đánh giá
 * Chạy vòng lặp while (more == true) để lấy hết
 * Sau đó fetch thêm replied comments để cập nhật reply_text
 */
async function initialLoadReviews(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  userId?: string
): Promise<{ success: boolean; total_synced: number; error?: string }> {
  console.log('[REVIEWS-SYNC] Starting Initial Load for shop:', shopId);

  let cursor = '';
  let more = true;
  let totalSynced = 0;
  let latestCreateTime = 0;

  try {
    await updateSyncStatus(supabase, shopId, {
      is_syncing: true,
      last_error: null,
    });

    // Step 1: Fetch tất cả replied comments trước để có map reply
    const repliedMap = await fetchAllRepliedComments(supabase, credentials, shopId, token);

    // Step 2: Fetch tất cả comments và merge với replied data
    while (more) {
      const { comments, nextCursor, more: hasMore } = await fetchCommentPage(
        supabase, credentials, shopId, token, cursor
      );

      console.log(`[REVIEWS-SYNC] Fetched ${comments.length} comments, more: ${hasMore}`);

      if (comments.length > 0) {
        // Merge reply data từ repliedMap
        const enrichedComments = comments.map(c => {
          const repliedComment = repliedMap.get(c.comment_id);
          if (repliedComment) {
            // Copy reply data từ replied comment - ưu tiên comment_reply theo doc Shopee
            return {
              ...c,
              comment_reply: repliedComment.comment_reply,
              reply: repliedComment.reply,
              seller_reply: repliedComment.seller_reply,
              seller_reply_time: repliedComment.seller_reply_time,
            };
          }
          return c;
        });

        // Track latest create_time
        const maxCreateTime = Math.max(...enrichedComments.map(c => c.create_time));
        if (maxCreateTime > latestCreateTime) {
          latestCreateTime = maxCreateTime;
        }

        // Upsert vào database
        const inserted = await upsertReviews(supabase, shopId, enrichedComments, userId);
        totalSynced += inserted;

        // Update progress
        await updateSyncStatus(supabase, shopId, {
          total_synced: totalSynced,
          last_batch_count: enrichedComments.length,
        });
      }

      cursor = nextCursor;
      more = hasMore;

      // Rate limiting - đợi 500ms giữa các request
      if (more) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Hoàn thành initial load
    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      is_initial_sync_done: true,
      last_sync_at: new Date().toISOString(),
      last_sync_create_time: latestCreateTime,
      total_synced: totalSynced,
      last_error: null,
    });

    console.log(`[REVIEWS-SYNC] Initial Load completed. Total: ${totalSynced} reviews, Replied: ${repliedMap.size}`);
    return { success: true, total_synced: totalSynced };

  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error('[REVIEWS-SYNC] Initial Load failed:', errorMessage);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_error: errorMessage,
    });

    return { success: false, total_synced: totalSynced, error: errorMessage };
  }
}

/**
 * B. Periodic Sync - Lấy đánh giá mới
 * Gọi API từ đầu, dừng khi gặp đánh giá cũ hơn last_sync - 30 ngày
 * Cũng fetch replied comments để cập nhật reply mới
 */
async function periodicSyncReviews(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  lastSyncCreateTime: number,
  userId?: string
): Promise<{ success: boolean; new_reviews: number; updated_reviews: number; error?: string }> {
  console.log('[REVIEWS-SYNC] Starting Periodic Sync for shop:', shopId);

  // Điểm dừng: last_sync_create_time - 30 ngày (safety buffer)
  const stopTime = lastSyncCreateTime - (SAFETY_BUFFER_DAYS * 24 * 60 * 60);
  console.log(`[REVIEWS-SYNC] Stop condition: create_time < ${stopTime} (${new Date(stopTime * 1000).toISOString()})`);

  let cursor = '';
  let more = true;
  let newReviews = 0;
  let updatedReviews = 0;
  let latestCreateTime = lastSyncCreateTime;
  let shouldStop = false;

  try {
    await updateSyncStatus(supabase, shopId, {
      is_syncing: true,
      last_error: null,
    });

    // Fetch replied comments để có reply data mới nhất
    const repliedMap = await fetchAllRepliedComments(supabase, credentials, shopId, token);

    while (more && !shouldStop) {
      const { comments, nextCursor, more: hasMore } = await fetchCommentPage(
        supabase, credentials, shopId, token, cursor
      );

      console.log(`[REVIEWS-SYNC] Fetched ${comments.length} comments`);

      if (comments.length === 0) {
        break;
      }

      // Lọc comments cần xử lý (create_time >= stopTime)
      const commentsToProcess: ShopeeComment[] = [];
      
      for (const comment of comments) {
        if (comment.create_time < stopTime) {
          // Gặp đánh giá cũ hơn điểm dừng -> dừng lại
          console.log(`[REVIEWS-SYNC] Found old review (create_time: ${comment.create_time}), stopping...`);
          shouldStop = true;
          break;
        }
        
        // Merge reply data
        const repliedComment = repliedMap.get(comment.comment_id);
        if (repliedComment) {
          commentsToProcess.push({
            ...comment,
            comment_reply: repliedComment.comment_reply,
            reply: repliedComment.reply,
            seller_reply: repliedComment.seller_reply,
            seller_reply_time: repliedComment.seller_reply_time,
          });
        } else {
          commentsToProcess.push(comment);
        }
      }

      if (commentsToProcess.length > 0) {
        // Track latest create_time
        const maxCreateTime = Math.max(...commentsToProcess.map(c => c.create_time));
        if (maxCreateTime > latestCreateTime) {
          latestCreateTime = maxCreateTime;
        }

        // Check existing reviews để phân biệt new vs updated
        const commentIds = commentsToProcess.map(c => c.comment_id);
        const { data: existingReviews } = await supabase
          .from('apishopee_reviews')
          .select('comment_id')
          .eq('shop_id', shopId)
          .in('comment_id', commentIds);

        const existingIds = new Set(existingReviews?.map(r => r.comment_id) || []);
        
        const newComments = commentsToProcess.filter(c => !existingIds.has(c.comment_id));
        const updatedComments = commentsToProcess.filter(c => existingIds.has(c.comment_id));

        // Upsert tất cả
        await upsertReviews(supabase, shopId, commentsToProcess, userId);
        
        newReviews += newComments.length;
        updatedReviews += updatedComments.length;
      }

      cursor = nextCursor;
      more = hasMore;

      // Rate limiting
      if (more && !shouldStop) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Cập nhật sync status
    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_sync_at: new Date().toISOString(),
      last_sync_create_time: latestCreateTime,
      last_error: null,
    });

    console.log(`[REVIEWS-SYNC] Periodic Sync completed. New: ${newReviews}, Updated: ${updatedReviews}`);
    return { success: true, new_reviews: newReviews, updated_reviews: updatedReviews };

  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error('[REVIEWS-SYNC] Periodic Sync failed:', errorMessage);

    await updateSyncStatus(supabase, shopId, {
      is_syncing: false,
      last_error: errorMessage,
    });

    return { success: false, new_reviews: newReviews, updated_reviews: updatedReviews, error: errorMessage };
  }
}


/**
 * Main sync function - Tự động chọn Initial Load hoặc Periodic Sync
 */
async function syncReviews(
  supabase: ReturnType<typeof createClient>,
  credentials: PartnerCredentials,
  shopId: number,
  token: { access_token: string; refresh_token: string },
  userId?: string,
  forceInitial = false
): Promise<{
  success: boolean;
  mode: 'initial' | 'periodic';
  total_synced?: number;
  new_reviews?: number;
  updated_reviews?: number;
  error?: string;
}> {
  // Lấy sync status hiện tại
  const syncStatus = await getSyncStatus(supabase, shopId);

  // Kiểm tra nếu đang sync
  if (syncStatus?.is_syncing) {
    return {
      success: false,
      mode: 'initial',
      error: 'Sync is already in progress',
    };
  }

  // Quyết định mode: Initial Load hay Periodic Sync
  const shouldDoInitialLoad = forceInitial || !syncStatus?.is_initial_sync_done;

  if (shouldDoInitialLoad) {
    // A. Initial Load
    const result = await initialLoadReviews(supabase, credentials, shopId, token, userId);
    return {
      success: result.success,
      mode: 'initial',
      total_synced: result.total_synced,
      error: result.error,
    };
  } else {
    // B. Periodic Sync
    const lastSyncCreateTime = syncStatus?.last_sync_create_time || Math.floor(Date.now() / 1000);
    const result = await periodicSyncReviews(supabase, credentials, shopId, token, lastSyncCreateTime, userId);
    return {
      success: result.success,
      mode: 'periodic',
      new_reviews: result.new_reviews,
      updated_reviews: result.updated_reviews,
      error: result.error,
    };
  }
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id, user_id, force_initial } = body;

    if (!shop_id) {
      return new Response(JSON.stringify({ error: 'shop_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let result;

    switch (action) {
      case 'sync': {
        // Sync reviews (auto-detect initial vs periodic)
        const credentials = await getPartnerCredentials(supabase, shop_id);
        const token = await getTokenWithAutoRefresh(supabase, shop_id);
        result = await syncReviews(supabase, credentials, shop_id, token, user_id, force_initial === true);
        break;
      }

      case 'status': {
        // Get sync status
        const status = await getSyncStatus(supabase, shop_id);
        result = { success: true, status };
        break;
      }

      case 'get-reviews': {
        // Get reviews from database
        const { rating, replied, limit = 50, offset = 0 } = body;
        
        let query = supabase
          .from('apishopee_reviews')
          .select('*')
          .eq('shop_id', shop_id)
          .order('create_time', { ascending: false })
          .range(offset, offset + limit - 1);

        if (rating && rating !== 'ALL') {
          query = query.eq('rating_star', parseInt(rating));
        }
        if (replied === true) {
          query = query.not('reply_text', 'is', null);
        } else if (replied === false) {
          query = query.is('reply_text', null);
        }

        const { data, error, count } = await query;
        
        if (error) throw error;
        result = { success: true, reviews: data, count };
        break;
      }

      case 'get-stats': {
        // Get review statistics
        const { data: reviews } = await supabase
          .from('apishopee_reviews')
          .select('rating_star, reply_text')
          .eq('shop_id', shop_id);

        if (!reviews || reviews.length === 0) {
          result = {
            success: true,
            stats: { total: 0, avg_rating: 0, replied: 0, rating_counts: {} },
          };
        } else {
          const total = reviews.length;
          const sum = reviews.reduce((acc, r) => acc + r.rating_star, 0);
          const replied = reviews.filter(r => r.reply_text).length;
          const ratingCounts: Record<number, number> = {};
          reviews.forEach(r => {
            ratingCounts[r.rating_star] = (ratingCounts[r.rating_star] || 0) + 1;
          });

          result = {
            success: true,
            stats: {
              total,
              avg_rating: (sum / total).toFixed(1),
              replied,
              rating_counts: ratingCounts,
            },
          };
        }
        break;
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action. Use: sync, status, get-reviews, get-stats' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[REVIEWS-SYNC] Error:', error);
    return new Response(JSON.stringify({
      error: (error as Error).message,
      success: false,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
