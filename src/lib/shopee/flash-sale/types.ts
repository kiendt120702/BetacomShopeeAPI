/**
 * Flash Sale Types and Constants
 * Defines all types, interfaces, and constants for Flash Sale feature
 */

// ==================== STATUS & TYPE ENUMS ====================

/**
 * Flash Sale Status
 * 0: Deleted - Flash sale đã bị xóa
 * 1: Enabled - Flash sale đang hoạt động
 * 2: Disabled - Flash sale bị tắt (có thể bật lại)
 * 3: Rejected - Hệ thống từ chối (không thể chỉnh sửa)
 */
export type FlashSaleStatus = 0 | 1 | 2 | 3;

/**
 * Flash Sale Type (based on time)
 * 1: Upcoming - Sắp tới (chưa bắt đầu)
 * 2: Ongoing - Đang chạy (đang diễn ra)
 * 3: Expired - Kết thúc (đã kết thúc)
 */
export type FlashSaleType = 1 | 2 | 3;

/**
 * Flash Sale Item Status
 * 0: Disabled - Sản phẩm bị tắt
 * 1: Enabled - Sản phẩm đang hoạt động
 * 2: Deleted - Sản phẩm đã xóa
 * 4: System Rejected - Hệ thống từ chối
 * 5: Manual Rejected - Từ chối thủ công
 */
export type FlashSaleItemStatus = 0 | 1 | 2 | 4 | 5;

// ==================== UI CONSTANTS ====================

/**
 * Status color mapping for UI display
 */
export const STATUS_COLORS: Record<FlashSaleStatus, string> = {
  0: 'gray',      // Deleted
  1: 'green',     // Enabled
  2: 'yellow',    // Disabled
  3: 'red',       // Rejected
};

/**
 * Status labels for UI display (Vietnamese)
 */
export const STATUS_LABELS: Record<FlashSaleStatus, string> = {
  0: 'Đã xóa',
  1: 'Bật',
  2: 'Tắt',
  3: 'Từ chối',
};

/**
 * Type icons for UI display
 */
export const TYPE_ICONS: Record<FlashSaleType, string> = {
  1: '⏳',        // Upcoming
  2: '🔥',        // Ongoing
  3: '✓',         // Expired
};

/**
 * Type labels for UI display (Vietnamese)
 */
export const TYPE_LABELS: Record<FlashSaleType, string> = {
  1: 'Sắp tới',
  2: 'Đang chạy',
  3: 'Kết thúc',
};

/**
 * Sort priority: Ongoing > Upcoming > Expired
 */
export const TYPE_PRIORITY: Record<FlashSaleType, number> = {
  2: 1,           // Ongoing - highest priority
  1: 2,           // Upcoming
  3: 3,           // Expired - lowest priority
};

/**
 * Filter type options for UI
 */
export const FILTER_OPTIONS = [
  { value: '0', label: 'Tất cả' },
  { value: '1', label: 'Sắp tới' },
  { value: '2', label: 'Đang chạy' },
  { value: '3', label: 'Kết thúc' },
] as const;

export type FilterType = '0' | '1' | '2' | '3';

// ==================== CONFIGURATION CONSTANTS ====================

/**
 * Data staleness threshold in minutes
 */
export const STALE_MINUTES = 5;

/**
 * Items per page for pagination
 */
export const ITEMS_PER_PAGE = 20;

/**
 * Token refresh buffer in milliseconds (5 minutes)
 */
export const TOKEN_BUFFER_MS = 5 * 60 * 1000;

/**
 * Maximum items allowed in a Flash Sale
 */
export const MAX_FLASH_SALE_ITEMS = 50;

// ==================== DATA INTERFACES ====================

/**
 * Flash Sale data from database
 */
export interface FlashSale {
  id: string;                    // UUID
  shop_id: number;
  user_id: string;
  flash_sale_id: number;
  timeslot_id: number;
  status: FlashSaleStatus;
  start_time: number;            // Unix timestamp
  end_time: number;              // Unix timestamp
  enabled_item_count: number;
  item_count: number;
  type: FlashSaleType;
  remindme_count: number;
  click_count: number;
  raw_response: Record<string, unknown> | null;
  synced_at: string;             // ISO timestamp
  created_at: string;
  updated_at: string;
}

/**
 * Flash Sale Item with variants
 */
export interface FlashSaleItemModel {
  model_id: number;
  input_promo_price: number;     // Price before tax
  stock: number;                 // Campaign stock
}

