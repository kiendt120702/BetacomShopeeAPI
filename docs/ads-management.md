# Hướng dẫn Chi tiết: Chức năng Quản lý Ads (Quảng cáo Shopee)

## Mục lục

1. [Tổng quan Kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Database Design](#2-database-design)
3. [Shopee API Endpoints](#3-shopee-api-endpoints)
4. [Backend Edge Functions](#4-backend-edge-functions)
5. [Client Libraries](#5-client-libraries)
6. [UI Components](#6-ui-components)
7. [Luồng hoạt động](#7-luồng-hoạt-động)
8. [Hướng dẫn triển khai](#8-hướng-dẫn-triển-khai)

---

## 1. Tổng quan Kiến trúc

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                                │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │   AdsPanel.tsx  │    │AdsPerformance   │    │   ads-client.ts         │  │
│  │   (Quản lý)     │    │   Panel.tsx     │    │   ads-scheduler-client  │  │
│  └────────┬────────┘    └────────┬────────┘    └───────────┬─────────────┘  │
│           │                      │                         │                 │
│           └──────────────────────┴─────────────────────────┘                 │
│                                  │                                           │
│                    supabase.functions.invoke()                               │
└──────────────────────────────────┼───────────────────────────────────────────┘
                                   │
┌──────────────────────────────────┼───────────────────────────────────────────┐
│                         SUPABASE EDGE FUNCTIONS                              │
│  ┌─────────────────────────┐    ┌─────────────────────────────────────────┐ │
│  │      shopee-ads         │    │       shopee-ads-scheduler              │ │
│  │   (Campaign CRUD)       │    │       (Auto Budget Adjustment)          │ │
│  └───────────┬─────────────┘    └──────────────────┬──────────────────────┘ │
└──────────────┼─────────────────────────────────────┼────────────────────────┘
               │                                     │
               └─────────────────┬───────────────────┘
                                 │
┌────────────────────────────────┼────────────────────────────────────────────┐
│                            SHOPEE PARTNER API                                │
│  /api/v2/ads/get_product_level_campaign_id_list                             │
│  /api/v2/ads/get_product_level_campaign_setting_info                        │
│  /api/v2/ads/edit_manual_product_ads                                        │
│  /api/v2/ads/edit_auto_product_ads                                          │
│  /api/v2/ads/get_all_cpc_ads_hourly_performance                             │
│  /api/v2/ads/get_all_cpc_ads_daily_performance                              │
└─────────────────────────────────────────────────────────────────────────────┘
```


---

## 2. Database Design

### 2.1 Bảng `apishopee_ads_campaign_data` - Cache thông tin Campaigns

```sql
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

-- Indexes
CREATE INDEX idx_ads_campaign_data_shop_id ON apishopee_ads_campaign_data(shop_id);
CREATE INDEX idx_ads_campaign_data_status ON apishopee_ads_campaign_data(status);
CREATE INDEX idx_ads_campaign_data_cached_at ON apishopee_ads_campaign_data(cached_at);
```

### 2.2 Bảng `apishopee_scheduled_ads_budget` - Cấu hình lịch ngân sách

```sql
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

-- Indexes
CREATE INDEX idx_scheduled_ads_budget_shop ON apishopee_scheduled_ads_budget(shop_id);
CREATE INDEX idx_scheduled_ads_budget_active ON apishopee_scheduled_ads_budget(is_active, hour_start);
CREATE INDEX idx_scheduled_ads_budget_campaign ON apishopee_scheduled_ads_budget(campaign_id);
```

### 2.3 Bảng `apishopee_ads_budget_logs` - Lịch sử thay đổi ngân sách

```sql
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

-- Indexes
CREATE INDEX idx_ads_budget_logs_shop ON apishopee_ads_budget_logs(shop_id, executed_at DESC);
CREATE INDEX idx_ads_budget_logs_campaign ON apishopee_ads_budget_logs(campaign_id, executed_at DESC);
CREATE INDEX idx_ads_budget_logs_status ON apishopee_ads_budget_logs(status);
```

### 2.4 RLS Policies

```sql
-- Enable RLS
ALTER TABLE apishopee_ads_campaign_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_scheduled_ads_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE apishopee_ads_budget_logs ENABLE ROW LEVEL SECURITY;

-- Policy cho authenticated users
CREATE POLICY "Users can view own ads data" ON apishopee_ads_campaign_data
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_ads_campaign_data.shop_id 
      AND apishopee_shops.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own schedules" ON apishopee_scheduled_ads_budget
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM apishopee_shops 
      WHERE apishopee_shops.shop_id = apishopee_scheduled_ads_budget.shop_id 
      AND apishopee_shops.user_id = auth.uid()
    )
  );

-- Service role full access (cho Edge Functions)
CREATE POLICY "Service role full access" ON apishopee_ads_campaign_data
  FOR ALL USING (true) WITH CHECK (true);
```

---

## 3. Shopee API Endpoints

### 3.1 Lấy danh sách Campaign IDs

**Endpoint:** `GET /api/v2/ads/get_product_level_campaign_id_list`

**Parameters:**
| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `partner_id` | int | ✓ | Partner ID |
| `shop_id` | int | ✓ | Shop ID |
| `access_token` | string | ✓ | Access token |
| `timestamp` | int | ✓ | Unix timestamp |
| `sign` | string | ✓ | HMAC-SHA256 signature |
| `ad_type` | string | | 'auto', 'manual', 'all', '' (default: all) |
| `offset` | int | | Offset for pagination (default: 0) |
| `limit` | int | | Limit (default: 5000, max: 5000) |

**Response:**
```json
{
  "error": "",
  "message": "",
  "request_id": "abc123",
  "response": {
    "shop_id": 123456,
    "region": "VN",
    "has_next_page": false,
    "campaign_list": [
      { "campaign_id": 1001, "ad_type": "auto" },
      { "campaign_id": 1002, "ad_type": "manual" }
    ]
  }
}
```

### 3.2 Lấy thông tin chi tiết Campaign

**Endpoint:** `GET /api/v2/ads/get_product_level_campaign_setting_info`

**Parameters:**
| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `partner_id` | int | ✓ | Partner ID |
| `shop_id` | int | ✓ | Shop ID |
| `access_token` | string | ✓ | Access token |
| `timestamp` | int | ✓ | Unix timestamp |
| `sign` | string | ✓ | HMAC-SHA256 signature |
| `campaign_id_list` | string | ✓ | Comma-separated campaign IDs (max 100) |
| `info_type_list` | string | ✓ | Comma-separated info types |

**Info Types:**
- `1` = Common Info (tên, trạng thái, ngân sách, thời gian)
- `2` = Manual Bidding Info (keywords, enhanced CPC)
- `3` = Auto Bidding Info (ROAS target)
- `4` = Auto Product Ads Info (danh sách sản phẩm)

**Response:**
```json
{
  "error": "",
  "message": "",
  "request_id": "abc123",
  "response": {
    "shop_id": 123456,
    "region": "VN",
    "campaign_list": [
      {
        "campaign_id": 1001,
        "common_info": {
          "ad_type": "auto",
          "ad_name": "Campaign ABC",
          "campaign_status": "ongoing",
          "bidding_method": "auto",
          "campaign_placement": "all",
          "campaign_budget": 500000,
          "campaign_duration": {
            "start_time": 1704067200,
            "end_time": 0
          },
          "item_id_list": [123, 456, 789]
        },
        "auto_bidding_info": {
          "roas_target": 3.5
        }
      }
    ]
  }
}
```

### 3.3 Chỉnh sửa Manual Product Ads

**Endpoint:** `POST /api/v2/ads/edit_manual_product_ads`

**Body Parameters:**
| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `reference_id` | string | ✓ | Unique ID để tránh duplicate |
| `campaign_id` | int | ✓ | Campaign ID cần chỉnh sửa |
| `edit_action` | string | ✓ | Hành động (xem bảng dưới) |
| `budget` | number | | Ngân sách mới (khi action = change_budget) |
| `start_date` | string | | Ngày bắt đầu DD-MM-YYYY |
| `end_date` | string | | Ngày kết thúc DD-MM-YYYY (rỗng = không giới hạn) |
| `roas_target` | number | | ROAS target mới |
| `enhanced_cpc` | boolean | | Bật/tắt Enhanced CPC |
| `discovery_ads_locations` | array | | Vị trí hiển thị Discovery Ads |
| `smart_creative_setting` | string | | 'default', 'on', 'off' |

**Edit Actions:**
| Action | Mô tả |
|--------|-------|
| `start` | Bắt đầu campaign |
| `pause` | Tạm dừng campaign |
| `resume` | Tiếp tục campaign đã tạm dừng |
| `stop` | Dừng hẳn campaign |
| `delete` | Xóa campaign |
| `change_budget` | Thay đổi ngân sách |
| `change_duration` | Thay đổi thời gian |
| `change_roas_target` | Thay đổi ROAS target |
| `change_enhanced_cpc` | Bật/tắt Enhanced CPC |
| `change_location` | Thay đổi vị trí hiển thị |
| `change_smart_creative` | Thay đổi Smart Creative |

### 3.4 Chỉnh sửa Auto Product Ads

**Endpoint:** `POST /api/v2/ads/edit_auto_product_ads`

**Body Parameters:**
| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `reference_id` | string | ✓ | Unique ID để tránh duplicate |
| `campaign_id` | int | ✓ | Campaign ID cần chỉnh sửa |
| `edit_action` | string | ✓ | Hành động (start/pause/resume/stop/delete/change_budget/change_duration) |
| `budget` | number | | Ngân sách mới |
| `start_date` | string | | Ngày bắt đầu DD-MM-YYYY |
| `end_date` | string | | Ngày kết thúc DD-MM-YYYY |

### 3.5 Lấy hiệu suất theo giờ (Shop-level)

**Endpoint:** `GET /api/v2/ads/get_all_cpc_ads_hourly_performance`

**Parameters:**
| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `date` | string | ✓ | Ngày cần xem DD-MM-YYYY |

**Response:**
```json
{
  "response": [
    {
      "hour": 0,
      "impression": 1500,
      "clicks": 45,
      "ctr": 3.0,
      "expense": 25000,
      "direct_order": 2,
      "direct_gmv": 150000,
      "broad_order": 5,
      "broad_gmv": 350000,
      "direct_roas": 6.0,
      "broad_roas": 14.0
    }
  ]
}
```

### 3.6 Lấy hiệu suất theo ngày (Shop-level)

**Endpoint:** `GET /api/v2/ads/get_all_cpc_ads_daily_performance`

**Parameters:**
| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `start_date` | string | ✓ | Ngày bắt đầu DD-MM-YYYY |
| `end_date` | string | ✓ | Ngày kết thúc DD-MM-YYYY |

### 3.7 Lấy hiệu suất Campaign theo ngày

**Endpoint:** `GET /api/v2/ads/get_product_campaign_daily_performance`

**Parameters:**
| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `start_date` | string | ✓ | Ngày bắt đầu DD-MM-YYYY |
| `end_date` | string | ✓ | Ngày kết thúc DD-MM-YYYY |
| `campaign_id_list` | string | ✓ | Comma-separated campaign IDs (max 100) |

### 3.8 Lấy hiệu suất Campaign theo giờ

**Endpoint:** `GET /api/v2/ads/get_product_campaign_hourly_performance`

**Parameters:**
| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `date` | string | ✓ | Ngày cần xem DD-MM-YYYY |
| `campaign_id_list` | string | ✓ | Comma-separated campaign IDs (max 100) |

---

## 4. Backend Edge Functions

### 4.1 shopee-ads/index.ts

```typescript
/**
 * Supabase Edge Function: Shopee Ads
 * File: supabase/functions/shopee-ads/index.ts
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Config
const SHOPEE_BASE_URL = 'https://partner.shopeemobile.com';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Tạo signature cho Shopee API
function createSignature(
  partnerKey: string,
  partnerId: number,
  path: string,
  timestamp: number,
  accessToken = '',
  shopId = 0
): string {
  let baseString = `${partnerId}${path}${timestamp}`;
  if (accessToken) baseString += accessToken;
  if (shopId) baseString += shopId;

  const hmac = createHmac('sha256', partnerKey);
  hmac.update(baseString);
  return hmac.digest('hex');
}

// Lấy partner credentials từ database
async function getPartnerCredentials(supabase, shopId: number) {
  const { data } = await supabase
    .from('apishopee_shops')
    .select('partner_id, partner_key')
    .eq('shop_id', shopId)
    .single();

  return {
    partnerId: data?.partner_id || Number(Deno.env.get('SHOPEE_PARTNER_ID')),
    partnerKey: data?.partner_key || Deno.env.get('SHOPEE_PARTNER_KEY'),
  };
}

// Lấy token với auto-refresh
async function getTokenWithAutoRefresh(supabase, shopId: number) {
  const { data } = await supabase
    .from('apishopee_shops')
    .select('access_token, refresh_token, expired_at')
    .eq('shop_id', shopId)
    .single();

  if (!data?.access_token) {
    throw new Error('Token not found. Please authenticate first.');
  }

  return data;
}

// Gọi Shopee API với auto-retry khi token hết hạn
async function callShopeeAPIWithRetry(
  supabase,
  credentials,
  path: string,
  method: 'GET' | 'POST',
  shopId: number,
  token,
  body?: Record<string, unknown>,
  extraParams?: Record<string, string | number>
) {
  const makeRequest = async (accessToken: string) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = createSignature(
      credentials.partnerKey,
      credentials.partnerId,
      path,
      timestamp,
      accessToken,
      shopId
    );

    const params = new URLSearchParams({
      partner_id: credentials.partnerId.toString(),
      timestamp: timestamp.toString(),
      access_token: accessToken,
      shop_id: shopId.toString(),
      sign: sign,
    });

    if (extraParams) {
      Object.entries(extraParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
    }

    const url = `${SHOPEE_BASE_URL}${path}?${params.toString()}`;
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (method === 'POST' && body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    return await response.json();
  };

  let result = await makeRequest(token.access_token);

  // Auto-refresh token nếu hết hạn
  if (result.error === 'error_auth') {
    const newToken = await refreshAccessToken(credentials, token.refresh_token, shopId);
    if (!newToken.error) {
      await saveToken(supabase, shopId, newToken);
      result = await makeRequest(newToken.access_token);
    }
  }

  return result;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, shop_id, ...params } = body;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const credentials = await getPartnerCredentials(supabase, shop_id);
    const token = await getTokenWithAutoRefresh(supabase, shop_id);

    let result;

    switch (action) {
      case 'get-campaign-id-list':
        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/ads/get_product_level_campaign_id_list',
          'GET',
          shop_id,
          token,
          undefined,
          {
            ad_type: params.ad_type || 'all',
            offset: params.offset ?? 0,
            limit: params.limit ?? 5000,
          }
        );
        break;

      case 'get-campaign-setting-info':
        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/ads/get_product_level_campaign_setting_info',
          'GET',
          shop_id,
          token,
          undefined,
          {
            campaign_id_list: params.campaign_id_list,
            info_type_list: params.info_type_list,
          }
        );
        break;

      case 'edit-manual-product-ads':
        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/ads/edit_manual_product_ads',
          'POST',
          shop_id,
          token,
          {
            reference_id: params.reference_id,
            campaign_id: params.campaign_id,
            edit_action: params.edit_action,
            ...(params.budget !== undefined && { budget: params.budget }),
            ...(params.start_date && { start_date: params.start_date }),
            ...(params.end_date !== undefined && { end_date: params.end_date }),
          }
        );
        break;

      case 'edit-auto-product-ads':
        result = await callShopeeAPIWithRetry(
          supabase,
          credentials,
          '/api/v2/ads/edit_auto_product_ads',
          'POST',
          shop_id,
          token,
          {
            reference_id: params.reference_id,
            campaign_id: params.campaign_id,
            edit_action: params.edit_action,
            ...(params.budget !== undefined && { budget: params.budget }),
          }
        );
        break;

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

### 4.2 shopee-ads-scheduler/index.ts

```typescript
/**
 * Supabase Edge Function: Shopee Ads Budget Scheduler
 * File: supabase/functions/shopee-ads-scheduler/index.ts
 * 
 * Actions:
 * - create: Tạo cấu hình lịch ngân sách mới
 * - update: Cập nhật cấu hình
 * - delete: Xóa cấu hình
 * - list: Xem danh sách cấu hình
 * - logs: Xem lịch sử thay đổi
 * - process: Xử lý điều chỉnh ngân sách (gọi bởi cron mỗi giờ)
 * - run-now: Test chạy ngay một schedule
 */

serve(async (req) => {
  const body = await req.json();
  const { action, shop_id, ...params } = body;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  switch (action) {
    // Tạo cấu hình lịch ngân sách mới
    case 'create': {
      const { campaign_id, campaign_name, ad_type, hour_start, hour_end, budget, days_of_week, specific_dates } = params;

      const { data, error } = await supabase
        .from('apishopee_scheduled_ads_budget')
        .insert({
          shop_id,
          campaign_id,
          campaign_name,
          ad_type,
          hour_start,
          hour_end,
          budget,
          days_of_week: days_of_week || null,
          specific_dates: specific_dates || null,
          is_active: true,
        })
        .select()
        .single();

      return Response.json({ success: !error, schedule: data, error: error?.message });
    }

    // Cập nhật cấu hình
    case 'update': {
      const { schedule_id, ...updateData } = params;

      const { data, error } = await supabase
        .from('apishopee_scheduled_ads_budget')
        .update(updateData)
        .eq('id', schedule_id)
        .eq('shop_id', shop_id)
        .select()
        .single();

      return Response.json({ success: !error, schedule: data, error: error?.message });
    }

    // Xóa cấu hình
    case 'delete': {
      const { error } = await supabase
        .from('apishopee_scheduled_ads_budget')
        .delete()
        .eq('id', params.schedule_id)
        .eq('shop_id', shop_id);

      return Response.json({ success: !error, error: error?.message });
    }

    // Xem danh sách cấu hình
    case 'list': {
      let query = supabase
        .from('apishopee_scheduled_ads_budget')
        .select('*')
        .eq('shop_id', shop_id)
        .order('campaign_id')
        .order('hour_start');

      if (params.campaign_id) {
        query = query.eq('campaign_id', params.campaign_id);
      }

      const { data, error } = await query;
      return Response.json({ success: !error, schedules: data, error: error?.message });
    }

    // Xem lịch sử thay đổi
    case 'logs': {
      const { data, error } = await supabase
        .from('apishopee_ads_budget_logs')
        .select('*')
        .eq('shop_id', shop_id)
        .order('executed_at', { ascending: false })
        .limit(params.limit || 50);

      return Response.json({ success: !error, logs: data, error: error?.message });
    }

    // Xử lý điều chỉnh ngân sách (gọi bởi cron mỗi giờ)
    case 'process': {
      // Chuyển sang timezone Việt Nam (UTC+7)
      const now = new Date();
      const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
      const currentHour = vnTime.getHours();
      const currentDay = vnTime.getDay(); // 0 = Sunday
      const today = vnTime.toISOString().split('T')[0]; // YYYY-MM-DD

      // Lấy tất cả cấu hình active phù hợp với giờ hiện tại
      const { data: schedules } = await supabase
        .from('apishopee_scheduled_ads_budget')
        .select('*')
        .eq('is_active', true)
        .lte('hour_start', currentHour)
        .gt('hour_end', currentHour);

      // Lọc theo ngày trong tuần hoặc ngày cụ thể
      const applicableSchedules = (schedules || []).filter(s => {
        // Nếu có specific_dates, kiểm tra ngày hôm nay
        if (s.specific_dates && s.specific_dates.length > 0) {
          return s.specific_dates.includes(today);
        }
        // Nếu có days_of_week, kiểm tra ngày trong tuần
        if (s.days_of_week && s.days_of_week.length > 0 && s.days_of_week.length < 7) {
          return s.days_of_week.includes(currentDay);
        }
        // Mặc định áp dụng tất cả các ngày
        return true;
      });

      const results = [];

      for (const schedule of applicableSchedules) {
        try {
          const result = await editCampaignBudget(
            supabase,
            schedule.shop_id,
            schedule.campaign_id,
            schedule.ad_type,
            schedule.budget
          );

          // Log kết quả
          await supabase.from('apishopee_ads_budget_logs').insert({
            shop_id: schedule.shop_id,
            campaign_id: schedule.campaign_id,
            campaign_name: schedule.campaign_name,
            schedule_id: schedule.id,
            new_budget: schedule.budget,
            status: result.success ? 'success' : 'failed',
            error_message: result.error,
          });

          results.push({
            schedule_id: schedule.id,
            campaign_id: schedule.campaign_id,
            budget: schedule.budget,
            success: result.success,
            error: result.error,
          });
        } catch (err) {
          // Log lỗi
          await supabase.from('apishopee_ads_budget_logs').insert({
            shop_id: schedule.shop_id,
            campaign_id: schedule.campaign_id,
            schedule_id: schedule.id,
            new_budget: schedule.budget,
            status: 'failed',
            error_message: err.message,
          });

          results.push({
            schedule_id: schedule.id,
            campaign_id: schedule.campaign_id,
            success: false,
            error: err.message,
          });
        }
      }

      return Response.json({
        success: true,
        processed: results.length,
        hour: currentHour,
        day: currentDay,
        results,
      });
    }

    // Test: Chạy ngay cho một schedule cụ thể
    case 'run-now': {
      const { data: schedule } = await supabase
        .from('apishopee_scheduled_ads_budget')
        .select('*')
        .eq('id', params.schedule_id)
        .eq('shop_id', shop_id)
        .single();

      if (!schedule) {
        return Response.json({ success: false, error: 'Schedule not found' });
      }

      const result = await editCampaignBudget(
        supabase,
        shop_id,
        schedule.campaign_id,
        schedule.ad_type,
        schedule.budget
      );

      // Log kết quả
      await supabase.from('apishopee_ads_budget_logs').insert({
        shop_id,
        campaign_id: schedule.campaign_id,
        schedule_id: schedule.id,
        new_budget: schedule.budget,
        status: result.success ? 'success' : 'failed',
        error_message: result.error,
      });

      return Response.json({
        success: result.success,
        error: result.error,
        campaign_id: schedule.campaign_id,
        budget: schedule.budget,
      });
    }
  }
});
```

### 4.3 Cron Job Setup

Để tự động chạy scheduler mỗi giờ, cần setup cron job trong Supabase:

```sql
-- Migration: Setup scheduler cron job
-- File: supabase/migrations/031_setup_scheduler_cron.sql

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Tạo cron job chạy mỗi giờ (phút 0)
SELECT cron.schedule(
  'ads-budget-scheduler',
  '0 * * * *',  -- Mỗi giờ vào phút 0
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/shopee-ads-scheduler',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{"action": "process"}'::jsonb
  );
  $$
);
```

---

## 5. Client Libraries

### 5.1 ads-client.ts

```typescript
/**
 * Shopee Ads API Client
 * File: src/lib/shopee/ads-client.ts
 */

import { supabase } from '../supabase';

// ==================== TYPES ====================

export type AdType = 'auto' | 'manual' | 'all' | '';
export type CampaignStatus = 'ongoing' | 'scheduled' | 'ended' | 'paused' | 'deleted' | 'closed';
export type EditAction = 'start' | 'pause' | 'resume' | 'stop' | 'delete' | 'change_budget' | 'change_duration';

export interface CampaignIdItem {
  ad_type: AdType;
  campaign_id: number;
}

export interface CommonInfo {
  ad_type: AdType;
  ad_name: string;
  campaign_status: CampaignStatus;
  bidding_method: 'auto' | 'manual';
  campaign_placement: 'search' | 'discovery' | 'all';
  campaign_budget: number;
  campaign_duration: {
    start_time: number;
    end_time: number;
  };
  item_id_list: number[];
}

export interface CachedCampaign {
  id: string;
  shop_id: number;
  campaign_id: number;
  ad_type: string;
  name: string | null;
  status: string | null;
  campaign_placement: string | null;
  bidding_method: string | null;
  campaign_budget: number;
  start_time: number | null;
  end_time: number | null;
  item_count: number;
  roas_target: number | null;
  synced_at: string;
}

// ==================== API FUNCTIONS ====================

/**
 * Lấy danh sách campaign IDs
 */
export async function getCampaignIdList(params: {
  shop_id: number;
  ad_type?: AdType;
  offset?: number;
  limit?: number;
}) {
  const { data, error } = await supabase.functions.invoke('shopee-ads', {
    body: {
      action: 'get-campaign-id-list',
      shop_id: params.shop_id,
      ad_type: params.ad_type || 'all',
      offset: params.offset ?? 0,
      limit: params.limit ?? 5000,
    },
  });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Lấy thông tin chi tiết campaign
 */
export async function getCampaignSettingInfo(params: {
  shop_id: number;
  campaign_id_list: number[] | string;
  info_type_list: string;
}) {
  const campaignIdList = Array.isArray(params.campaign_id_list)
    ? params.campaign_id_list.join(',')
    : params.campaign_id_list;

  const { data, error } = await supabase.functions.invoke('shopee-ads', {
    body: {
      action: 'get-campaign-setting-info',
      shop_id: params.shop_id,
      campaign_id_list: campaignIdList,
      info_type_list: params.info_type_list,
    },
  });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Lấy tất cả campaigns với thông tin đầy đủ
 */
export async function getAllCampaignsWithInfo(shopId: number, adType: AdType = 'all') {
  // Step 1: Lấy danh sách campaign IDs
  const idListResponse = await getCampaignIdList({ shop_id: shopId, ad_type: adType });

  if (idListResponse.error || !idListResponse.response?.campaign_list?.length) {
    return null;
  }

  const campaignIds = idListResponse.response.campaign_list.map(c => c.campaign_id);

  // Step 2: Lấy thông tin chi tiết (max 100 campaigns per request)
  const batchSize = 100;
  const allCampaigns = [];

  for (let i = 0; i < campaignIds.length; i += batchSize) {
    const batch = campaignIds.slice(i, i + batchSize);
    
    const settingResponse = await getCampaignSettingInfo({
      shop_id: shopId,
      campaign_id_list: batch,
      info_type_list: '1,3', // CommonInfo + AutoBiddingInfo
    });

    if (settingResponse.response?.campaign_list) {
      allCampaigns.push(...settingResponse.response.campaign_list);
    }
  }

  return allCampaigns;
}

// ==================== EDIT FUNCTIONS ====================

function generateReferenceId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Chỉnh sửa ngân sách chiến dịch
 */
export async function editCampaignBudget(params: {
  shop_id: number;
  campaign_id: number;
  ad_type: 'auto' | 'manual';
  budget: number;
}) {
  const action = params.ad_type === 'manual' ? 'edit-manual-product-ads' : 'edit-auto-product-ads';

  const { data, error } = await supabase.functions.invoke('shopee-ads', {
    body: {
      action,
      shop_id: params.shop_id,
      reference_id: generateReferenceId(),
      campaign_id: params.campaign_id,
      edit_action: 'change_budget',
      budget: params.budget,
    },
  });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Thay đổi trạng thái chiến dịch
 */
export async function editCampaignStatus(params: {
  shop_id: number;
  campaign_id: number;
  ad_type: 'auto' | 'manual';
  action: 'start' | 'pause' | 'resume' | 'stop' | 'delete';
}) {
  const apiAction = params.ad_type === 'manual' ? 'edit-manual-product-ads' : 'edit-auto-product-ads';

  const { data, error } = await supabase.functions.invoke('shopee-ads', {
    body: {
      action: apiAction,
      shop_id: params.shop_id,
      reference_id: generateReferenceId(),
      campaign_id: params.campaign_id,
      edit_action: params.action,
    },
  });

  if (error) throw new Error(error.message);
  return data;
}

// ==================== CACHE FUNCTIONS ====================

/**
 * Lấy campaigns từ cache
 */
export async function getCampaignsFromCache(shopId: number): Promise<CachedCampaign[]> {
  const { data, error } = await supabase
    .from('apishopee_ads_campaign_data')
    .select('*')
    .eq('shop_id', shopId)
    .order('status', { ascending: true });

  if (error) {
    console.error('[getCampaignsFromCache] Error:', error);
    return [];
  }

  return data || [];
}

/**
 * Lưu campaigns vào cache
 */
export async function saveCampaignsToCache(
  shopId: number,
  campaigns: Array<CampaignIdItem & { name?: string; status?: string; common_info?: CommonInfo }>
): Promise<void> {
  if (!campaigns.length) return;

  const cacheData = campaigns.map(c => ({
    shop_id: shopId,
    campaign_id: c.campaign_id,
    ad_type: c.ad_type,
    name: c.name || null,
    status: c.status || null,
    campaign_placement: c.common_info?.campaign_placement || null,
    bidding_method: c.common_info?.bidding_method || null,
    campaign_budget: c.common_info?.campaign_budget || 0,
    start_time: c.common_info?.campaign_duration?.start_time || null,
    end_time: c.common_info?.campaign_duration?.end_time || null,
    item_count: c.common_info?.item_id_list?.length || 0,
    synced_at: new Date().toISOString(),
  }));

  await supabase
    .from('apishopee_ads_campaign_data')
    .upsert(cacheData, { onConflict: 'shop_id,campaign_id' });
}

/**
 * Kiểm tra cache có cần refresh không
 */
export function isCacheStale(cachedAt: string, maxAgeMinutes = 5): boolean {
  const cacheTime = new Date(cachedAt).getTime();
  return (Date.now() - cacheTime) > maxAgeMinutes * 60 * 1000;
}
```

### 5.2 ads-scheduler-client.ts

```typescript
/**
 * Shopee Ads Budget Scheduler Client
 * File: src/lib/shopee/ads-scheduler-client.ts
 */

import { supabase } from '../supabase';

// ==================== TYPES ====================

export interface ScheduledAdsBudget {
  id: string;
  shop_id: number;
  campaign_id: number;
  campaign_name?: string;
  ad_type: 'auto' | 'manual';
  hour_start: number;
  hour_end: number;
  budget: number;
  days_of_week?: number[] | null;
  specific_dates?: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdsBudgetLog {
  id: string;
  shop_id: number;
  campaign_id: number;
  campaign_name?: string;
  schedule_id?: string;
  old_budget?: number;
  new_budget: number;
  status: 'success' | 'failed' | 'skipped';
  error_message?: string;
  executed_at: string;
}

export interface CreateScheduleParams {
  shop_id: number;
  campaign_id: number;
  campaign_name?: string;
  ad_type: 'auto' | 'manual';
  hour_start: number;
  hour_end: number;
  budget: number;
  days_of_week?: number[];
  specific_dates?: string[];
}

// ==================== API FUNCTIONS ====================

/**
 * Tạo cấu hình lịch ngân sách mới
 */
export async function createBudgetSchedule(params: CreateScheduleParams) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'create', ...params },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

/**
 * Cập nhật cấu hình
 */
export async function updateBudgetSchedule(params: {
  shop_id: number;
  schedule_id: string;
  hour_start?: number;
  hour_end?: number;
  budget?: number;
  days_of_week?: number[] | null;
  is_active?: boolean;
}) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'update', ...params },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

/**
 * Xóa cấu hình
 */
export async function deleteBudgetSchedule(shopId: number, scheduleId: string) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'delete', shop_id: shopId, schedule_id: scheduleId },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

/**
 * Lấy danh sách cấu hình
 */
export async function listBudgetSchedules(shopId: number, campaignId?: number) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'list', shop_id: shopId, campaign_id: campaignId },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

/**
 * Lấy lịch sử thay đổi
 */
export async function getBudgetLogs(shopId: number, campaignId?: number, limit = 50) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'logs', shop_id: shopId, campaign_id: campaignId, limit },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

/**
 * Chạy ngay một schedule (test)
 */
export async function runScheduleNow(shopId: number, scheduleId: string) {
  const { data, error } = await supabase.functions.invoke('shopee-ads-scheduler', {
    body: { action: 'run-now', shop_id: shopId, schedule_id: scheduleId },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Format giờ hiển thị
 */
export function formatHourRange(start: number, end: number): string {
  const formatHour = (h: number) => `${h.toString().padStart(2, '0')}:00`;
  return `${formatHour(start)} - ${end === 24 ? '23:59' : formatHour(end)}`;
}

/**
 * Format ngày trong tuần
 */
export function formatDaysOfWeek(days?: number[] | null): string {
  if (!days || days.length === 0 || days.length === 7) return 'Hàng ngày';
  
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  return days.map(d => dayNames[d]).join(', ');
}
```

---

## 6. UI Components

### 6.1 AdsPanel.tsx - Quản lý Campaigns & Lịch ngân sách

```tsx
/**
 * Ads Panel Component
 * File: src/components/panels/AdsPanel.tsx
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useShopeeAuth } from '@/hooks/useShopeeAuth';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCampaignIdList, getCampaignSettingInfo } from '@/lib/shopee';
import { cn } from '@/lib/utils';

// ==================== TYPES ====================

interface CampaignData {
  campaign_id: number;
  ad_type: 'auto' | 'manual';
  name?: string;
  status?: string;
  common_info?: {
    campaign_budget: number;
    campaign_placement: string;
    bidding_method: string;
  };
}

interface BudgetSchedule {
  id: string;
  campaign_id: number;
  campaign_name: string;
  ad_type: string;
  hour_start: number;
  hour_end: number;
  budget: number;
  days_of_week?: number[];
  specific_dates?: string[];
  is_active?: boolean;
}

// ==================== CONSTANTS ====================

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ongoing: { label: 'Đang chạy', color: 'bg-green-100 text-green-700' },
  paused: { label: 'Tạm dừng', color: 'bg-yellow-100 text-yellow-700' },
  scheduled: { label: 'Đã lên lịch', color: 'bg-blue-100 text-blue-700' },
  ended: { label: 'Đã kết thúc', color: 'bg-gray-100 text-gray-700' },
  deleted: { label: 'Đã xóa', color: 'bg-red-100 text-red-700' },
};

const AD_TYPE_MAP: Record<string, { label: string; color: string }> = {
  auto: { label: 'Tự động', color: 'bg-purple-100 text-purple-700' },
  manual: { label: 'Thủ công', color: 'bg-indigo-100 text-indigo-700' },
};

type TabType = 'manage' | 'schedule' | 'saved' | 'history';

// ==================== COMPONENT ====================

export default function AdsPanel() {
  const { toast } = useToast();
  const { token, isAuthenticated } = useShopeeAuth();
  
  // State
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [schedules, setSchedules] = useState<BudgetSchedule[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('manage');
  const [statusFilter, setStatusFilter] = useState<string>('ongoing');
  
  // Schedule creation state
  const [selectedCampaigns, setSelectedCampaigns] = useState<number[]>([]);
  const [bulkHours, setBulkHours] = useState<number[]>([]);
  const [scheduleType, setScheduleType] = useState<'daily' | 'specific'>('daily');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [budgetValue, setBudgetValue] = useState('');

  // Helpers
  const formatPrice = (p: number) => new Intl.NumberFormat('vi-VN').format(p) + 'đ';
  const filteredCampaigns = statusFilter === 'all' 
    ? campaigns 
    : campaigns.filter(c => c.status === statusFilter);

  // ==================== DATA LOADING ====================

  useEffect(() => {
    if (isAuthenticated && token?.shop_id) {
      loadCampaigns();
      loadSchedules();
    }
  }, [isAuthenticated, token?.shop_id]);

  // Load campaigns từ cache
  const loadCampaigns = async () => {
    if (!token?.shop_id) return;
    setLoading(true);
    try {
      const { data: cached } = await supabase
        .from('apishopee_ads_campaign_data')
        .select('*')
        .eq('shop_id', token.shop_id)
        .order('status', { ascending: true });
      
      if (cached && cached.length > 0) {
        setCampaigns(cached.map(c => ({
          campaign_id: c.campaign_id,
          ad_type: c.ad_type as 'auto' | 'manual',
          name: c.name,
          status: c.status,
          common_info: {
            campaign_budget: c.campaign_budget,
            campaign_placement: c.campaign_placement,
            bidding_method: c.bidding_method,
          },
        })));
      }
    } catch (e) {
      console.error('Load campaigns error:', e);
    } finally {
      setLoading(false);
    }
  };

  // Fetch từ Shopee API và lưu cache
  const fetchFromAPI = async () => {
    if (!token?.shop_id) return;
    setLoading(true);
    try {
      // Step 1: Lấy danh sách campaign IDs
      const res = await getCampaignIdList({ shop_id: token.shop_id, ad_type: 'all' });
      if (res.error && res.error !== '-') {
        toast({ title: 'Lỗi', description: res.message, variant: 'destructive' });
        return;
      }
      
      const list = res.response?.campaign_list || [];
      if (!list.length) {
        setCampaigns([]);
        return;
      }

      // Step 2: Lấy chi tiết từng batch 100 campaigns
      const withInfo: CampaignData[] = [...list];
      for (let i = 0; i < list.length; i += 100) {
        const batch = list.slice(i, i + 100);
        const detail = await getCampaignSettingInfo({
          shop_id: token.shop_id,
          campaign_id_list: batch.map(c => c.campaign_id),
          info_type_list: '1,3', // CommonInfo + AutoBiddingInfo
        });
        
        detail.response?.campaign_list?.forEach(d => {
          const idx = withInfo.findIndex(c => c.campaign_id === d.campaign_id);
          if (idx !== -1) {
            withInfo[idx] = {
              ...withInfo[idx],
              name: d.common_info?.ad_name,
              status: d.common_info?.campaign_status,
              common_info: d.common_info,
            };
          }
        });
      }
      
      setCampaigns(withInfo);

      // Step 3: Lưu vào cache
      const cacheData = withInfo.map(c => ({
        shop_id: token.shop_id,
        campaign_id: c.campaign_id,
        ad_type: c.ad_type,
        name: c.name || null,
        status: c.status || null,
        campaign_placement: c.common_info?.campaign_placement || null,
        bidding_method: c.common_info?.bidding_method || null,
        campaign_budget: c.common_info?.campaign_budget || 0,
        synced_at: new Date().toISOString(),
      }));
      
      await supabase
        .from('apishopee_ads_campaign_data')
        .upsert(cacheData, { onConflict: 'shop_id,campaign_id' });

      toast({ title: 'Thành công', description: `Đã tải ${list.length} chiến dịch` });
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Load schedules từ database
  const loadSchedules = async () => {
    if (!token?.shop_id) return;
    const { data } = await supabase
      .from('apishopee_scheduled_ads_budget')
      .select('*')
      .eq('shop_id', token.shop_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    setSchedules(data || []);
  };

  // ==================== SCHEDULE ACTIONS ====================

  const saveBulkSchedule = async () => {
    if (!token?.shop_id || selectedCampaigns.length === 0 || bulkHours.length === 0) return;
    
    const budget = parseFloat(budgetValue.replace(/\./g, ''));
    if (isNaN(budget) || budget < 0) {
      toast({ title: 'Ngân sách không hợp lệ' });
      return;
    }

    try {
      const records = selectedCampaigns.map(cid => {
        const campaign = campaigns.find(c => c.campaign_id === cid);
        return {
          shop_id: token.shop_id,
          campaign_id: cid,
          campaign_name: campaign?.name || '',
          ad_type: campaign?.ad_type || 'auto',
          hour_start: Math.min(...bulkHours),
          hour_end: Math.max(...bulkHours) + 1,
          budget,
          days_of_week: scheduleType === 'daily' ? [0,1,2,3,4,5,6] : [],
          specific_dates: scheduleType === 'specific' ? selectedDates : [],
          is_active: true,
        };
      });

      const { error } = await supabase
        .from('apishopee_scheduled_ads_budget')
        .insert(records);
      
      if (error) throw error;

      toast({ title: 'Thành công', description: `Đã tạo lịch cho ${selectedCampaigns.length} chiến dịch` });
      setShowBulkDialog(false);
      setSelectedCampaigns([]);
      setBulkHours([]);
      setSelectedDates([]);
      loadSchedules();
    } catch (e) {
      toast({ title: 'Lỗi', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!confirm('Xóa lịch này?')) return;
    await supabase.from('apishopee_scheduled_ads_budget').delete().eq('id', id);
    toast({ title: 'Đã xóa' });
    loadSchedules();
  };

  // ==================== RENDER ====================

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      {/* Header với filter và tabs */}
      <div className="bg-white border-b flex-shrink-0">
        {/* Status Filter */}
        <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Trạng thái:</span>
          <button
            onClick={() => setStatusFilter('all')}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium",
              statusFilter === 'all' ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600"
            )}
          >
            Tất cả ({campaigns.length})
          </button>
          {Object.entries(STATUS_MAP).map(([key, { label }]) => {
            const count = campaigns.filter(c => c.status === key).length;
            if (count === 0) return null;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium",
                  statusFilter === key ? "bg-green-500 text-white" : "bg-green-100 text-green-700"
                )}
              >
                {label} ({count})
              </button>
            );
          })}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={fetchFromAPI} disabled={loading}>
            {loading ? 'Đang tải...' : 'Đồng bộ'}
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-4">
          {(['manage', 'schedule', 'saved', 'history'] as TabType[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px",
                activeTab === tab ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500"
              )}
            >
              {tab === 'manage' && 'Quản lý'}
              {tab === 'schedule' && 'Lịch ngân sách'}
              {tab === 'saved' && `Đã lưu (${schedules.length})`}
              {tab === 'history' && 'Lịch sử'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'manage' && (
          <CampaignList
            campaigns={filteredCampaigns}
            loading={loading}
            formatPrice={formatPrice}
          />
        )}

        {activeTab === 'schedule' && (
          <ScheduleBuilder
            campaigns={filteredCampaigns}
            selectedCampaigns={selectedCampaigns}
            setSelectedCampaigns={setSelectedCampaigns}
            bulkHours={bulkHours}
            setBulkHours={setBulkHours}
            scheduleType={scheduleType}
            setScheduleType={setScheduleType}
            selectedDates={selectedDates}
            setSelectedDates={setSelectedDates}
            schedules={schedules}
            onOpenDialog={() => setShowBulkDialog(true)}
          />
        )}

        {activeTab === 'saved' && (
          <SavedSchedules
            schedules={schedules}
            formatPrice={formatPrice}
            onDelete={deleteSchedule}
          />
        )}

        {activeTab === 'history' && (
          <BudgetHistory shopId={token?.shop_id} formatPrice={formatPrice} />
        )}
      </div>

      {/* Bulk Schedule Dialog */}
      <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thiết lập ngân sách cho {selectedCampaigns.length} chiến dịch</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div>
              <p className="text-sm text-gray-600">Khung giờ:</p>
              <p className="font-medium text-orange-600">
                {bulkHours.length > 0 
                  ? `${Math.min(...bulkHours).toString().padStart(2, '0')}:00 - ${(Math.max(...bulkHours) + 1).toString().padStart(2, '0')}:00`
                  : ''}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Ngân sách (VNĐ)</label>
              <Input
                type="text"
                value={budgetValue ? new Intl.NumberFormat('vi-VN').format(Number(budgetValue.replace(/\./g, '')) || 0) : ''}
                onChange={e => {
                  const raw = e.target.value.replace(/\./g, '').replace(/\D/g, '');
                  setBudgetValue(raw);
                }}
                placeholder="Nhập ngân sách"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkDialog(false)}>Hủy</Button>
            <Button onClick={saveBulkSchedule}>Lưu</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

