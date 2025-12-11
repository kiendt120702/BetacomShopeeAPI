-- Migration: Tạo bảng cache campaigns quảng cáo
-- Lưu cache để load nhanh, background refresh từ Shopee API

CREATE TABLE IF NOT EXISTS campaigns_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  
  -- Campaign basic info
  ad_type TEXT, -- 'auto' | 'manual'
  name TEXT,
  status TEXT, -- 'ongoing', 'paused', 'scheduled', 'ended', 'deleted', 'closed'
  
  -- Common info
  campaign_placement TEXT,
  bidding_method TEXT,
  campaign_budget DECIMAL(15,2) DEFAULT 0,
  start_time BIGINT,
  end_time BIGINT,
  item_count INT DEFAULT 0,
  
  -- Auto bidding info
  roas_target DECIMAL(5,2),
  
  -- Raw data backup
  raw_data JSONB,
  
  -- Cache metadata
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  UNIQUE(shop_id, campaign_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_cache_shop_id ON campaigns_cache(shop_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_cache_status ON campaigns_cache(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_cache_cached_at ON campaigns_cache(cached_at);

-- Trigger cập nhật updated_at
CREATE TRIGGER update_campaigns_cache_updated_at
  BEFORE UPDATE ON campaigns_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE campaigns_cache ENABLE ROW LEVEL SECURITY;

-- Policy cho authenticated users đọc cache của shop họ đã kết nối
CREATE POLICY "Users can view campaigns cache" ON campaigns_cache
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_shops 
      WHERE user_shops.shop_id = campaigns_cache.shop_id 
      AND user_shops.user_id = auth.uid()
    )
  );

-- Policy cho insert/update (service role sẽ dùng)
CREATE POLICY "Users can insert campaigns cache" ON campaigns_cache
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_shops 
      WHERE user_shops.shop_id = campaigns_cache.shop_id 
      AND user_shops.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update campaigns cache" ON campaigns_cache
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_shops 
      WHERE user_shops.shop_id = campaigns_cache.shop_id 
      AND user_shops.user_id = auth.uid()
    )
  );
