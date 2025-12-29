/**
 * Shopee API Types
 * Based on apishopee_ schema tables
 */

// ============================================
// SHOP MEMBER ROLES
// ============================================
export type ShopMemberRole = 'admin' | 'manager' | 'member';

// ============================================
// PARTNER ACCOUNTS
// ============================================
export interface ApiShopeePartnerAccount {
    id: string;
    partner_id: number;
    partner_key: string;
    partner_name: string | null;
    description: string | null;
    is_active: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

// ============================================
// SHOPS
// ============================================
export interface ApiShopeeShop {
    id: string;
    shop_id: number;
    shop_name: string | null;
    region: string;
    shop_logo: string | null;
    partner_account_id: string | null;
    access_token: string | null;
    refresh_token: string | null;
    token_expired_at: number | null;
    token_updated_at: string | null;
    merchant_id: number | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

// ============================================
// SHOP MEMBERS
// ============================================
export interface ApiShopeeShopMember {
    id: string;
    shop_id: string;
    profile_id: string;
    role: ShopMemberRole;
    is_active: boolean;
    created_at: string;
    updated_at: string;

    // Joined data
    apishopee_shops?: ApiShopeeShop;
    profile?: SysProfile;
}

// ============================================
// FLASH SALES
// ============================================
export interface ApiShopeeFlashSale {
    id: string;
    shop_id: string;
    flash_sale_id: number;
    start_time: string;
    end_time: string;
    status: 'upcoming' | 'ongoing' | 'ended';
    raw_data: Record<string, unknown> | null;
    synced_at: string;
    created_at: string;
    updated_at: string;
}

export interface ApiShopeeFlashSaleItem {
    id: string;
    flash_sale_id: string;
    item_id: number;
    model_id: number | null;
    item_name: string | null;
    original_price: number | null;
    promo_price: number | null;
    stock: number | null;
    status: string;
    created_at: string;
    updated_at: string;
}

// ============================================
// ADS
// ============================================
export interface ApiShopeeAdsCampaign {
    id: string;
    shop_id: string;
    campaign_id: number;
    campaign_name: string | null;
    campaign_type: string | null;
    status: string | null;
    daily_budget: number | null;
    total_budget: number | null;
    start_date: string | null;
    end_date: string | null;
    raw_data: Record<string, unknown> | null;
    synced_at: string;
    created_at: string;
    updated_at: string;
}

export interface ApiShopeeAdsSchedule {
    id: string;
    shop_id: string;
    campaign_id: string | null;
    schedule_type: 'one_time' | 'daily' | 'weekly';
    scheduled_at: string | null;
    new_budget: number | null;
    action: 'update' | 'pause' | 'resume';
    status: 'pending' | 'executed' | 'failed' | 'cancelled';
    executed_at: string | null;
    error_message: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

// ============================================
// LOGS
// ============================================
export interface ApiShopeeTokenRefreshLog {
    id: string;
    shop_id: string | null;
    shopee_shop_id: number | null;
    success: boolean;
    error_message: string | null;
    old_token_expired_at: number | null;
    new_token_expired_at: number | null;
    refresh_source: 'auto' | 'manual' | 'api';
    created_at: string;
}

export interface ApiShopeeActivityLog {
    id: string;
    profile_id: string | null;
    shop_id: string | null;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    details: Record<string, unknown> | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
}

// ============================================
// SYS_PROFILES (from existing schema)
// ============================================
export interface SysProfile {
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    work_type: 'fulltime' | 'parttime';
    join_date: string | null;
    created_at: string;
    updated_at: string;
    // Computed for display
    role_display_name?: string;
}

// ============================================
// VIEW TYPES (for UI)
// ============================================
export interface ShopWithMembership extends ApiShopeeShop {
    role?: ShopMemberRole;
    member_count?: number;
}

export interface MemberWithProfile extends ApiShopeeShopMember {
    profile: SysProfile;
}
