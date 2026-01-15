-- =============================================
-- Migration: Create Campaigns Tables
-- Description: Tạo bảng lưu trữ chiến dịch quảng cáo Shopee
-- =============================================

-- 1. Bảng campaigns
CREATE TABLE IF NOT EXISTS apishopee_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES apishopee_shops(id) ON DELETE CASCADE,
  shopee_shop_id bigint NOT NULL,
  
  -- Campaign Info
  campaign_id bigint NOT NULL,
  campaign_name text,
  campaign_type text, -- product_level, shop_level
  status text, -- ongoing, ended, scheduled
  
  -- Settings
  placement jsonb, -- Vị trí hiển thị (search, recommendation, etc.)
  budget numeric(15,2), -- Ngân sách
  daily_budget numeric(15,2), -- Ngân sách hàng ngày
  start_time bigint, -- Unix timestamp
  end_time bigint, -- Unix timestamp
  
  -- Performance Metrics
  impressions bigint DEFAULT 0,
  clicks bigint DEFAULT 0,
  orders bigint DEFAULT 0,
  gmv numeric(15,2) DEFAULT 0, -- Gross Merchandise Value
  spend numeric(15,2) DEFAULT 0, -- Số tiền đã chi
  ctr numeric(5,2) DEFAULT 0, -- Click-through rate (%)
  conversion_rate numeric(5,2) DEFAULT 0, -- Tỷ lệ chuyển đổi (%)
  
  -- Performance Date Range
  performance_start_date bigint, -- Unix timestamp
  performance_end_date bigint, -- Unix timestamp
  
  -- Metadata
  raw_data jsonb, -- Lưu toàn bộ response từ API
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Constraints
  UNIQUE(shop_id, campaign_id)
);

-- 2. Bảng campaign daily performance (optional - lưu chi tiết theo ngày)
CREATE TABLE IF NOT EXISTS apishopee_campaign_daily_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES apishopee_campaigns(id) ON DELETE CASCADE,
  
  -- Date
  date date NOT NULL,
  
  -- Daily Metrics
  impressions bigint DEFAULT 0,
  clicks bigint DEFAULT 0,
  orders bigint DEFAULT 0,
  gmv numeric(15,2) DEFAULT 0,
  spend numeric(15,2) DEFAULT 0,
  ctr numeric(5,2) DEFAULT 0,
  conversion_rate numeric(5,2) DEFAULT 0,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Constraints
  UNIQUE(campaign_id, date)
);

-- 3. Indexes
CREATE INDEX idx_campaigns_shop_id ON apishopee_campaigns(shop_id);
CREATE INDEX idx_campaigns_shopee_shop_id ON apishopee_campaigns(shopee_shop_id);
CREATE INDEX idx_campaigns_campaign_id ON apishopee_campaigns(campaign_id);
CREATE INDEX idx_campaigns_status ON apishopee_campaigns(status);
CREATE INDEX idx_campaigns_last_synced ON apishopee_campaigns(last_synced_at);

CREATE INDEX idx_campaign_daily_campaign_id ON apishopee_campaign_daily_performance(campaign_id);
CREATE INDEX idx_campaign_daily_date ON apishopee_campaign_daily_performance(date);

-- 4. RLS Policies
ALTER TABLE apishopee_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_campaign_daily_performance ENABLE ROW LEVEL SECURITY;

-- Policy: User chỉ xem campaigns của shop mình là member
CREATE POLICY "Users can view campaigns of their shops"
  ON apishopee_campaigns
  FOR SELECT
  USING (
    shop_id IN (
      SELECT shop_id FROM apishopee_shop_members
      WHERE profile_id = auth.uid() AND is_active = true
    )
  );

-- Policy: User chỉ xem daily performance của campaigns thuộc shop mình
CREATE POLICY "Users can view daily performance of their campaigns"
  ON apishopee_campaign_daily_performance
  FOR SELECT
  USING (
    campaign_id IN (
      SELECT id FROM apishopee_campaigns
      WHERE shop_id IN (
        SELECT shop_id FROM apishopee_shop_members
        WHERE profile_id = auth.uid() AND is_active = true
      )
    )
  );

-- 5. Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON apishopee_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_daily_updated_at
  BEFORE UPDATE ON apishopee_campaign_daily_performance
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 6. Comments
COMMENT ON TABLE apishopee_campaigns IS 'Lưu trữ thông tin chiến dịch quảng cáo Shopee';
COMMENT ON TABLE apishopee_campaign_daily_performance IS 'Lưu trữ hiệu suất chiến dịch theo ngày';
