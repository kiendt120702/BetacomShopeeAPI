-- =============================================
-- Migration: Create Ads Realtime Tables
-- Description: Tạo bảng lưu performance data và sync status cho Ads
-- Mô hình Realtime: Worker sync -> DB -> Realtime -> Frontend
-- =============================================

-- 1. Bảng apishopee_ads_performance_daily - Lưu performance theo ngày
CREATE TABLE IF NOT EXISTS apishopee_ads_performance_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  
  -- Date (YYYY-MM-DD format)
  performance_date DATE NOT NULL,
  
  -- Performance metrics
  impression BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  ctr DECIMAL(10,4) DEFAULT 0,           -- Click-through rate (%)
  expense DECIMAL(15,2) DEFAULT 0,        -- Chi phí (VNĐ)
  direct_order INT DEFAULT 0,
  direct_gmv DECIMAL(15,2) DEFAULT 0,
  broad_order INT DEFAULT 0,              -- Đơn hàng mở rộng
  broad_gmv DECIMAL(15,2) DEFAULT 0,      -- Doanh số mở rộng
  direct_item_sold INT DEFAULT 0,
  broad_item_sold INT DEFAULT 0,
  
  -- Calculated metrics
  roas DECIMAL(10,4) DEFAULT 0,           -- Return on Ad Spend = broad_gmv / expense
  acos DECIMAL(10,4) DEFAULT 0,           -- Advertising Cost of Sale = (expense / broad_gmv) * 100
  
  -- Metadata
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: mỗi campaign chỉ có 1 record cho mỗi ngày
  UNIQUE(shop_id, campaign_id, performance_date)
);

-- 2. Bảng apishopee_ads_performance_hourly - Lưu performance theo giờ
CREATE TABLE IF NOT EXISTS apishopee_ads_performance_hourly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  
  -- Date and hour
  performance_date DATE NOT NULL,
  hour INT NOT NULL CHECK (hour >= 0 AND hour <= 23),
  
  -- Performance metrics
  impression BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  ctr DECIMAL(10,4) DEFAULT 0,
  expense DECIMAL(15,2) DEFAULT 0,
  direct_order INT DEFAULT 0,
  direct_gmv DECIMAL(15,2) DEFAULT 0,
  broad_order INT DEFAULT 0,
  broad_gmv DECIMAL(15,2) DEFAULT 0,
  direct_item_sold INT DEFAULT 0,
  broad_item_sold INT DEFAULT 0,
  
  -- Calculated metrics
  roas DECIMAL(10,4) DEFAULT 0,
  acos DECIMAL(10,4) DEFAULT 0,
  
  -- Metadata
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  UNIQUE(shop_id, campaign_id, performance_date, hour)
);

-- 3. Bảng apishopee_ads_sync_status - Trạng thái sync
CREATE TABLE IF NOT EXISTS apishopee_ads_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL UNIQUE,
  
  -- Sync status
  is_syncing BOOLEAN DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  
  -- Sync progress
  sync_progress JSONB DEFAULT '{}',
  
  -- Statistics
  total_campaigns INT DEFAULT 0,
  ongoing_campaigns INT DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_ads_perf_daily_shop ON apishopee_ads_performance_daily(shop_id);
CREATE INDEX IF NOT EXISTS idx_ads_perf_daily_campaign ON apishopee_ads_performance_daily(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ads_perf_daily_date ON apishopee_ads_performance_daily(performance_date DESC);
CREATE INDEX IF NOT EXISTS idx_ads_perf_daily_shop_date ON apishopee_ads_performance_daily(shop_id, performance_date DESC);

CREATE INDEX IF NOT EXISTS idx_ads_perf_hourly_shop ON apishopee_ads_performance_hourly(shop_id);
CREATE INDEX IF NOT EXISTS idx_ads_perf_hourly_campaign ON apishopee_ads_performance_hourly(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ads_perf_hourly_date ON apishopee_ads_performance_hourly(performance_date DESC, hour);
CREATE INDEX IF NOT EXISTS idx_ads_perf_hourly_shop_date ON apishopee_ads_performance_hourly(shop_id, performance_date DESC);

-- 5. Enable RLS
ALTER TABLE apishopee_ads_performance_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_ads_performance_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_ads_sync_status ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies - Users can view data for shops they are members of
CREATE POLICY "Users can view own ads performance daily" ON apishopee_ads_performance_daily
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_ads_performance_daily.shop_id 
      AND apishopee_shops.id IN (
        SELECT shop_id FROM apishopee_shop_members 
        WHERE profile_id = auth.uid() AND is_active = true
      )
    )
  );

CREATE POLICY "Users can view own ads performance hourly" ON apishopee_ads_performance_hourly
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_ads_performance_hourly.shop_id 
      AND apishopee_shops.id IN (
        SELECT shop_id FROM apishopee_shop_members 
        WHERE profile_id = auth.uid() AND is_active = true
      )
    )
  );

CREATE POLICY "Users can view own ads sync status" ON apishopee_ads_sync_status
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_ads_sync_status.shop_id 
      AND apishopee_shops.id IN (
        SELECT shop_id FROM apishopee_shop_members 
        WHERE profile_id = auth.uid() AND is_active = true
      )
    )
  );

-- 7. Service role bypass policies (cho Edge Functions)
CREATE POLICY "Service role full access ads_performance_daily" ON apishopee_ads_performance_daily
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access ads_performance_hourly" ON apishopee_ads_performance_hourly
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access ads_sync_status" ON apishopee_ads_sync_status
  FOR ALL USING (auth.role() = 'service_role');

-- 8. Updated_at trigger
CREATE OR REPLACE FUNCTION update_ads_sync_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ads_sync_status_updated_at
  BEFORE UPDATE ON apishopee_ads_sync_status
  FOR EACH ROW
  EXECUTE FUNCTION update_ads_sync_status_updated_at();

-- 9. Enable Realtime for these tables (run separately if needed)
-- ALTER PUBLICATION supabase_realtime ADD TABLE apishopee_ads_campaign_data;
-- ALTER PUBLICATION supabase_realtime ADD TABLE apishopee_ads_performance_daily;
-- ALTER PUBLICATION supabase_realtime ADD TABLE apishopee_ads_performance_hourly;
-- ALTER PUBLICATION supabase_realtime ADD TABLE apishopee_ads_sync_status;

-- 10. Comments
COMMENT ON TABLE apishopee_ads_performance_daily IS 'Lưu performance quảng cáo theo ngày - sync từ Shopee API';
COMMENT ON TABLE apishopee_ads_performance_hourly IS 'Lưu performance quảng cáo theo giờ - sync từ Shopee API';
COMMENT ON TABLE apishopee_ads_sync_status IS 'Trạng thái sync dữ liệu quảng cáo';