/**
 * Flash Sale Item
 */
export interface FlashSaleItem {
  item_id: number;
  purchase_limit: number;        // 0 = unlimited
  // For items with variants
  models?: FlashSaleItemModel[];
  // For items without variants
  item_input_promo_price?: number;
  item_stock?: number;
}

/**
 * Time Slot from Shopee API
 */
export interface TimeSlot {
  timeslot_id: number;
  start_time: number;            // Unix timestamp
  end_time: number;              // Unix timestamp
}

/**
 * Sync Status from database
 */
export interface SyncStatus {
  id: string;
  shop_id: number;
  user_id: string;
  flash_sales_synced_at: string | null;
  is_syncing: boolean;
  last_sync_error: string | null;
  sync_progress: SyncProgress | null;
  created_at: string;
  updated_at: string;
}

/**
 * Sync Progress details
 */
export interface SyncProgress {
  current_step: string;
  total_items: number;
  processed_items: number;
}

// ==================== API REQUEST/RESPONSE INTERFACES ====================

/**
 * Flash Sale API action types
 */
export type FlashSaleAction =
  | 'get-time-slots'
  | 'create-flash-sale'
  | 'get-flash-sale'
  | 'get-flash-sale-list'
  | 'update-flash-sale'
  | 'delete-flash-sale'
  | 'add-items'
  | 'get-items'
  | 'update-items'
  | 'delete-items'
  | 'get-criteria';

/**
 * Flash Sale API request
 */
export interface FlashSaleRequest {
  action: FlashSaleAction;
  shop_id: number;
  user_id?: string;
  flash_sale_id?: number;
  timeslot_id?: number;
  start_time?: number;
  end_time?: number;
  items?: FlashSaleItem[];
  item_id?: number;
  status?: FlashSaleStatus;
}

/**
 * Sync Worker request
 */
export interface SyncWorkerRequest {
  action: 'sync-flash-sale-data';
  shop_id: number;
  user_id: string;
}

/**
 * Sync Worker response
 */
export interface SyncWorkerResponse {
  success: boolean;
  synced_count?: number;
  error?: string;
  synced_at?: string;
}

/**
 * Error response from Edge Function
 */
export interface ErrorResponse {
  error: string;
  message?: string;
  success: false;
  details?: string;
}

// ==================== ERROR CODES ====================

/**
 * Known Shopee API error codes
 */
export const SHOPEE_ERROR_CODES = {
  ALREADY_EXIST: 'shop_flash_sale_already_exist',
  NOT_MEET_CRITERIA: 'shop_flash_sale.not_meet_shop_criteria',
  EXCEED_ITEM_LIMIT: 'shop_flash_sale_exceed_max_item_limit',
  NOT_ENABLED_OR_UPCOMING: 'shop_flash_sale_is_not_enabled_or_upcoming',
  HOLIDAY_MODE: 'shop_flash_sale_in_holiday_mode',
  AUTH_ERROR: 'error_auth',
  INVALID_TOKEN: 'Invalid access_token',
} as const;

/**
 * User-friendly error messages (Vietnamese)
 */
export const ERROR_MESSAGES: Record<string, string> = {
  [SHOPEE_ERROR_CODES.ALREADY_EXIST]: 'Flash Sale đã tồn tại cho khung giờ này. Vui lòng chọn khung giờ khác.',
  [SHOPEE_ERROR_CODES.NOT_MEET_CRITERIA]: 'Shop không đủ điều kiện tham gia Flash Sale. Kiểm tra rating và performance.',
  [SHOPEE_ERROR_CODES.EXCEED_ITEM_LIMIT]: 'Vượt quá giới hạn 50 sản phẩm. Vui lòng giảm số sản phẩm.',
  [SHOPEE_ERROR_CODES.NOT_ENABLED_OR_UPCOMING]: 'Không thể sửa Flash Sale đang chạy hoặc đã kết thúc.',
  [SHOPEE_ERROR_CODES.HOLIDAY_MODE]: 'Shop đang ở chế độ nghỉ. Vui lòng tắt holiday mode.',
  [SHOPEE_ERROR_CODES.AUTH_ERROR]: 'Token hết hạn. Đang tự động refresh...',
  [SHOPEE_ERROR_CODES.INVALID_TOKEN]: 'Token không hợp lệ. Đang tự động refresh...',
};
