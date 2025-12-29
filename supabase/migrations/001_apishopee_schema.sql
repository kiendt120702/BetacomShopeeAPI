-- ============================================
-- Shopee API Management Schema
-- Prefix: apishopee_
-- Uses sys_profiles from existing schema
-- ============================================

-- ============================================
-- 1. ROLES TABLE - Quyền trong hệ thống Shopee
-- ============================================
CREATE TABLE IF NOT EXISTS public.apishopee_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  level integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT apishopee_roles_pkey PRIMARY KEY (id)
);

-- Insert default roles
INSERT INTO public.apishopee_roles (name, display_name, description, level) VALUES
  ('super_admin', 'Super Admin', 'Toàn quyền hệ thống', 100),
  ('admin', 'Admin', 'Quản trị viên', 80),
  ('manager', 'Manager', 'Quản lý shop', 60),
  ('member', 'Member', 'Thành viên', 20)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- 2. PARTNER ACCOUNTS - Tài khoản Partner Shopee
-- ============================================
CREATE TABLE IF NOT EXISTS public.apishopee_partner_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id bigint NOT NULL UNIQUE,
  partner_key text NOT NULL,
  partner_name text,
  description text,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES public.sys_profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT apishopee_partner_accounts_pkey PRIMARY KEY (id)
);

-- ============================================
-- 3. SHOPS TABLE - Thông tin Shop Shopee
-- ============================================
CREATE TABLE IF NOT EXISTS public.apishopee_shops (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id bigint NOT NULL UNIQUE,
  shop_name text,
  region text DEFAULT 'VN',
  shop_logo text,
  partner_account_id uuid REFERENCES public.apishopee_partner_accounts(id),
  
  -- Token info (encrypted in production)
  access_token text,
  refresh_token text,
  token_expired_at bigint,
  token_updated_at timestamp with time zone,
  
  -- Merchant info (for main account)
  merchant_id bigint,
  
  -- Status
  is_active boolean DEFAULT true,
  
  -- Timestamps
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT apishopee_shops_pkey PRIMARY KEY (id)
);

-- ============================================
-- 4. SHOP MEMBERS - Thành viên của Shop
-- ============================================
CREATE TABLE IF NOT EXISTS public.apishopee_shop_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.sys_profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.apishopee_roles(id),
  
  -- Status
  is_active boolean DEFAULT true,
  
  -- Timestamps
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT apishopee_shop_members_pkey PRIMARY KEY (id),
  CONSTRAINT apishopee_shop_members_unique UNIQUE (shop_id, profile_id)
);

-- ============================================
-- 5. FLASH SALES - Thông tin Flash Sale
-- ============================================
CREATE TABLE IF NOT EXISTS public.apishopee_flash_sales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  flash_sale_id bigint NOT NULL,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone NOT NULL,
  status text DEFAULT 'upcoming',
  
  -- Metadata from Shopee API
  raw_data jsonb,
  
  -- Timestamps
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT apishopee_flash_sales_pkey PRIMARY KEY (id),
  CONSTRAINT apishopee_flash_sales_unique UNIQUE (shop_id, flash_sale_id)
);

-- ============================================
-- 6. FLASH SALE ITEMS - Sản phẩm trong Flash Sale
-- ============================================
CREATE TABLE IF NOT EXISTS public.apishopee_flash_sale_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  flash_sale_id uuid NOT NULL REFERENCES public.apishopee_flash_sales(id) ON DELETE CASCADE,
  item_id bigint NOT NULL,
  model_id bigint,
  item_name text,
  original_price bigint,
  promo_price bigint,
  stock integer,
  
  -- Status
  status text DEFAULT 'active',
  
  -- Timestamps
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT apishopee_flash_sale_items_pkey PRIMARY KEY (id)
);

