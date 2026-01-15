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