### 6.2 Sub-components cho AdsPanel

```tsx
// ==================== CAMPAIGN LIST ====================

function CampaignList({ campaigns, loading, formatPrice }) {
  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500">Đang tải...</p>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="font-medium">Chưa có chiến dịch</p>
        <p className="text-sm mt-1">Nhấn Đồng bộ để tải</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="grid grid-cols-[1fr_90px_100px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500">
        <div>Tên</div>
        <div>Trạng thái</div>
        <div className="text-right">Ngân sách</div>
      </div>
      <div className="divide-y">
        {campaigns.map(c => (
          <div key={c.campaign_id} className="grid grid-cols-[1fr_90px_100px] gap-2 px-4 py-3 items-center hover:bg-gray-50">
            <div className="min-w-0">
              <p className="font-medium text-sm line-clamp-2">{c.name || 'Campaign ' + c.campaign_id}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn("text-xs px-1.5 py-0.5 rounded", AD_TYPE_MAP[c.ad_type]?.color)}>
                  {AD_TYPE_MAP[c.ad_type]?.label}
                </span>
                <span className="text-xs text-gray-400">ID: {c.campaign_id}</span>
              </div>
            </div>
            <div>
              <span className={cn("text-xs px-2 py-0.5 rounded", STATUS_MAP[c.status || '']?.color)}>
                {STATUS_MAP[c.status || '']?.label || '-'}
              </span>
            </div>
            <div className="text-sm text-right font-medium text-orange-600">
              {c.common_info?.campaign_budget ? formatPrice(c.common_info.campaign_budget) : '-'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== SCHEDULE BUILDER ====================

function ScheduleBuilder({
  campaigns,
  selectedCampaigns,
  setSelectedCampaigns,
  bulkHours,
  setBulkHours,
  scheduleType,
  setScheduleType,
  selectedDates,
  setSelectedDates,
  schedules,
  onOpenDialog,
}) {
  const toggleCampaignSelection = (cid: number) => {
    setSelectedCampaigns(prev =>
      prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]
    );
  };

  const toggleBulkHour = (h: number) => {
    setBulkHours(prev =>
      prev.includes(h) ? prev.filter(x => x !== h) : [...prev, h].sort((a, b) => a - b)
    );
  };

  const hasScheduleAtHour = (cid: number, h: number) =>
    schedules.some(s => s.campaign_id === cid && h >= s.hour_start && h < s.hour_end);

  const getNext14Days = () => {
    const days = [];
    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      days.push({
        date: d.toISOString().split('T')[0],
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        dayOfWeek: dayNames[d.getDay()],
      });
    }
    return days;
  };

  return (
    <div>
      {/* Schedule Type Selection */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">Quy tắc:</span>
          <button
            onClick={() => setScheduleType('daily')}
            className={cn("px-3 py-1 rounded-full text-sm", scheduleType === 'daily' ? "bg-green-500 text-white" : "bg-gray-100")}
          >
            Mỗi ngày
          </button>
          <button
            onClick={() => setScheduleType('specific')}
            className={cn("px-3 py-1 rounded-full text-sm", scheduleType === 'specific' ? "bg-green-500 text-white" : "bg-gray-100")}
          >
            Ngày chỉ định
          </button>
        </div>
      </div>

      {/* Date Selection (for specific dates) */}
      {scheduleType === 'specific' && (
        <div className="mb-4 p-3 bg-white rounded-lg border">
          <p className="text-sm text-gray-600 mb-2">Chọn ngày áp dụng:</p>
          <div className="flex flex-wrap gap-2">
            {getNext14Days().map(({ date, label, dayOfWeek }) => (
              <button
                key={date}
                onClick={() => setSelectedDates(prev =>
                  prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date].sort()
                )}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium flex flex-col items-center min-w-[50px]",
                  selectedDates.includes(date) ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"
                )}
              >
                <span>{label}</span>
                <span className="text-[10px] opacity-70">{dayOfWeek}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hour Selection */}
      <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-blue-800">
            Chọn nhiều chiến dịch: ({selectedCampaigns.length} đã chọn)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedCampaigns(campaigns.map(c => c.campaign_id))}
              className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
            >
              Chọn tất cả
            </button>
            <button
              onClick={() => setSelectedCampaigns([])}
              className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded"
            >
              Bỏ chọn
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm text-blue-700 whitespace-nowrap">Khung giờ:</span>
          <div className="flex gap-0.5 flex-wrap">
            {Array.from({ length: 24 }, (_, h) => (
              <button
                key={h}
                onClick={() => toggleBulkHour(h)}
                className={cn(
                  "w-8 h-8 text-xs font-medium rounded",
                  bulkHours.includes(h) ? "bg-blue-500 text-white" : "bg-white text-gray-500 border"
                )}
              >
                {h.toString().padStart(2, '0')}
              </button>
            ))}
          </div>
        </div>

        {selectedCampaigns.length > 0 && bulkHours.length > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-blue-200">
            <span className="text-sm text-blue-700">
              {selectedCampaigns.length} chiến dịch × {Math.min(...bulkHours)}:00-{Math.max(...bulkHours)+1}:00
            </span>
            <Button size="sm" onClick={onOpenDialog} className="bg-blue-600 hover:bg-blue-700">
              Đặt ngân sách cho tất cả
            </Button>
          </div>
        )}
      </div>

      {/* Campaign Grid with Hour Slots */}
      <div className="space-y-2">
        {campaigns.map(c => {
          const isSelected = selectedCampaigns.includes(c.campaign_id);
          return (
            <div
              key={c.campaign_id}
              className={cn("flex items-center bg-white border rounded-lg", isSelected && "ring-2 ring-blue-500")}
            >
              <div className="w-[250px] p-3 border-r flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleCampaignSelection(c.campaign_id)}
                  className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-gray-400">ID: {c.campaign_id}</p>
                </div>
              </div>
              <div className="flex-1 p-2">
                <div className="grid grid-cols-24 gap-0.5">
                  {Array.from({ length: 24 }, (_, h) => {
                    const hasExisting = hasScheduleAtHour(c.campaign_id, h);
                    const isInBulkSelection = isSelected && bulkHours.includes(h);
                    return (
                      <div
                        key={h}
                        className={cn(
                          "h-8 text-[10px] font-medium rounded flex items-center justify-center",
                          hasExisting ? "bg-green-500 text-white" :
                          isInBulkSelection ? "bg-blue-500 text-white" :
                          "bg-gray-100 text-gray-400"
                        )}
                      >
                        {h.toString().padStart(2, '0')}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        ✓ Tick checkbox để chọn chiến dịch, sau đó chọn khung giờ ở trên. 
        Xanh lá = đã có lịch, xanh dương = đang chọn.
      </p>
    </div>
  );
}

// ==================== SAVED SCHEDULES ====================

function SavedSchedules({ schedules, formatPrice, onDelete }) {
  if (schedules.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p>Chưa có cấu hình</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="grid grid-cols-[1fr_70px_110px_110px_50px] gap-3 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500">
        <div>Chiến dịch</div>
        <div className="text-center">Loại</div>
        <div className="text-center">Khung giờ</div>
        <div className="text-right">Ngân sách</div>
        <div className="text-center">Xóa</div>
      </div>
      <div className="divide-y">
        {schedules.map(s => (
          <div key={s.id} className="grid grid-cols-[1fr_70px_110px_110px_50px] gap-3 px-4 py-3 items-center hover:bg-gray-50">
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{s.campaign_name}</p>
              <p className="text-xs text-gray-400">ID: {s.campaign_id}</p>
            </div>
            <div className="text-center">
              <span className={cn("text-xs px-2 py-0.5 rounded", AD_TYPE_MAP[s.ad_type]?.color)}>
                {AD_TYPE_MAP[s.ad_type]?.label}
              </span>
            </div>
            <div className="text-sm text-center">
              {s.hour_start.toString().padStart(2, '0')}:00 - {s.hour_end === 24 ? '23:59' : `${s.hour_end.toString().padStart(2, '0')}:00`}
            </div>
            <div className="text-sm text-right font-medium text-orange-600">
              {formatPrice(s.budget)}
            </div>
            <div className="flex justify-center">
              <button onClick={() => onDelete(s.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                X
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== BUDGET HISTORY ====================

function BudgetHistory({ shopId, formatPrice }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (shopId) loadLogs();
  }, [shopId]);

  const loadLogs = async () => {
    const { data } = await supabase
      .from('apishopee_ads_budget_logs')
      .select('*')
      .eq('shop_id', shopId)
      .order('executed_at', { ascending: false })
      .limit(50);
    setLogs(data || []);
  };

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p>Chưa có lịch sử</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="grid grid-cols-[1fr_100px_80px_140px] gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500">
        <div>Chiến dịch</div>
        <div className="text-right">Ngân sách</div>
        <div className="text-center">TT</div>
        <div>Thời gian</div>
      </div>
      <div className="divide-y">
        {logs.map(l => (
          <div key={l.id} className="grid grid-cols-[1fr_100px_80px_140px] gap-2 px-4 py-3 items-center hover:bg-gray-50">
            <div>
              <p className="text-sm">{l.campaign_name || 'Campaign ' + l.campaign_id}</p>
            </div>
            <div className="text-sm text-right font-medium text-orange-600">
              {formatPrice(l.new_budget)}
            </div>
            <div className="text-center">
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full",
                l.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              )}>
                {l.status === 'success' ? 'OK' : 'Lỗi'}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {new Date(l.executed_at).toLocaleString('vi-VN')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 7. Luồng hoạt động

### 7.1 Luồng Đồng bộ Campaigns

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  User click "Đồng bộ"                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend: AdsPanel.fetchFromAPI()                                          │
│  1. Gọi getCampaignIdList({ shop_id, ad_type: 'all' })                      │
│  2. Nhận danh sách campaign_id + ad_type                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Edge Function: shopee-ads                                                  │
│  1. Lấy partner credentials từ apishopee_shops                              │
│  2. Lấy access_token từ apishopee_shops                                     │
│  3. Tạo signature HMAC-SHA256                                               │
│  4. Gọi Shopee API: /api/v2/ads/get_product_level_campaign_id_list          │
│  5. Nếu token hết hạn → auto refresh → retry                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend: Lấy chi tiết từng batch 100 campaigns                            │
│  Loop: getCampaignSettingInfo({ campaign_id_list, info_type_list: '1,3' })  │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend: Lưu vào cache                                                    │
│  supabase.from('apishopee_ads_campaign_data').upsert(cacheData)             │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend: Cập nhật UI với danh sách campaigns                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Luồng Tạo Lịch Ngân sách

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  User chọn campaigns + khung giờ + nhập ngân sách → click "Lưu"             │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend: saveBulkSchedule()                                               │
│  1. Validate: campaigns > 0, hours > 0, budget > 0                          │
│  2. Tạo records cho mỗi campaign                                            │
│  3. Insert vào apishopee_scheduled_ads_budget                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Database: apishopee_scheduled_ads_budget                                   │
│  - shop_id, campaign_id, campaign_name, ad_type                             │
│  - hour_start, hour_end, budget                                             │
│  - days_of_week hoặc specific_dates                                         │
│  - is_active = true                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Luồng Tự động Điều chỉnh Ngân sách (Cron Job)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Cron Job chạy mỗi giờ (phút 0)                                             │
│  POST /functions/v1/shopee-ads-scheduler { action: 'process' }              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Edge Function: shopee-ads-scheduler                                        │
│  1. Lấy giờ hiện tại theo timezone VN (UTC+7)                               │
│  2. Query schedules: is_active = true AND hour_start <= now < hour_end      │
│  3. Lọc theo days_of_week hoặc specific_dates                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Loop qua từng schedule phù hợp:                                            │
│  1. Lấy partner credentials + token                                         │
│  2. Gọi Shopee API: edit_auto_product_ads hoặc edit_manual_product_ads      │
│     - edit_action: 'change_budget'                                          │
│     - budget: schedule.budget                                               │
│  3. Log kết quả vào apishopee_ads_budget_logs                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Response: { processed: N, results: [...] }                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Hướng dẫn triển khai

### 8.1 Bước 1: Tạo Database Tables

Chạy migrations theo thứ tự:

```bash
# Tạo bảng scheduled_ads_budget và ads_budget_logs
supabase migration new scheduled_ads_budget
# Copy nội dung từ Section 2.2 và 2.3