-- ============================================
-- 7. ADS CAMPAIGNS - Chiến dịch quảng cáo
-- ============================================
CREATE TABLE IF NOT EXISTS public.apishopee_ads_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  campaign_id bigint NOT NULL,
  campaign_name text,
  campaign_type text,
  status text,
  daily_budget bigint,
  total_budget bigint,
  
  -- Date range
  start_date date,
  end_date date,
  
  -- Metadata
  raw_data jsonb,
  
  -- Timestamps
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT apishopee_ads_campaigns_pkey PRIMARY KEY (id),
  CONSTRAINT apishopee_ads_campaigns_unique UNIQUE (shop_id, campaign_id)
);

-- ============================================
-- 8. ADS SCHEDULES - Lịch điều chỉnh ngân sách
-- ============================================
CREATE TABLE IF NOT EXISTS public.apishopee_ads_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.apishopee_shops(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.apishopee_ads_campaigns(id),
  
  -- Schedule info
  schedule_type text NOT NULL DEFAULT 'one_time', -- 'one_time', 'daily', 'weekly'
  scheduled_at timestamp with time zone,
  
  -- Budget adjustment
  new_budget bigint,
  action text DEFAULT 'update', -- 'update', 'pause', 'resume'
  
  -- Status
  status text DEFAULT 'pending', -- 'pending', 'executed', 'failed', 'cancelled'
  executed_at timestamp with time zone,
  error_message text,
  
  -- Who created
  created_by uuid REFERENCES public.sys_profiles(id),
  
  -- Timestamps
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT apishopee_ads_schedules_pkey PRIMARY KEY (id)
);

-- ============================================
-- 9. TOKEN REFRESH LOGS - Log refresh token
-- ============================================
CREATE TABLE IF NOT EXISTS public.apishopee_token_refresh_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES public.apishopee_shops(id) ON DELETE SET NULL,
  shopee_shop_id bigint,
  
  -- Result
  success boolean NOT NULL,
  error_message text,
  
  -- Token info
  old_token_expired_at bigint,
  new_token_expired_at bigint,
  
  -- Context
  refresh_source text DEFAULT 'auto', -- 'auto', 'manual', 'api'
  
  -- Timestamps
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT apishopee_token_refresh_logs_pkey PRIMARY KEY (id)
);

-- ============================================
-- 10. ACTIVITY LOGS - Log hoạt động
-- ============================================
CREATE TABLE IF NOT EXISTS public.apishopee_activity_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.sys_profiles(id),
  shop_id uuid REFERENCES public.apishopee_shops(id) ON DELETE SET NULL,
  
  -- Activity info
  action text NOT NULL,
  entity_type text, -- 'shop', 'flash_sale', 'ads', etc.
  entity_id text,
  
  -- Details
  details jsonb,
  ip_address text,
  user_agent text,
  
  -- Timestamps
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT apishopee_activity_logs_pkey PRIMARY KEY (id)
);

-- ============================================
-- INDEXES
-- ============================================

-- Shop members
CREATE INDEX IF NOT EXISTS idx_apishopee_shop_members_shop ON public.apishopee_shop_members(shop_id);
CREATE INDEX IF NOT EXISTS idx_apishopee_shop_members_profile ON public.apishopee_shop_members(profile_id);

-- Flash sales
CREATE INDEX IF NOT EXISTS idx_apishopee_flash_sales_shop ON public.apishopee_flash_sales(shop_id);
CREATE INDEX IF NOT EXISTS idx_apishopee_flash_sales_time ON public.apishopee_flash_sales(start_time, end_time);

-- Ads campaigns
CREATE INDEX IF NOT EXISTS idx_apishopee_ads_campaigns_shop ON public.apishopee_ads_campaigns(shop_id);

-- Ads schedules
CREATE INDEX IF NOT EXISTS idx_apishopee_ads_schedules_shop ON public.apishopee_ads_schedules(shop_id);
CREATE INDEX IF NOT EXISTS idx_apishopee_ads_schedules_status ON public.apishopee_ads_schedules(status, scheduled_at);

