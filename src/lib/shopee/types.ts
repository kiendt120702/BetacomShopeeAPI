/**
 * Shopee SDK Types
 * Định nghĩa types cho Shopee SDK
 */

export interface AccessToken {
  refresh_token: string;
  access_token: string;
  expire_in: number;
  request_id?: string;
  error?: string;
  message?: string;
  shop_id?: number;
  merchant_id?: number;
  merchant_id_list?: number[];
  shop_id_list?: number[];
  supplier_id_list?: number[];
  expired_at?: number;
}

export interface RefreshedAccessToken extends Omit<AccessToken, 'merchant_id_list' | 'shop_id_list' | 'supplier_id_list'> {
  partner_id: number;
  shop_id?: number;
  merchant_id?: number;
}


// ==================== ADS API TYPES ====================

export type AdType = 'auto' | 'manual' | 'all' | '';
export type CampaignStatus = 'ongoing' | 'scheduled' | 'ended' | 'paused' | 'deleted' | 'closed';
export type BiddingMethod = 'auto' | 'manual';
export type CampaignPlacement = 'search' | 'discovery' | 'all';
export type KeywordStatus = 'deleted' | 'normal' | 'reserved' | 'blacklist';
export type KeywordMatchType = 'exact' | 'broad';
export type DiscoveryLocation = 'daily_discover' | 'you_may_also_like';
export type DiscoveryStatus = 'active' | 'inactive';
export type AutoProductStatus = 'learning' | 'ongoing' | 'paused' | 'ended' | 'unavailable';

// Campaign ID List Response
export interface CampaignIdItem {
  ad_type: AdType;
  campaign_id: number;
}

export interface GetCampaignIdListResponse {
  error: string;
  message: string;
  warning: string;
  request_id: string;
  response?: {
    shop_id: number;
    region: string;
    has_next_page: boolean;
    campaign_list: CampaignIdItem[];
  };
}

// Campaign Setting Info Types
export interface CampaignDuration {
  start_time: number;
  end_time: number;
}

export interface CommonInfo {
  ad_type: AdType;
  ad_name: string;
  campaign_status: CampaignStatus;
  bidding_method: BiddingMethod;
  campaign_placement: CampaignPlacement;
  campaign_budget: number;
  campaign_duration: CampaignDuration;
  item_id_list: number[];
}

export interface SelectedKeyword {
  keyword: string;
  status: KeywordStatus;
  match_type: KeywordMatchType;
  bid_price_per_click: number;
}

export interface DiscoveryAdsLocation {
  location: DiscoveryLocation;
  status: DiscoveryStatus;
  bid_price: number;
}

export interface ManualBiddingInfo {
  enhanced_cpc: boolean;
  selected_keywords: SelectedKeyword[];
  discovery_ads_locations: DiscoveryAdsLocation[];
}

export interface AutoBiddingInfo {
  roas_target: number;
}

export interface AutoProductAdsInfo {
  product_name: string;
  status: AutoProductStatus;
  item_id: number;
}

export interface CampaignSettingInfo {
  campaign_id: number;
  common_info?: CommonInfo;
  manual_bidding_info?: ManualBiddingInfo;
  auto_bidding_info?: AutoBiddingInfo;
  auto_product_ads_info?: AutoProductAdsInfo[];
}

export interface GetCampaignSettingInfoResponse {
  error: string;
  message: string;
  warning: string;
  request_id: string;
  response?: {
    shop_id: number;
    region: string;
    campaign_list: CampaignSettingInfo[];
  };
}

// Info Type Enum for get_product_level_campaign_setting_info
export enum CampaignInfoType {
  CommonInfo = 1,
  ManualBiddingInfo = 2,
  AutoBiddingInfo = 3,
  AutoProductAdsInfo = 4,
}


// ==================== EDIT ADS API TYPES ====================

export type EditAction = 
  | 'start' 
  | 'pause' 
  | 'resume' 
  | 'stop' 
  | 'delete' 
  | 'change_budget' 
  | 'change_duration' 
  | 'change_smart_creative' 
  | 'change_location' 
  | 'change_enhanced_cpc' 
  | 'change_roas_target';

export type SmartCreativeSetting = 'default' | 'on' | 'off' | '';

export interface EditManualProductAdsParams {
  reference_id: string;
  campaign_id: number;
  edit_action: EditAction;
  budget?: number;
  start_date?: string; // DD-MM-YYYY
  end_date?: string;   // DD-MM-YYYY or empty for unlimited
  roas_target?: number;
  discovery_ads_locations?: DiscoveryAdsLocation[];
  enhanced_cpc?: boolean;
  smart_creative_setting?: SmartCreativeSetting;
}

export interface EditAutoProductAdsParams {
  reference_id: string;
  campaign_id: number;
  edit_action: EditAction;
  budget?: number;
  start_date?: string; // DD-MM-YYYY
  end_date?: string;   // DD-MM-YYYY or empty for unlimited
}

export interface EditAdsResponse {
  error: string;
  message: string;
  warning: string;
  request_id: string;
  response?: {
    campaign_id: number;
  }[];
}


// ==================== SHOP API TYPES ====================

// SIP Affiliate Shop Info
export interface SipAffiShop {
  affi_shop_id: number;
  region: string;
}

// Linked Direct Shop Info
export interface LinkedDirectShop {
  direct_shop_id: number;
  direct_shop_region: string;
}

// Outlet Shop Info
export interface OutletShopInfo {
  outlet_shop_id: number;
}

// GET /api/v2/shop/get_shop_info Response
export interface ShopInfo {
  shop_name: string;
  region: string;
  status: 'BANNED' | 'FROZEN' | 'NORMAL';
  sip_affi_shops?: SipAffiShop[];
  is_cb: boolean;
  request_id: string;
  auth_time: number;
  expire_time: number;
  is_sip: boolean;
  is_upgraded_cbsc: boolean;
  merchant_id: number | null;
  shop_fulfillment_flag: string;
  is_main_shop: boolean;
  is_direct_shop: boolean;
  linked_main_shop_id: number;
  linked_direct_shop_list?: LinkedDirectShop[];
  is_one_awb?: boolean;
  is_mart_shop?: boolean;
  is_outlet_shop?: boolean;
  mart_shop_id?: number;
  outlet_shop_info_list?: OutletShopInfo[];
}

export interface GetShopInfoResponse {
  error: string;
  message: string;
  request_id: string;
  auth_time?: number;
  expire_time?: number;
  shop_name?: string;
  region?: string;
  status?: 'BANNED' | 'FROZEN' | 'NORMAL';
  shop_fulfillment_flag?: string;
  is_cb?: boolean;
  is_upgraded_cbsc?: boolean;
  merchant_id?: number | null;
  is_sip?: boolean;
  sip_affi_shops?: SipAffiShop[];
  is_main_shop?: boolean;
  is_direct_shop?: boolean;
  linked_direct_shop_list?: LinkedDirectShop[];
  linked_main_shop_id?: number;
  is_one_awb?: boolean;
  is_mart_shop?: boolean;
  is_outlet_shop?: boolean;
  mart_shop_id?: number;
  outlet_shop_info_list?: OutletShopInfo[];
}

// GET /api/v2/shop/get_profile Response
export interface ShopProfile {
  shop_logo: string;
  description: string;
  shop_name: string;
  invoice_issuer?: string;
}

export interface GetShopProfileResponse {
  error: string;
  message: string;
  request_id: string;
  response?: ShopProfile;
}


