-- Migration: Add apishopee tables only (NO changes to existing tables)
-- Run this in Supabase SQL Editor

-- =====================================================
-- 1. CREATE apishopee_roles table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  permissions jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_roles_pkey PRIMARY KEY (id)
);

-- Insert default apishopee roles
INSERT INTO public.apishopee_roles (name, display_name, description)
VALUES 
  ('admin', 'Admin', 'Shop administrator with full access'),
  ('manager', 'Manager', 'Shop manager with limited admin access'),
  ('member', 'Member', 'Basic shop member')
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- 2. CREATE apishopee_shops table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_shops (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id bigint NOT NULL UNIQUE,
  shop_name text,
  region text DEFAULT 'VN'::text,
  access_token text,
  refresh_token text,
  expire_in integer DEFAULT 14400,
  expired_at bigint,
  merchant_id bigint,
  token_updated_at timestamp with time zone,
  status text,
  shop_logo text,
  description text,
  is_cb boolean DEFAULT false,
  is_sip boolean DEFAULT false,
  is_upgraded_cbsc boolean DEFAULT false,
  shop_fulfillment_flag text,
  is_main_shop boolean DEFAULT false,
  is_direct_shop boolean DEFAULT false,
  linked_main_shop_id bigint,
  linked_direct_shop_list jsonb,
  sip_affi_shops jsonb,
  is_one_awb boolean,
  is_mart_shop boolean,
  is_outlet_shop boolean,
  auth_time bigint,
  expire_time bigint,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  partner_id bigint,
  partner_key text,
  partner_name text,
  partner_created_by uuid,
  CONSTRAINT apishopee_shops_pkey PRIMARY KEY (id),
  CONSTRAINT shops_partner_created_by_fkey FOREIGN KEY (partner_created_by) REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_apishopee_shops_shop_id ON public.apishopee_shops(shop_id);

-- =====================================================
-- 3. CREATE apishopee_shop_members table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_shop_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  role_id uuid NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_shop_members_pkey PRIMARY KEY (id),
  CONSTRAINT apishopee_shop_members_unique UNIQUE (shop_id, profile_id),
  CONSTRAINT shop_members_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  CONSTRAINT shop_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.sys_profiles(id) ON DELETE CASCADE,
  CONSTRAINT shop_members_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.apishopee_roles(id)
);

CREATE INDEX IF NOT EXISTS idx_apishopee_shop_members_profile ON public.apishopee_shop_members(profile_id);
CREATE INDEX IF NOT EXISTS idx_apishopee_shop_members_shop ON public.apishopee_shop_members(shop_id);

-- =====================================================
-- 4. CREATE apishopee_ads_campaign_data table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_ads_campaign_data (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  user_id uuid,
  campaign_id bigint NOT NULL,
  ad_type text,
  name text,
  status text,
  campaign_placement text,
  bidding_method text,
  campaign_budget numeric DEFAULT 0,
  start_time bigint,
  end_time bigint,
  item_count integer DEFAULT 0,
  roas_target numeric,
  raw_response jsonb,
  synced_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_ads_campaign_data_pkey PRIMARY KEY (id),
  CONSTRAINT ads_campaign_data_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  CONSTRAINT ads_campaign_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_campaign_unique ON public.apishopee_ads_campaign_data(shop_id, campaign_id);

-- =====================================================
-- 5. CREATE apishopee_scheduled_ads_budget table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_scheduled_ads_budget (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  campaign_id bigint NOT NULL,
  campaign_name text,
  ad_type text NOT NULL CHECK (ad_type = ANY (ARRAY['auto'::text, 'manual'::text])),
  hour_start integer NOT NULL CHECK (hour_start >= 0 AND hour_start <= 23),
  hour_end integer NOT NULL CHECK (hour_end >= 0 AND hour_end <= 24),
  budget numeric NOT NULL,
  days_of_week integer[] DEFAULT ARRAY[]::integer[],
  specific_dates text[] DEFAULT ARRAY[]::text[],
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_scheduled_ads_budget_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_ads_budget_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.apishopee_shops(id) ON DELETE CASCADE
);

-- =====================================================
-- 6. CREATE apishopee_ads_budget_logs table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_ads_budget_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  campaign_id bigint NOT NULL,
  schedule_id uuid,
  old_budget numeric,
  new_budget numeric NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['success'::text, 'failed'::text, 'skipped'::text])),
  error_message text,
  executed_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_ads_budget_logs_pkey PRIMARY KEY (id),
  CONSTRAINT ads_budget_logs_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  CONSTRAINT ads_budget_logs_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.apishopee_scheduled_ads_budget(id) ON DELETE SET NULL
);

-- =====================================================
-- 7. CREATE apishopee_flash_sale_data table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_flash_sale_data (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  user_id uuid NOT NULL,
  flash_sale_id bigint NOT NULL,
  timeslot_id bigint,
  status integer,
  start_time bigint,
  end_time bigint,
  enabled_item_count integer DEFAULT 0,
  item_count integer DEFAULT 0,
  type integer,
  remindme_count integer DEFAULT 0,
  click_count integer DEFAULT 0,
  raw_response jsonb,
  synced_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_flash_sale_data_pkey PRIMARY KEY (id),
  CONSTRAINT flash_sale_data_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  CONSTRAINT flash_sale_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_flash_sale_unique ON public.apishopee_flash_sale_data(shop_id, flash_sale_id);

-- =====================================================
-- 8. CREATE apishopee_scheduled_flash_sales table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_scheduled_flash_sales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  source_flash_sale_id bigint NOT NULL,
  target_timeslot_id bigint NOT NULL,
  target_start_time bigint NOT NULL,
  target_end_time bigint,
  scheduled_at timestamp with time zone NOT NULL,
  items_data jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  result_flash_sale_id bigint,
  result_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_scheduled_flash_sales_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_flash_sales_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.apishopee_shops(id) ON DELETE CASCADE
);