-- Token refresh logs
CREATE INDEX IF NOT EXISTS idx_apishopee_token_refresh_logs_shop ON public.apishopee_token_refresh_logs(shop_id);
CREATE INDEX IF NOT EXISTS idx_apishopee_token_refresh_logs_created ON public.apishopee_token_refresh_logs(created_at DESC);

-- Activity logs
CREATE INDEX IF NOT EXISTS idx_apishopee_activity_logs_profile ON public.apishopee_activity_logs(profile_id);
CREATE INDEX IF NOT EXISTS idx_apishopee_activity_logs_shop ON public.apishopee_activity_logs(shop_id);
CREATE INDEX IF NOT EXISTS idx_apishopee_activity_logs_created ON public.apishopee_activity_logs(created_at DESC);

-- ============================================
-- ENABLE RLS
-- ============================================

ALTER TABLE public.apishopee_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_partner_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_shop_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_flash_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_flash_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_ads_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_ads_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_token_refresh_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apishopee_activity_logs ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================

-- Roles: Everyone can read
CREATE POLICY "apishopee_roles_select" ON public.apishopee_roles
  FOR SELECT USING (true);

-- Shops: Members can see their shops
CREATE POLICY "apishopee_shops_select" ON public.apishopee_shops
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_shops.id
        AND sm.profile_id = auth.uid()
        AND sm.is_active = true
    )
  );

-- Shop members: Can see members of their shops
CREATE POLICY "apishopee_shop_members_select" ON public.apishopee_shop_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_shop_members.shop_id
        AND sm.profile_id = auth.uid()
        AND sm.is_active = true
    )
  );

-- Flash sales: Members can see their shop's flash sales
CREATE POLICY "apishopee_flash_sales_select" ON public.apishopee_flash_sales
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_flash_sales.shop_id
        AND sm.profile_id = auth.uid()
        AND sm.is_active = true
    )
  );

-- Flash sale items: Same as flash sales
CREATE POLICY "apishopee_flash_sale_items_select" ON public.apishopee_flash_sale_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_flash_sales fs
      JOIN public.apishopee_shop_members sm ON sm.shop_id = fs.shop_id
      WHERE fs.id = apishopee_flash_sale_items.flash_sale_id
        AND sm.profile_id = auth.uid()
        AND sm.is_active = true
    )
  );

-- Ads campaigns: Members can see their shop's campaigns
CREATE POLICY "apishopee_ads_campaigns_select" ON public.apishopee_ads_campaigns
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_ads_campaigns.shop_id
        AND sm.profile_id = auth.uid()
        AND sm.is_active = true
    )
  );

-- Ads schedules: Same as campaigns
CREATE POLICY "apishopee_ads_schedules_select" ON public.apishopee_ads_schedules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_ads_schedules.shop_id
        AND sm.profile_id = auth.uid()
        AND sm.is_active = true
    )
  );

-- Token refresh logs: Members can see their shop's logs
CREATE POLICY "apishopee_token_refresh_logs_select" ON public.apishopee_token_refresh_logs
  FOR SELECT USING (
    shop_id IS NULL OR EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_token_refresh_logs.shop_id
        AND sm.profile_id = auth.uid()
        AND sm.is_active = true
    )
  );

-- Activity logs: Users can see their own logs
CREATE POLICY "apishopee_activity_logs_select" ON public.apishopee_activity_logs
  FOR SELECT USING (
    profile_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      WHERE sm.shop_id = apishopee_activity_logs.shop_id
        AND sm.profile_id = auth.uid()
        AND sm.is_active = true
    )
  );

-- Partner accounts: Only admin can see
CREATE POLICY "apishopee_partner_accounts_select" ON public.apishopee_partner_accounts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.apishopee_shop_members sm
      JOIN public.apishopee_roles r ON r.id = sm.role_id
      WHERE sm.profile_id = auth.uid()
        AND sm.is_active = true
        AND r.level >= 80
    )
  );
