-- =============================================
-- Migration: Create Ads Budget Scheduler Cron Job
-- Description: Tạo cron job chạy mỗi 30 phút để kiểm tra và thực thi các schedule ngân sách ADS
-- =============================================

-- Enable pg_cron extension if not exists
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Xóa cron job cũ nếu tồn tại
SELECT cron.unschedule('ads-budget-scheduler')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'ads-budget-scheduler'
);

-- Tạo cron job mới chạy mỗi 30 phút (phút 0 và 30)
-- Gọi Edge Function shopee-ads-scheduler với action 'process'
SELECT cron.schedule(
  'ads-budget-scheduler',
  '0,30 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/shopee-ads-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
    ),
    body := '{"action": "process"}'::jsonb
  );
  $$
);

-- Comment
COMMENT ON EXTENSION pg_cron IS 'Job scheduler for PostgreSQL - used for ads budget scheduler';
