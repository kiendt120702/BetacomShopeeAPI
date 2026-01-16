-- Migration: Create cron job for reviews sync
-- Tự động sync đánh giá từ Shopee mỗi 30 phút

-- =====================================================
-- 1. Tạo function để sync reviews cho tất cả shops
-- =====================================================
CREATE OR REPLACE FUNCTION sync_all_shops_reviews()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  shop_record RECORD;
  result JSONB;
BEGIN
  -- Lấy tất cả shops đang active
  FOR shop_record IN 
    SELECT s.shop_id 
    FROM apishopee_shops s
    WHERE s.access_token IS NOT NULL 
      AND s.status = 'active'
  LOOP
    BEGIN
      -- Gọi Edge Function để sync reviews cho từng shop
      SELECT net.http_post(
        url := 'https://ohlwhhxhgpotlwfgqhhu.supabase.co/functions/v1/apishopee-reviews-sync',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object(
          'action', 'sync',
          'shop_id', shop_record.shop_id
        ),
        timeout_milliseconds := 120000  -- 2 phút timeout cho mỗi shop
      ) INTO result;
      
      RAISE NOTICE 'Synced reviews for shop %: %', shop_record.shop_id, result;
      
      -- Đợi 2 giây giữa các shop để tránh rate limit
      PERFORM pg_sleep(2);
      
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to sync reviews for shop %: %', shop_record.shop_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- =====================================================
-- 2. Xóa cron job cũ nếu tồn tại
-- =====================================================
SELECT cron.unschedule('reviews-sync-job') 
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reviews-sync-job');

-- =====================================================
-- 3. Tạo cron job sync reviews mỗi 30 phút
-- =====================================================
SELECT cron.schedule(
  'reviews-sync-job',
  '5,35 * * * *',  -- Mỗi 30 phút (phút 5 và 35 để tránh trùng với các job khác)
  'SELECT sync_all_shops_reviews();'
);

-- =====================================================
-- 4. Comments
-- =====================================================
COMMENT ON FUNCTION sync_all_shops_reviews() IS 'Sync reviews từ Shopee API cho tất cả shops active';
