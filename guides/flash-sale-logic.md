# Flash Sale - Quy trình Logic Chi tiết

## 1. Tổng quan Kiến trúc

### 1.1 Sơ đồ hệ thống

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                                │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │ FlashSalePanel  │    │   useSyncData   │    │   useRealtimeData       │  │
│  │ (UI Component)  │───▶│   (Sync Hook)   │    │   (Realtime Hook)       │  │
│  └─────────────────┘    └────────┬────────┘    └───────────┬─────────────┘  │
└──────────────────────────────────┼─────────────────────────┼────────────────┘
                                   │                         │
                                   ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE EDGE FUNCTIONS                              │
│  ┌─────────────────────────┐    ┌─────────────────────────────────────────┐ │
│  │   shopee-sync-worker    │    │         shopee-flash-sale               │ │
│  │   (Background Sync)     │    │         (Direct Actions)                │ │
│  └───────────┬─────────────┘    └──────────────────┬──────────────────────┘ │
└──────────────┼─────────────────────────────────────┼────────────────────────┘
               │                                     │
               ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SHOPEE PARTNER API                                │
│  /api/v2/shop_flash_sale/*                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SUPABASE DATABASE                                   │
│  ┌─────────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │ apishopee_flash_    │  │ apishopee_sync_ │  │    apishopee_shops      │  │
│  │ sale_data           │  │ status          │  │    (Token Storage)      │  │
│  └─────────────────────┘  └─────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Các file chính

| File | Mô tả |
|------|-------|
| `src/components/panels/FlashSalePanelV2.tsx` | UI Component chính |
| `src/hooks/useSyncData.ts` | Hook quản lý sync & realtime |
| `src/lib/shopee/flash-sale-client.ts` | Client-side cache utilities |
| `supabase/functions/shopee-flash-sale/index.ts` | Edge Function xử lý actions |
| `supabase/functions/shopee-sync-worker/index.ts` | Background sync worker |

---

## 2. Luồng Dữ liệu Chi tiết

### 2.1 Luồng Sync Data (Đồng bộ từ Shopee)

```
┌──────────────┐
│  User Click  │
│   "Sync"     │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  useSyncData.triggerSync('flash_sales')                      │
│  - Set isSyncing = true                                      │
│  - Clear lastError                                           │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  supabase.functions.invoke('shopee-sync-worker')             │
│  Body: {                                                     │
│    action: 'sync-flash-sale-data',                           │
│    shop_id: number,                                          │
│    user_id: string                                           │
│  }                                                           │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  EDGE FUNCTION: shopee-sync-worker                           │
│                                                              │
│  1. getPartnerCredentials(shopId)                            │
│     - Lấy partner_id, partner_key từ apishopee_shops         │
│     - Fallback: dùng env variables                           │
│                                                              │
│  2. getTokenWithAutoRefresh(shopId, userId)                  │
│     - Lấy access_token từ apishopee_shops                    │
│     - Nếu token hết hạn → refreshAccessToken()               │
│     - Lưu token mới vào DB                                   │
│                                                              │
│  3. callShopeeAPIWithParams()                                │
│     - Path: /api/v2/shop_flash_sale/get_shop_flash_sale_list │
│     - Params: type=0, offset=0, limit=100                    │
│     - Nếu token invalid → auto refresh & retry               │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Xử lý Response từ Shopee                                    │
│                                                              │
│  1. DELETE FROM apishopee_flash_sale_data                    │
│     WHERE shop_id = :shopId                                  │
│                                                              │
│  2. INSERT INTO apishopee_flash_sale_data                    │
│     - flash_sale_id, timeslot_id, status                     │
│     - start_time, end_time                                   │
│     - enabled_item_count, item_count                         │
│     - type, remindme_count, click_count                      │
│     - raw_response, synced_at                                │
│                                                              │
│  3. UPDATE apishopee_sync_status                             │
│     SET flash_sales_synced_at = NOW()                        │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Frontend nhận response                                      │
│  - Set isSyncing = false                                     │
│  - Show toast success/error                                  │
│  - Realtime subscription tự động cập nhật UI                 │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Luồng Realtime Data (Hiển thị UI)

```
┌──────────────────────────────────────────────────────────────┐
│  useRealtimeData('flash_sale_data', shopId, userId)          │
└──────────────────────────────┬───────────────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       │                                               │
       ▼                                               ▼
┌─────────────────────┐                    ┌─────────────────────┐
│  Initial Fetch      │                    │  Realtime Subscribe │
│                     │                    │                     │
│  SELECT * FROM      │                    │  supabase.channel() │
│  flash_sale_data    │                    │  .on('postgres_     │
│  WHERE shop_id = ?  │                    │    changes', ...)   │
│  ORDER BY start_time│                    │  .subscribe()       │
└─────────┬───────────┘                    └──────────┬──────────┘
          │                                           │
          │                                           │
          ▼                                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  setData(result)                                                │
│                                                                 │
│  Khi có INSERT/UPDATE/DELETE trong DB:                          │
│  → Realtime trigger → fetchData() → setData(newResult)          │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  FlashSalePanelV2 Component                                     │
│                                                                 │
│  1. Filter by type (filterType state)                           │
│     - '0': Tất cả                                                │
│     - '1': Sắp tới                                               │
│     - '2': Đang chạy                                             │
│     - '3': Kết thúc                                              │
│                                                                 │
│  2. Sort by priority                                            │
│     - TYPE_PRIORITY = { 2: 1, 1: 2, 3: 3 }                      │
│     - Đang chạy > Sắp tới > Kết thúc                            │
│                                                                 │
│  3. Pagination                                                  │
│     - itemsPerPage = 20                                         │
│     - paginatedSales = filteredSales.slice(...)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Các Actions Flash Sale

### 3.1 Bảng tổng hợp Actions

| Action | Edge Function | Shopee API Endpoint | Method | Mô tả |
|--------|--------------|---------------------|--------|-------|
| `get-time-slots` | shopee-flash-sale | `/api/v2/shop_flash_sale/get_time_slot_id` | GET | Lấy danh sách time slots khả dụng |
| `create-flash-sale` | shopee-flash-sale | `/api/v2/shop_flash_sale/create_shop_flash_sale` | POST | Tạo flash sale mới |
| `get-flash-sale` | shopee-flash-sale | `/api/v2/shop_flash_sale/get_shop_flash_sale` | GET | Lấy chi tiết 1 flash sale |
| `get-flash-sale-list` | shopee-flash-sale | `/api/v2/shop_flash_sale/get_shop_flash_sale_list` | GET | Lấy danh sách flash sales |
| `update-flash-sale` | shopee-flash-sale | `/api/v2/shop_flash_sale/update_shop_flash_sale` | POST | Bật/Tắt flash sale |
| `delete-flash-sale` | shopee-flash-sale | `/api/v2/shop_flash_sale/delete_shop_flash_sale` | POST | Xóa flash sale |
| `add-items` | shopee-flash-sale | `/api/v2/shop_flash_sale/add_shop_flash_sale_items` | POST | Thêm sản phẩm vào flash sale |
| `get-items` | shopee-flash-sale | `/api/v2/shop_flash_sale/get_shop_flash_sale_items` | GET | Lấy danh sách sản phẩm |
| `update-items` | shopee-flash-sale | `/api/v2/shop_flash_sale/update_shop_flash_sale_items` | POST | Cập nhật sản phẩm |
| `delete-items` | shopee-flash-sale | `/api/v2/shop_flash_sale/delete_shop_flash_sale_items` | POST | Xóa sản phẩm |
| `get-criteria` | shopee-flash-sale | `/api/v2/shop_flash_sale/get_item_criteria` | GET | Lấy tiêu chí sản phẩm |

### 3.2 Chi tiết từng Action

#### 3.2.1 Lấy Time Slots

```typescript
// Request
{
  action: 'get-time-slots',
  shop_id: 123456,
  start_time: 1704067200,  // Optional: Unix timestamp
  end_time: 1706745600     // Optional: Unix timestamp (default: +30 ngày)
}

// Response
{
  response: [
    {
      timeslot_id: 236767490043904,
      start_time: 1704110400,
      end_time: 1704124800
    },
    // ...
  ]
}
```

#### 3.2.2 Tạo Flash Sale

```typescript
// Request
{
  action: 'create-flash-sale',
  shop_id: 123456,
  timeslot_id: 236767490043904
}

// Response
{
  response: {
    flash_sale_id: 802063533822541,
    status: 2  // 2 = disabled (mặc định)
  }
}
```

#### 3.2.3 Xóa Flash Sale

```typescript
// Request
{
  action: 'delete-flash-sale',
  shop_id: 123456,
  flash_sale_id: 802063533822541
}

// Response
{
  response: {
    status: 0  // 0 = deleted
  }
}

// Lưu ý: Chỉ xóa được flash sale "Sắp tới" (type = 1)
// Không xóa được "Đang chạy" (type = 2) hoặc "Kết thúc" (type = 3)
```

#### 3.2.4 Thêm Sản phẩm

```typescript
// Request - Sản phẩm có biến thể
{
  action: 'add-items',
  shop_id: 123456,
  flash_sale_id: 802063533822541,
  items: [
    {
      item_id: 3744623870,
      purchase_limit: 5,  // 0 = không giới hạn
      models: [
        {
          model_id: 5414485721,
          input_promo_price: 69.3,  // Giá khuyến mãi (chưa thuế)
          stock: 100                 // Số lượng campaign
        }
      ]
    }
  ]
}

// Request - Sản phẩm không có biến thể
{
  action: 'add-items',
  shop_id: 123456,
  flash_sale_id: 802063533822541,
  items: [
    {
      item_id: 789012,
      purchase_limit: 3,
      item_input_promo_price: 15.99,
      item_stock: 200
    }
  ]
}
```

---

## 4. Trạng thái và Phân loại

### 4.1 Status (Trạng thái hoạt động)

| Status Code | Label | Mô tả | Màu UI |
|-------------|-------|-------|--------|
| `0` | Đã xóa | Flash sale đã bị xóa | Gray |
| `1` | Bật | Flash sale đang hoạt động | Green |
| `2` | Tắt | Flash sale bị tắt (có thể bật lại) | Yellow |
| `3` | Từ chối | Hệ thống từ chối (không thể chỉnh sửa) | Red |

### 4.2 Type (Phân loại theo thời gian)

| Type Code | Label | Mô tả | Icon | Priority |
|-----------|-------|-------|------|----------|
| `1` | Sắp tới | Chưa bắt đầu | ⏳ | 2 |
| `2` | Đang chạy | Đang diễn ra | 🔥 | 1 (cao nhất) |
| `3` | Kết thúc | Đã kết thúc | ✓ | 3 |

### 4.3 Item Status (Trạng thái sản phẩm)

| Status Code | Label | Mô tả |
|-------------|-------|-------|
| `0` | Disabled | Sản phẩm bị tắt |
| `1` | Enabled | Sản phẩm đang hoạt động |
| `2` | Deleted | Sản phẩm đã xóa |
| `4` | System Rejected | Hệ thống từ chối |
| `5` | Manual Rejected | Từ chối thủ công |

---

## 5. Cơ chế Auto Token Refresh

### 5.1 Luồng xử lý Token

```
┌─────────────────────────────────────────────────────────────────┐
│  getTokenWithAutoRefresh(supabase, shopId)                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Query token từ apishopee_shops                              │
│     SELECT access_token, refresh_token, expired_at              │
│     FROM apishopee_shops WHERE shop_id = ?                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Kiểm tra token expiry                                       │
│                                                                 │
│     TOKEN_BUFFER_MS = 5 * 60 * 1000  (5 phút)                   │
│                                                                 │
│     isExpired = expired_at < Date.now()                         │
│     isExpiringSoon = (expired_at - Date.now()) < TOKEN_BUFFER   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────────┐
│  Token còn hạn          │       │  Token hết hạn/sắp hết      │
│  → Return token         │       │                             │
└─────────────────────────┘       │  refreshAccessToken()       │
                                  │  - POST /api/v2/auth/       │
                                  │    access_token/get         │
                                  │  - Body: refresh_token,     │
                                  │    partner_id, shop_id      │
                                  └──────────────┬──────────────┘
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │  saveToken()                │
                                  │  - UPDATE apishopee_shops   │
                                  │  - SET access_token,        │
                                  │    refresh_token, expired_at│
                                  └──────────────┬──────────────┘
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │  Return new token           │
                                  └─────────────────────────────┘
```

### 5.2 Auto Retry khi Token Invalid

```
┌─────────────────────────────────────────────────────────────────┐
│  callShopeeAPIWithRetry()                                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Gọi API lần đầu với current token                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Kiểm tra response                                           │
│                                                                 │
│     if (error === 'error_auth' ||                               │
│         message.includes('Invalid access_token'))               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────────┐
│  Success                │       │  Token Invalid              │
│  → Return result        │       │                             │
└─────────────────────────┘       │  1. refreshAccessToken()    │
                                  │  2. saveToken()             │
                                  │  3. Retry API call          │
                                  │  4. Return new result       │
                                  └─────────────────────────────┘
```

---

## 6. Database Schema

### 6.1 Bảng apishopee_flash_sale_data

```sql
CREATE TABLE apishopee_flash_sale_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  user_id UUID NOT NULL,
  flash_sale_id BIGINT NOT NULL,
  timeslot_id BIGINT,
  status INTEGER,           -- 0: deleted, 1: enabled, 2: disabled, 3: rejected
  start_time BIGINT,        -- Unix timestamp
  end_time BIGINT,          -- Unix timestamp
  enabled_item_count INTEGER,
  item_count INTEGER,
  type INTEGER,             -- 1: upcoming, 2: ongoing, 3: expired
  remindme_count INTEGER,
  click_count INTEGER,
  raw_response JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(shop_id, flash_sale_id)
);

-- Index cho query performance
CREATE INDEX idx_flash_sale_shop_id ON apishopee_flash_sale_data(shop_id);
CREATE INDEX idx_flash_sale_user_id ON apishopee_flash_sale_data(user_id);
CREATE INDEX idx_flash_sale_type ON apishopee_flash_sale_data(type);
```

### 6.2 Bảng apishopee_sync_status

```sql
CREATE TABLE apishopee_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT NOT NULL,
  user_id UUID NOT NULL,
  campaigns_synced_at TIMESTAMPTZ,
  flash_sales_synced_at TIMESTAMPTZ,
  is_syncing BOOLEAN DEFAULT FALSE,
  last_sync_error TEXT,
  sync_progress JSONB,      -- { current_step, total_items, processed_items }
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(shop_id, user_id)
);
```

### 6.3 Bảng apishopee_shops (Token Storage)

```sql
CREATE TABLE apishopee_shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id BIGINT UNIQUE NOT NULL,
  shop_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expire_in INTEGER,
  expired_at BIGINT,        -- Unix timestamp (ms)
  partner_id BIGINT,
  partner_key TEXT,
  merchant_id BIGINT,
  token_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Caching Strategy

### 7.1 Stale Data Detection

```typescript
// useSyncData.ts
const staleMinutes = 5;  // Data cũ hơn 5 phút = stale

function isDataStale(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) return true;
  
  const lastSync = new Date(lastSyncedAt);
  const now = new Date();
  const diffMinutes = (now.getTime() - lastSync.getTime()) / (1000 * 60);
  
  return diffMinutes > staleMinutes;
}
```

### 7.2 Auto Sync on Mount

```typescript
// Khi component mount
useEffect(() => {
  const checkAndSync = async () => {
    const status = await fetchSyncStatus();
    
    // Nếu chưa có sync status → sync lần đầu
    if (!status) {
      triggerSync();
      return;
    }
    
    // Nếu data stale và không đang sync → trigger sync
    if (isDataStale(status.flash_sales_synced_at) && !status.is_syncing) {
      triggerSync();
    }
  };
  
  checkAndSync();
}, [shopId, userId]);
```

### 7.3 Realtime Subscription

```typescript
// Subscribe to database changes
const channel = supabase
  .channel(`flash_sale_data_${shopId}_${userId}`)
  .on(
    'postgres_changes',
    {
      event: '*',           // INSERT, UPDATE, DELETE
      schema: 'public',
      table: 'apishopee_flash_sale_data',
      filter: `shop_id=eq.${shopId}`,
    },
    () => {
      // Refetch data khi có thay đổi
      fetchData();
    }
  )
  .subscribe();
```

---

## 8. UI Component Logic

### 8.1 FlashSalePanelV2 State Management

```typescript
// Filter & Pagination State
const [filterType, setFilterType] = useState<string>('0');     // '0'=all, '1'=upcoming, '2'=ongoing, '3'=expired
const [currentPage, setCurrentPage] = useState(1);
const [itemsPerPage] = useState(20);
const [selectedSale, setSelectedSale] = useState<FlashSale | null>(null);

// Hooks
const { isSyncing, triggerSync, syncStatus } = useSyncData({
  shopId,
  userId,
  autoSyncOnMount: true,
  syncType: 'flash_sales',
  staleMinutes: 5,
});

const { data: flashSales, loading } = useRealtimeData<FlashSale>(
  'flash_sale_data',
  shopId,
  userId,
  { orderBy: 'start_time', orderAsc: false }
);
```

### 8.2 Filter và Sort Logic

```typescript
const TYPE_PRIORITY: Record<number, number> = { 
  2: 1,  // Đang chạy - ưu tiên cao nhất
  1: 2,  // Sắp tới
  3: 3   // Kết thúc - ưu tiên thấp nhất
};

const filteredSales = useMemo(() => {
  let result = [...flashSales];
  
  // Filter by type
  if (filterType !== '0') {
    result = result.filter(s => s.type === Number(filterType));
  }
  
  // Sort by priority (Đang chạy > Sắp tới > Kết thúc)
  result.sort((a, b) => 
    (TYPE_PRIORITY[a.type] || 99) - (TYPE_PRIORITY[b.type] || 99)
  );
  
  return result;
}, [flashSales, filterType]);
```

### 8.3 Pagination Logic

```typescript
const totalPages = Math.ceil(filteredSales.length / itemsPerPage);

const paginatedSales = filteredSales.slice(
  (currentPage - 1) * itemsPerPage,
  currentPage * itemsPerPage
);
```

### 8.4 Delete Flash Sale Handler

```typescript
const handleDeleteFlashSale = async () => {
  if (!selectedSale) return;
  
  // Confirm dialog
  if (!confirm(`Bạn có chắc muốn xóa Flash Sale này?\nID: ${selectedSale.flash_sale_id}`)) {
    return;
  }

  try {
    // 1. Gọi Edge Function để xóa trên Shopee
    const { data, error } = await supabase.functions.invoke('shopee-flash-sale', {
      body: { 
        action: 'delete-flash-sale', 
        shop_id: shopId, 
        flash_sale_id: selectedSale.flash_sale_id 
      },
    });
    
    if (error) throw error;
    if (data?.error) {
      toast({ title: 'Lỗi', description: data.message || data.error, variant: 'destructive' });
      return;
    }

    // 2. Xóa khỏi local DB
    await supabase
      .from('apishopee_flash_sale_data')
      .delete()
      .eq('id', selectedSale.id);
    
    // 3. Show success toast
    toast({ title: 'Thành công', description: 'Đã xóa Flash Sale' });
    setSelectedSale(null);
    
  } catch (err) {
    toast({ title: 'Lỗi', description: (err as Error).message, variant: 'destructive' });
  }
};
```

---

## 9. Error Handling

### 9.1 Common Errors

| Error Code | Mô tả | Giải pháp |
|------------|-------|-----------|
| `shop_flash_sale_already_exist` | Flash sale đã tồn tại cho time slot này | Chọn time slot khác |
| `shop_flash_sale.not_meet_shop_criteria` | Shop không đủ điều kiện | Kiểm tra rating, performance |
| `shop_flash_sale_exceed_max_item_limit` | Vượt quá 50 sản phẩm | Giảm số sản phẩm enabled |
| `shop_flash_sale_is_not_enabled_or_upcoming` | Không thể sửa flash sale đang chạy/kết thúc | Chỉ sửa được upcoming |
| `shop_flash_sale_in_holiday_mode` | Shop đang ở chế độ nghỉ | Tắt holiday mode |
| `error_auth` / `Invalid access_token` | Token hết hạn | Auto refresh token |

### 9.2 Edge Function Error Response

```typescript
// Edge function trả về 200 với error trong body
// để frontend có thể đọc được message chi tiết
return new Response(JSON.stringify({ 
  error: (error as Error).message,
  success: false,
  details: 'Check Supabase Edge Function logs for more details'
}), {
  status: 200,  // Không dùng 500 để tránh "non-2xx status code"
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
```

---

## 10. Best Practices

### 10.1 Quản lý Flash Sale

1. **Luôn kiểm tra tiêu chí sản phẩm** trước khi thêm vào flash sale
2. **Bắt đầu với số lượng nhỏ** để test trước
3. **Monitor failed items** và điều chỉnh phù hợp
4. **Giữ promotional stock** ở mức hợp lý

### 10.2 Pricing Strategy

1. Đảm bảo giá khuyến mãi đáp ứng **discount criteria**
2. Giá phải **thấp hơn giá thấp nhất 7 ngày qua**
3. Cân nhắc thuế khi set `input_promo_price`
4. Dùng `promotion_price_with_tax` để hiển thị cho khách

### 10.3 Status Management

1. **Enable flash sale** chỉ khi tất cả items đã sẵn sàng
2. **Disable tạm thời** nếu cần (không xóa items)
3. **Chỉ xóa** flash sale upcoming
4. **Không thể sửa** flash sale đang chạy hoặc kết thúc

### 10.4 Performance Optimization

1. Sử dụng **pagination** cho danh sách lớn
2. **Batch operations** khi có thể
3. **Cache time slot data** (ít thay đổi)
4. **Monitor performance** qua click và reminder counts