# Tạo bảng ads_campaign_data
supabase migration new ads_campaign_data
# Copy nội dung từ Section 2.1

# Apply migrations
supabase db push
```

### 8.2 Bước 2: Deploy Edge Functions

```bash
# Deploy shopee-ads function
supabase functions deploy shopee-ads

# Deploy shopee-ads-scheduler function
supabase functions deploy shopee-ads-scheduler
```

### 8.3 Bước 3: Cấu hình Environment Variables

Trong Supabase Dashboard → Settings → Edge Functions:

```env
SHOPEE_PARTNER_ID=your_partner_id
SHOPEE_PARTNER_KEY=your_partner_key
SHOPEE_BASE_URL=https://partner.shopeemobile.com
SHOPEE_PROXY_URL=your_proxy_url (optional)
```

### 8.4 Bước 4: Setup Cron Job

```sql
-- Enable pg_cron và pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Tạo cron job
SELECT cron.schedule(
  'ads-budget-scheduler',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/shopee-ads-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"action": "process"}'::jsonb
  );
  $$
);
```

### 8.5 Bước 5: Tạo Client Libraries

Tạo các file trong `src/lib/shopee/`:
- `ads-client.ts` - Copy từ Section 5.1
- `ads-scheduler-client.ts` - Copy từ Section 5.2

Export trong `src/lib/shopee/index.ts`:
```typescript
export * from './ads-client';
export * from './ads-scheduler-client';
```

### 8.6 Bước 6: Tạo UI Components

Tạo `src/components/panels/AdsPanel.tsx` - Copy từ Section 6.1 và 6.2

Export trong `src/components/panels/index.ts`:
```typescript
export { default as AdsPanel } from './AdsPanel';
```

### 8.7 Bước 7: Tích hợp vào App

```tsx
// src/App.tsx hoặc router
import { AdsPanel } from '@/components/panels';