-- =====================================================
-- 9. CREATE apishopee_scheduler_logs table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_scheduler_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  schedule_id uuid,
  shop_id uuid NOT NULL,
  log_type text NOT NULL CHECK (log_type = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'success'::text])),
  message text NOT NULL,
  details jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_scheduler_logs_pkey PRIMARY KEY (id),
  CONSTRAINT scheduler_logs_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  CONSTRAINT scheduler_logs_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.apishopee_scheduled_flash_sales(id) ON DELETE SET NULL
);

-- =====================================================
-- 10. CREATE apishopee_sync_status table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_sync_status (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  campaigns_synced_at timestamp with time zone,
  flash_sales_synced_at timestamp with time zone,
  shop_performance_synced_at timestamp with time zone,
  orders_synced_at timestamp with time zone,
  products_synced_at timestamp with time zone,
  is_syncing boolean DEFAULT false,
  last_sync_error text,
  auto_sync_enabled boolean DEFAULT true,
  sync_interval_minutes integer DEFAULT 5,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_sync_status_pkey PRIMARY KEY (id),
  CONSTRAINT sync_status_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  CONSTRAINT sync_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- =====================================================
-- 11. CREATE apishopee_sync_jobs table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_sync_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  user_id uuid NOT NULL,
  job_type text NOT NULL,
  status text DEFAULT 'pending'::text,
  priority integer DEFAULT 5,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  next_run_at timestamp with time zone,
  processed_items integer DEFAULT 0,
  total_items integer DEFAULT 0,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_sync_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT sync_jobs_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  CONSTRAINT sync_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- =====================================================
-- 12. CREATE apishopee_token_refresh_logs table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.apishopee_token_refresh_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid,
  shopee_shop_id bigint,
  success boolean NOT NULL DEFAULT false,
  error_message text,
  old_token_expired_at bigint,
  new_token_expired_at bigint,
  refresh_source text DEFAULT 'auto'::text CHECK (refresh_source = ANY (ARRAY['auto'::text, 'manual'::text, 'api'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apishopee_token_refresh_logs_pkey PRIMARY KEY (id),
  CONSTRAINT token_refresh_logs_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.apishopee_shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_refresh_logs_shop ON public.apishopee_token_refresh_logs(shop_id);
CREATE INDEX IF NOT EXISTS idx_token_refresh_logs_created ON public.apishopee_token_refresh_logs(created_at DESC);

-- =====================================================
-- 13. Enable RLS on all new tables
-- =====================================================

ALTER TABLE public.apishopee_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_shop_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_ads_campaign_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_scheduled_ads_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_ads_budget_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_flash_sale_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_scheduled_flash_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_scheduler_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_sync_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_token_refresh_logs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 14. Create RLS policies
-- =====================================================

-- Roles: public read
DROP POLICY IF EXISTS "apishopee_roles_select" ON public.apishopee_roles;
CREATE POLICY "apishopee_roles_select" ON public.apishopee_roles 
  FOR SELECT USING (true);

-- Shops: members can view their shops
DROP POLICY IF EXISTS "apishopee_shops_select" ON public.apishopee_shops;
CREATE POLICY "apishopee_shops_select" ON public.apishopee_shops 
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members 
      WHERE shop_id = apishopee_shops.id 
      AND profile_id = auth.uid()
      AND is_active = true
    )
  );

-- Shop members: can view own memberships
DROP POLICY IF EXISTS "apishopee_shop_members_select" ON public.apishopee_shop_members;
CREATE POLICY "apishopee_shop_members_select" ON public.apishopee_shop_members 
  FOR SELECT USING (profile_id = auth.uid());

-- Service role bypass for Edge Functions
DROP POLICY IF EXISTS "service_role_all_apishopee_shops" ON public.apishopee_shops;
CREATE POLICY "service_role_all_apishopee_shops" ON public.apishopee_shops 
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_all_apishopee_shop_members" ON public.apishopee_shop_members;
CREATE POLICY "service_role_all_apishopee_shop_members" ON public.apishopee_shop_members 
  FOR ALL USING (auth.role() = 'service_role');

-- Grant permissions
GRANT SELECT ON public.apishopee_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.apishopee_shops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apishopee_shop_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.apishopee_ads_campaign_data TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apishopee_scheduled_ads_budget TO authenticated;
GRANT SELECT, INSERT ON public.apishopee_ads_budget_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.apishopee_flash_sale_data TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apishopee_scheduled_flash_sales TO authenticated;
GRANT SELECT, INSERT ON public.apishopee_scheduler_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.apishopee_sync_status TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.apishopee_sync_jobs TO authenticated;
GRANT SELECT, INSERT ON public.apishopee_token_refresh_logs TO authenticated;

-- Done!
SELECT 'Migration completed - Only new apishopee tables created!' as status;
