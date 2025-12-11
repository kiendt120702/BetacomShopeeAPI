-- Migration: Tạo bảng cache thông tin shop
-- Lưu cache shop info và profile để giảm số lần gọi API Shopee

CREATE TABLE IF NOT EXISTS shop_info_cache (
  shop_id BIGINT PRIMARY KEY,
  
  -- Shop Info từ get_shop_info
  shop_name TEXT,
  region TEXT,
  status TEXT,
  is_cb BOOLEAN DEFAULT false,
  is_sip BOOLEAN DEFAULT false,
  is_upgraded_cbsc BOOLEAN DEFAULT false,
  merchant_id BIGINT,
  shop_fulfillment_flag TEXT,
  is_main_shop BOOLEAN DEFAULT false,
  is_direct_shop BOOLEAN DEFAULT false,
  linked_main_shop_id BIGINT,
  linked_direct_shop_list JSONB,
  sip_affi_shops JSONB,
  is_one_awb BOOLEAN,
  is_mart_shop BOOLEAN,
  is_outlet_shop BOOLEAN,
  auth_time BIGINT,
  expire_time BIGINT,
  
  -- Shop Profile từ get_profile
  shop_logo TEXT,
  description TEXT,
  
  -- Cache metadata
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_shop_info_cache_cached_at ON shop_info_cache(cached_at);

-- Function cập nhật updated_at
CREATE TRIGGER update_shop_info_cache_updated_at
  BEFORE UPDATE ON shop_info_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS - cho phép service role truy cập
ALTER TABLE shop_info_cache ENABLE ROW LEVEL SECURITY;

-- Policy cho authenticated users đọc cache của shop họ đã kết nối
CREATE POLICY "Users can view shop cache" ON shop_info_cache
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_shops 
      WHERE user_shops.shop_id = shop_info_cache.shop_id 
      AND user_shops.user_id = auth.uid()
    )
  );
