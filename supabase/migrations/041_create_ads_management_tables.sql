-- =============================================
-- Migration: Create Ads Management Tables
-- Description: Tạo bảng quản lý quảng cáo Shopee theo tài liệu ads-management.md
-- =============================================

-- 1. Bảng apishopee_ads_campaign_data - Cache thông tin Campaigns
CREATE TABLE IF NOT EXISTS apishopee_ads_campaign_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  campaign_id BIGINT NOT NULL,
  
  -- Campaign basic info
  ad_type TEXT CHECK (ad_type IN ('auto', 'manual')),
  name TEXT,
  status TEXT, -- 'ongoing', 'paused', 'scheduled', 'ended', 'deleted', 'closed'
  
  -- Common info
  campaign_placement TEXT, -- 'search', 'discovery', 'all'
  bidding_method TEXT,     -- 'auto', 'manual'
  campaign_budget DECIMAL(15,2) DEFAULT 0,
  start_time BIGINT,       -- Unix timestamp
  end_time BIGINT,         -- Unix timestamp
  item_count INT DEFAULT 0,
  
  -- Auto bidding info
  roas_target DECIMAL(5,2),
  
  -- Raw data backup
  raw_data JSONB,
  
  -- Cache metadata
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  UNIQUE(shop_id, campaign_id)
);

-- Indexes cho apishopee_ads_campaign_data
CREATE INDEX IF NOT EXISTS idx_ads_campaign_data_shop_id ON apishopee_ads_campaign_data(shop_id);
CREATE INDEX IF NOT EXISTS idx_ads_campaign_data_status ON apishopee_ads_campaign_data(status);
CREATE INDEX IF NOT EXISTS idx_ads_campaign_data_cached_at ON apishopee_ads_campaign_data(cached_at);

-- 2. Bảng apishopee_scheduled_ads_budget - Cấu hình lịch ngân sách
CREATE TABLE IF NOT EXISTS apishopee_scheduled_ads_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  campaign_name TEXT,
  ad_type TEXT NOT NULL CHECK (ad_type IN ('auto', 'manual')),
  
  -- Cấu hình khung giờ (0-23)
  hour_start INT NOT NULL CHECK (hour_start >= 0 AND hour_start <= 23),
  hour_end INT NOT NULL CHECK (hour_end >= 0 AND hour_end <= 24),
  
  -- Ngân sách cho khung giờ này (VNĐ)
  budget DECIMAL(15, 2) NOT NULL,
  
  -- Ngày trong tuần áp dụng (0=CN, 1=T2, ..., 6=T7), NULL = tất cả
  days_of_week INT[] DEFAULT NULL,
  
  -- Ngày cụ thể áp dụng (YYYY-MM-DD format)
  specific_dates TEXT[] DEFAULT NULL,
  
  -- Trạng thái
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: mỗi campaign chỉ có 1 cấu hình cho mỗi khung giờ
  UNIQUE(shop_id, campaign_id, hour_start, hour_end)
);

-- Indexes cho apishopee_scheduled_ads_budget
CREATE INDEX IF NOT EXISTS idx_scheduled_ads_budget_shop ON apishopee_scheduled_ads_budget(shop_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_ads_budget_active ON apishopee_scheduled_ads_budget(is_active, hour_start);
CREATE INDEX IF NOT EXISTS idx_scheduled_ads_budget_campaign ON apishopee_scheduled_ads_budget(campaign_id);

-- 3. Bảng apishopee_ads_budget_logs - Lịch sử thay đổi ngân sách
CREATE TABLE IF NOT EXISTS apishopee_ads_budget_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  campaign_name TEXT,
  schedule_id UUID REFERENCES apishopee_scheduled_ads_budget(id) ON DELETE SET NULL,
  
  -- Thông tin thay đổi
  old_budget DECIMAL(15, 2),
  new_budget DECIMAL(15, 2) NOT NULL,
  
  -- Kết quả
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  error_message TEXT,
  
  -- Thời gian
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes cho apishopee_ads_budget_logs
CREATE INDEX IF NOT EXISTS idx_ads_budget_logs_shop ON apishopee_ads_budget_logs(shop_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ads_budget_logs_campaign ON apishopee_ads_budget_logs(campaign_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ads_budget_logs_status ON apishopee_ads_budget_logs(status);

-- 4. Enable RLS
ALTER TABLE apishopee_ads_campaign_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_scheduled_ads_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_ads_budget_logs ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies cho apishopee_ads_campaign_data
CREATE POLICY "Users can view own ads data" ON apishopee_ads_campaign_data
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_ads_campaign_data.shop_id 
      AND apishopee_shops.id IN (
        SELECT shop_id FROM apishopee_shop_members 
        WHERE profile_id = auth.uid() AND is_active = true
      )
    )
  );

CREATE POLICY "Users can insert own ads data" ON apishopee_ads_campaign_data
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_ads_campaign_data.shop_id 
      AND apishopee_shops.id IN (
        SELECT shop_id FROM apishopee_shop_members 
        WHERE profile_id = auth.uid() AND is_active = true
      )
    )
  );

CREATE POLICY "Users can update own ads data" ON apishopee_ads_campaign_data
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_ads_campaign_data.shop_id 
      AND apishopee_shops.id IN (
        SELECT shop_id FROM apishopee_shop_members 
        WHERE profile_id = auth.uid() AND is_active = true
      )
    )
  );

-- 6. RLS Policies cho apishopee_scheduled_ads_budget
CREATE POLICY "Users can manage own schedules" ON apishopee_scheduled_ads_budget
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_scheduled_ads_budget.shop_id 
      AND apishopee_shops.id IN (
        SELECT shop_id FROM apishopee_shop_members 
        WHERE profile_id = auth.uid() AND is_active = true
      )
    )
  );

-- 7. RLS Policies cho apishopee_ads_budget_logs
CREATE POLICY "Users can view own budget logs" ON apishopee_ads_budget_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_ads_budget_logs.shop_id 
      AND apishopee_shops.id IN (
        SELECT shop_id FROM apishopee_shop_members 
        WHERE profile_id = auth.uid() AND is_active = true
      )
    )
  );

CREATE POLICY "Users can insert own budget logs" ON apishopee_ads_budget_logs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_ads_budget_logs.shop_id 
      AND apishopee_shops.id IN (
        SELECT shop_id FROM apishopee_shop_members 
        WHERE profile_id = auth.uid() AND is_active = true
      )
    )
  );

-- 8. Service role bypass policies (cho Edge Functions)
CREATE POLICY "Service role full access ads_campaign_data" ON apishopee_ads_campaign_data
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access scheduled_ads_budget" ON apishopee_scheduled_ads_budget
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access ads_budget_logs" ON apishopee_ads_budget_logs
  FOR ALL USING (auth.role() = 'service_role');

-- 9. Updated_at trigger cho scheduled_ads_budget
CREATE OR REPLACE FUNCTION update_scheduled_ads_budget_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_scheduled_ads_budget_updated_at
  BEFORE UPDATE ON apishopee_scheduled_ads_budget
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduled_ads_budget_updated_at();

-- 10. Comments
COMMENT ON TABLE apishopee_ads_campaign_data IS 'Cache thông tin chiến dịch quảng cáo Shopee';
COMMENT ON TABLE apishopee_scheduled_ads_budget IS 'Cấu hình lịch tự động điều chỉnh ngân sách quảng cáo';
COMMENT ON TABLE apishopee_ads_budget_logs IS 'Lịch sử thay đổi ngân sách quảng cáo';
