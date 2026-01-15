-- Migration: Create reviews tables for Shopee reviews sync
-- Logic:
-- A. Initial Load: Lấy toàn bộ đánh giá (while more == true)
-- B. Periodic Sync (30 phút): Lấy từ đầu, dừng khi gặp đánh giá cũ hơn last_sync - 30 ngày

-- =====================================================
-- 1. Bảng lưu đánh giá từ Shopee
-- =====================================================
CREATE TABLE IF NOT EXISTS apishopee_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Shop info
  shop_id BIGINT NOT NULL,
  
  -- Review data từ Shopee API
  comment_id BIGINT NOT NULL,
  order_sn TEXT,
  item_id BIGINT NOT NULL,
  model_id BIGINT,
  
  -- Buyer info
  buyer_username TEXT,
  
  -- Rating & Comment
  rating_star INT NOT NULL CHECK (rating_star >= 1 AND rating_star <= 5),
  comment TEXT,
  
  -- Timestamps từ Shopee (Unix timestamp)
  create_time BIGINT NOT NULL,
  
  -- Reply info
  reply_text TEXT,
  reply_time BIGINT,
  
  -- Media
  images JSONB DEFAULT '[]'::jsonb,
  videos JSONB DEFAULT '[]'::jsonb,
  
  -- Item info (cached)
  item_name TEXT,
  item_image TEXT,
  
  -- Editable flag
  editable BOOLEAN DEFAULT false,
  
  -- Raw response từ API
  raw_response JSONB,
  
  -- Metadata
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  synced_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: mỗi shop chỉ có 1 record cho mỗi comment_id
  UNIQUE(shop_id, comment_id)
);

-- Index cho query performance
CREATE INDEX idx_reviews_shop_id ON apishopee_reviews(shop_id);
CREATE INDEX idx_reviews_create_time ON apishopee_reviews(create_time DESC);
CREATE INDEX idx_reviews_rating ON apishopee_reviews(rating_star);
CREATE INDEX idx_reviews_item_id ON apishopee_reviews(item_id);
CREATE INDEX idx_reviews_shop_create_time ON apishopee_reviews(shop_id, create_time DESC);

-- =====================================================
-- 2. Bảng theo dõi trạng thái sync reviews
-- =====================================================
CREATE TABLE IF NOT EXISTS apishopee_reviews_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  shop_id BIGINT NOT NULL UNIQUE,
  
  -- Sync status
  is_syncing BOOLEAN DEFAULT false,
  is_initial_sync_done BOOLEAN DEFAULT false,
  
  -- Timestamps
  last_sync_at TIMESTAMPTZ,
  last_sync_create_time BIGINT, -- create_time của review mới nhất khi sync
  
  -- Progress tracking
  total_synced INT DEFAULT 0,
  last_batch_count INT DEFAULT 0,
  
  -- Error tracking
  last_error TEXT,
  error_count INT DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_sync_shop ON apishopee_reviews_sync_status(shop_id);

-- =====================================================
-- 3. Enable RLS
-- =====================================================
ALTER TABLE apishopee_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_reviews_sync_status ENABLE ROW LEVEL SECURITY;

-- Policy: User có thể xem reviews của shop mà họ là member
CREATE POLICY "Users can view reviews of their shops" ON apishopee_reviews
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      WHERE s.shop_id = apishopee_reviews.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- Policy: Service role có full access (cho edge functions)
CREATE POLICY "Service role has full access to reviews" ON apishopee_reviews
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to sync status" ON apishopee_reviews_sync_status
  FOR ALL
  USING (auth.role() = 'service_role');

-- Policy: Users can view sync status of their shops
CREATE POLICY "Users can view sync status of their shops" ON apishopee_reviews_sync_status
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM apishopee_shop_members sm
      JOIN apishopee_shops s ON s.id = sm.shop_id
      WHERE s.shop_id = apishopee_reviews_sync_status.shop_id
      AND sm.profile_id = auth.uid()
      AND sm.is_active = true
    )
  );

-- =====================================================
-- 4. Trigger update updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_reviews_updated_at
  BEFORE UPDATE ON apishopee_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_reviews_updated_at();

CREATE TRIGGER trigger_reviews_sync_updated_at
  BEFORE UPDATE ON apishopee_reviews_sync_status
  FOR EACH ROW
  EXECUTE FUNCTION update_reviews_updated_at();

-- =====================================================
-- 5. Comments
-- =====================================================
COMMENT ON TABLE apishopee_reviews IS 'Lưu trữ đánh giá sản phẩm từ Shopee API';
COMMENT ON TABLE apishopee_reviews_sync_status IS 'Theo dõi trạng thái sync reviews cho mỗi shop';
COMMENT ON COLUMN apishopee_reviews_sync_status.is_initial_sync_done IS 'True nếu đã hoàn thành initial load toàn bộ reviews';
COMMENT ON COLUMN apishopee_reviews_sync_status.last_sync_create_time IS 'create_time của review mới nhất, dùng để xác định điểm dừng khi periodic sync';
