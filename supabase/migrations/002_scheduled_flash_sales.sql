-- Bảng lưu lịch hẹn giờ copy Flash Sale
CREATE TABLE IF NOT EXISTS scheduled_flash_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  
  -- Thông tin Flash Sale nguồn
  source_flash_sale_id BIGINT NOT NULL,
  
  -- Thông tin khung giờ đích
  target_timeslot_id BIGINT NOT NULL,
  target_start_time BIGINT NOT NULL, -- Unix timestamp của khung giờ Flash Sale
  
  -- Thời gian thực hiện (trước 10 phút)
  scheduled_at TIMESTAMPTZ NOT NULL,
  
  -- Dữ liệu items để copy (JSON)
  items_data JSONB NOT NULL,
  
  -- Trạng thái: pending, running, completed, failed
  status TEXT NOT NULL DEFAULT 'pending',
  
  -- Kết quả sau khi chạy
  result_flash_sale_id BIGINT,
  result_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index để query nhanh
CREATE INDEX idx_scheduled_flash_sales_status ON scheduled_flash_sales(status);
CREATE INDEX idx_scheduled_flash_sales_scheduled_at ON scheduled_flash_sales(scheduled_at);
CREATE INDEX idx_scheduled_flash_sales_shop_id ON scheduled_flash_sales(shop_id);

-- Trigger cập nhật updated_at
CREATE OR REPLACE FUNCTION update_scheduled_flash_sales_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_scheduled_flash_sales_updated_at
  BEFORE UPDATE ON scheduled_flash_sales
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduled_flash_sales_updated_at();
