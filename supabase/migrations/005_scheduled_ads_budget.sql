-- Migration: Scheduled Ads Budget
-- Bảng lưu cấu hình lịch điều chỉnh ngân sách ads theo khung giờ

-- Bảng cấu hình lịch ngân sách
CREATE TABLE IF NOT EXISTS scheduled_ads_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  campaign_name TEXT,
  ad_type TEXT NOT NULL CHECK (ad_type IN ('auto', 'manual')),
  
  -- Cấu hình khung giờ (0-23)
  hour_start INT NOT NULL CHECK (hour_start >= 0 AND hour_start <= 23),
  hour_end INT NOT NULL CHECK (hour_end >= 0 AND hour_end <= 23),
  
  -- Ngân sách cho khung giờ này
  budget DECIMAL(15, 2) NOT NULL,
  
  -- Ngày trong tuần áp dụng (0=CN, 1=T2, ..., 6=T7), NULL = tất cả
  days_of_week INT[] DEFAULT NULL,
  
  -- Trạng thái
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: mỗi campaign chỉ có 1 cấu hình cho mỗi khung giờ
  UNIQUE(shop_id, campaign_id, hour_start, hour_end)
);

-- Bảng log lịch sử thay đổi ngân sách
CREATE TABLE IF NOT EXISTS ads_budget_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  schedule_id UUID REFERENCES scheduled_ads_budget(id) ON DELETE SET NULL,
  
  -- Thông tin thay đổi
  old_budget DECIMAL(15, 2),
  new_budget DECIMAL(15, 2) NOT NULL,
  
  -- Kết quả
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  error_message TEXT,
  
  -- Thời gian
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index cho query hiệu quả
CREATE INDEX IF NOT EXISTS idx_scheduled_ads_budget_shop ON scheduled_ads_budget(shop_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_ads_budget_active ON scheduled_ads_budget(is_active, hour_start);
CREATE INDEX IF NOT EXISTS idx_ads_budget_logs_shop ON ads_budget_logs(shop_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ads_budget_logs_campaign ON ads_budget_logs(campaign_id, executed_at DESC);

-- Trigger cập nhật updated_at
CREATE OR REPLACE FUNCTION update_scheduled_ads_budget_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_scheduled_ads_budget ON scheduled_ads_budget;
CREATE TRIGGER trigger_update_scheduled_ads_budget
  BEFORE UPDATE ON scheduled_ads_budget
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduled_ads_budget_timestamp();

-- RLS Policies
ALTER TABLE scheduled_ads_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_budget_logs ENABLE ROW LEVEL SECURITY;

-- Policy cho service role (edge functions)
CREATE POLICY "Service role full access on scheduled_ads_budget" 
  ON scheduled_ads_budget FOR ALL 
  USING (true) 
  WITH CHECK (true);

CREATE POLICY "Service role full access on ads_budget_logs" 
  ON ads_budget_logs FOR ALL 
  USING (true) 
  WITH CHECK (true);