// Trong component
<AdsPanel />
```

---

## 9. Troubleshooting

### 9.1 Lỗi thường gặp

| Lỗi | Nguyên nhân | Giải pháp |
|-----|-------------|-----------|
| `error_auth` | Token hết hạn | Edge function tự động refresh, kiểm tra refresh_token |
| `error_permission_denied` | Không có quyền Ads API | Liên hệ Shopee Partner Support |
| `ads.campaign.error_budget_range` | Ngân sách không hợp lệ | Kiểm tra min/max budget của Shopee |
| `ads.rate_limit.exceed_api` | Quá nhiều request | Giảm tần suất gọi API |

### 9.2 Debug Tips

```typescript
// Bật console log trong Edge Function
console.log('[SHOPEE-ADS] Request:', { action, shop_id, params });
console.log('[SHOPEE-ADS] Response:', result);

// Kiểm tra logs trong Supabase Dashboard
// Dashboard → Edge Functions → Logs
```

### 9.3 Test Scheduler

```typescript
// Test chạy ngay một schedule
const result = await runScheduleNow(shopId, scheduleId);
console.log('Test result:', result);

// Kiểm tra logs
const { logs } = await getBudgetLogs(shopId, campaignId, 10);
console.log('Recent logs:', logs);
```

---

## 10. Best Practices

1. **Cache First**: Luôn load từ cache trước, chỉ fetch API khi cần refresh
2. **Batch Requests**: Lấy chi tiết campaigns theo batch 100 để tránh rate limit
3. **Error Handling**: Luôn log lỗi vào database để debug
4. **Timezone**: Sử dụng timezone VN (UTC+7) cho scheduler
5. **Reference ID**: Tạo unique reference_id cho mỗi edit request
6. **Validation**: Validate budget, hours trước khi lưu schedule

---

## 11. Files liên quan

```
src/
├── components/panels/
│   ├── AdsPanel.tsx              # UI quản lý campaigns & lịch ngân sách
│   ├── AdsPerformancePanel.tsx   # UI xem hiệu suất
│   └── index.ts
└── lib/shopee/
    ├── ads-client.ts             # Client gọi API ads
    ├── ads-scheduler-client.ts   # Client quản lý lịch ngân sách
    ├── types.ts                  # TypeScript types
    └── index.ts

supabase/
├── functions/
│   ├── shopee-ads/index.ts           # Edge function xử lý Shopee Ads API
│   └── shopee-ads-scheduler/index.ts # Edge function lịch ngân sách
└── migrations/
    ├── 005_scheduled_ads_budget.sql
    ├── 007_campaigns_cache.sql
    ├── 018_fix_ads_campaign_cached_at.sql
    └── 019_fix_ads_campaign_raw_data.sql

docs/
├── guides/
│   └── ads-management.md         # File này
└── managers/
    └── ads.md                    # Tài liệu API reference
```
