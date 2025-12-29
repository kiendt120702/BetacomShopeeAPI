/**
 * Shopee Ads API Client via Supabase Edge Functions
 * Gọi backend API để xử lý Shopee Ads
 */

import { supabase, getShopUuidFromShopId } from '../supabase';
import type {
  AdType,
  GetCampaignIdListResponse,
  GetCampaignSettingInfoResponse,
  CampaignInfoType,
} from './types';

export interface GetCampaignIdListParams {
  shop_id: number;
  ad_type?: AdType;
  offset?: number;
  limit?: number;
}

export interface GetCampaignSettingInfoParams {
  shop_id: number;
  campaign_id_list: number[] | string;
  info_type_list: CampaignInfoType[] | string;
}

/**
 * Lấy danh sách campaign IDs
 * @param params - Parameters cho API
 * @returns Danh sách campaign IDs với ad_type
 */
export async function getCampaignIdList(
  params: GetCampaignIdListParams
): Promise<GetCampaignIdListResponse> {
  const { data, error } = await supabase.functions.invoke('apishopee-ads', {
    body: {
      action: 'get-campaign-id-list',
      shop_id: params.shop_id,
      ad_type: params.ad_type || 'all',
      offset: params.offset ?? 0,
      limit: params.limit ?? 5000,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to get campaign ID list');
  }

  return data as GetCampaignIdListResponse;
}

/**
 * Lấy thông tin chi tiết campaign
 * @param params - Parameters cho API
 * @returns Thông tin chi tiết của các campaigns
 */
export async function getCampaignSettingInfo(
  params: GetCampaignSettingInfoParams
): Promise<GetCampaignSettingInfoResponse> {
  // Convert arrays to comma-separated strings
  const campaignIdList = Array.isArray(params.campaign_id_list)
    ? params.campaign_id_list.join(',')
    : params.campaign_id_list;

  const infoTypeList = Array.isArray(params.info_type_list)
    ? params.info_type_list.join(',')
    : params.info_type_list;

  const { data, error } = await supabase.functions.invoke('apishopee-ads', {
    body: {
      action: 'get-campaign-setting-info',
      shop_id: params.shop_id,
      campaign_id_list: campaignIdList,
      info_type_list: infoTypeList,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to get campaign setting info');
  }

  return data as GetCampaignSettingInfoResponse;
}

/**
 * Lấy tất cả campaigns với thông tin đầy đủ
 * Helper function kết hợp cả 2 API
 */
export async function getAllCampaignsWithInfo(
  shopId: number,
  adType: AdType = 'all'
): Promise<GetCampaignSettingInfoResponse | null> {
  // Step 1: Lấy danh sách campaign IDs
  const idListResponse = await getCampaignIdList({
    shop_id: shopId,
    ad_type: adType,
  });

  if (idListResponse.error || !idListResponse.response?.campaign_list?.length) {
    console.log('No campaigns found or error:', idListResponse.error);
    return null;
  }

  const campaignIds = idListResponse.response.campaign_list.map(c => c.campaign_id);

  // Step 2: Lấy thông tin chi tiết (max 100 campaigns per request)
  const batchSize = 100;
  const allCampaigns: GetCampaignSettingInfoResponse['response'] = {
    shop_id: shopId,
    region: idListResponse.response.region,
    campaign_list: [],
  };

  for (let i = 0; i < campaignIds.length; i += batchSize) {
    const batch = campaignIds.slice(i, i + batchSize);

    const settingResponse = await getCampaignSettingInfo({
      shop_id: shopId,
      campaign_id_list: batch,
      info_type_list: '1,2,3,4', // All info types
    });

    if (settingResponse.response?.campaign_list) {
      allCampaigns.campaign_list.push(...settingResponse.response.campaign_list);
    }
  }

  return {
    error: '',
    message: '',
    warning: '',
    request_id: '',
    response: allCampaigns,
  };
}


// ==================== EDIT ADS FUNCTIONS ====================

import type {
  EditManualProductAdsParams,
  EditAutoProductAdsParams,
  EditAdsResponse,
  EditAction,
} from './types';

export interface EditCampaignBudgetParams {
  shop_id: number;
  campaign_id: number;
  ad_type: 'auto' | 'manual';
  budget: number;
}

export interface EditCampaignStatusParams {
  shop_id: number;
  campaign_id: number;
  ad_type: 'auto' | 'manual';
  action: 'start' | 'pause' | 'resume' | 'stop' | 'delete';
}

/**
 * Generate unique reference ID
 */
function generateReferenceId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Chỉnh sửa Manual Product Ads
 */
export async function editManualProductAds(
  params: EditManualProductAdsParams & { shop_id: number }
): Promise<EditAdsResponse> {
  const { shop_id, ...adsParams } = params;

  const { data, error } = await supabase.functions.invoke('apishopee-ads', {
    body: {
      action: 'edit-manual-product-ads',
      shop_id,
      ...adsParams,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to edit manual product ads');
  }

  return data as EditAdsResponse;
}

/**
 * Chỉnh sửa Auto Product Ads
 */
export async function editAutoProductAds(
  params: EditAutoProductAdsParams & { shop_id: number }
): Promise<EditAdsResponse> {
  const { shop_id, ...adsParams } = params;

  const { data, error } = await supabase.functions.invoke('apishopee-ads', {
    body: {
      action: 'edit-auto-product-ads',
      shop_id,
      ...adsParams,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to edit auto product ads');
  }

  return data as EditAdsResponse;
}

/**
 * Helper: Chỉnh sửa ngân sách chiến dịch
 * Tự động chọn API phù hợp dựa trên ad_type
 */
export async function editCampaignBudget(
  params: EditCampaignBudgetParams
): Promise<EditAdsResponse> {
  const { shop_id, campaign_id, ad_type, budget } = params;
  const reference_id = generateReferenceId();

  if (ad_type === 'manual') {
    return editManualProductAds({
      shop_id,
      reference_id,
      campaign_id,
      edit_action: 'change_budget',
      budget,
    });
  } else {
    return editAutoProductAds({
      shop_id,
      reference_id,
      campaign_id,
      edit_action: 'change_budget',
      budget,
    });
  }
}

/**
 * Helper: Thay đổi trạng thái chiến dịch (start/pause/resume/stop/delete)
 */
export async function editCampaignStatus(
  params: EditCampaignStatusParams
): Promise<EditAdsResponse> {
  const { shop_id, campaign_id, ad_type, action } = params;
  const reference_id = generateReferenceId();

  if (ad_type === 'manual') {
    return editManualProductAds({
      shop_id,
      reference_id,
      campaign_id,
      edit_action: action,
    });
  } else {
    return editAutoProductAds({
      shop_id,
      reference_id,
      campaign_id,
      edit_action: action,
    });
  }
}


// ==================== CAMPAIGNS CACHE ====================

import type { CampaignIdItem, CommonInfo } from './types';

export interface CachedCampaign {
  id: string;
  shop_id: number;
  user_id: string;
  campaign_id: number;
  ad_type: string;
  name: string | null;
  status: string | null;
  campaign_placement: string | null;
  bidding_method: string | null;
  campaign_budget: number;
  start_time: number | null;
  end_time: number | null;
  item_count: number;
  roas_target: number | null;
  raw_response: any;
  synced_at: string;
}

/**
 * Lấy campaigns từ cache
 */
export async function getCampaignsFromCache(shopId: number): Promise<CachedCampaign[]> {
  // Get the UUID for this shop
  const shopUuid = await getShopUuidFromShopId(shopId);
  if (!shopUuid) {
    console.error('[getCampaignsFromCache] Could not find shop UUID for shop_id:', shopId);
    return [];
  }

  const { data, error } = await supabase
    .from('apishopee_ads_campaign_data')
    .select('*')
    .eq('shop_id', shopUuid)
    .order('status', { ascending: true });

  if (error) {
    console.error('[getCampaignsFromCache] Error:', error);
    return [];
  }

  return data || [];
}

/**
 * Lưu campaigns vào cache
 */
export async function saveCampaignsToCache(
  shopId: number,
  campaigns: Array<CampaignIdItem & {
    name?: string;
    status?: string;
    common_info?: CommonInfo;
    roas_target?: number;
  }>
): Promise<void> {
  if (!campaigns.length) return;

  // Get the UUID for this shop
  const shopUuid = await getShopUuidFromShopId(shopId);
  if (!shopUuid) {
    console.error('[saveCampaignsToCache] Could not find shop UUID for shop_id:', shopId);
    return;
  }

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;

  const cacheData = campaigns.map(c => ({
    shop_id: shopUuid,
    user_id: userId,
    campaign_id: c.campaign_id,
    ad_type: c.ad_type,
    name: c.name || null,
    status: c.status || null,
    campaign_placement: c.common_info?.campaign_placement || null,
    bidding_method: c.common_info?.bidding_method || null,
    campaign_budget: c.common_info?.campaign_budget || 0,
    start_time: c.common_info?.campaign_duration?.start_time || null,
    end_time: c.common_info?.campaign_duration?.end_time || null,
    item_count: c.common_info?.item_id_list?.length || 0,
    roas_target: c.roas_target || null,
    raw_response: c,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('apishopee_ads_campaign_data')
    .upsert(cacheData, { onConflict: 'shop_id,campaign_id' });

  if (error) {
    console.error('[saveCampaignsToCache] Error:', error);
  }
}

/**
 * Kiểm tra cache có cần refresh không (> 5 phút)
 */
export function isCacheStale(cachedAt: string, maxAgeMinutes = 5): boolean {
  const cacheTime = new Date(cachedAt).getTime();
  const now = Date.now();
  return (now - cacheTime) > maxAgeMinutes * 60 * 1000;
}
