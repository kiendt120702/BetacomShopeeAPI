# Mô hình Realtime cho Ads Management

## Tổng quan

Mô hình Realtime cho trang quảng cáo hoạt động theo luồng DB-First:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Edge Function  │     │  Supabase DB    │     │  Supabase       │     │  Frontend       │
│  (Worker)       │────▶│  (PostgreSQL)   │────▶│  Realtime       │────▶│  (React)        │
│                 │     │                 │     │                 │     │                 │
│  Gọi Shopee API │     │  UPSERT data    │     │  Broadcast      │     │  Auto update    │
│  định kỳ 15 phút│     │  (tránh trùng)  │     │  INSERT/UPDATE  │     │  không cần F5   │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

## QUAN TRỌNG: DB-First Architecture

**Frontend KHÔNG gọi Shopee API trực tiếp!**

Tất cả dữ liệu đều đi qua DB:
1. Edge Function `apishopee-ads-sync` gọi Shopee API
2. Data được UPSERT vào DB (tránh trùng lặp)
3. Supabase Realtime broadcast changes
4. Frontend nhận và cập nhật UI

## Các thành phần

### 1. Edge Function (Worker)
- **Name**: `apishopee-ads-sync`
- **File**: `supabase/functions/apishopee-ads-sync/index.ts`
- **Chức năng**: 
  - Gọi Shopee API lấy danh sách campaigns
  - Lấy performance data (daily & hourly)
  - UPSERT vào database (tránh trùng lặp)
- **Actions**:
  - `sync`: Đồng bộ toàn bộ dữ liệu
  - `status`: Lấy trạng thái sync

### 2. Database Tables
- **apishopee_ads_campaign_data**: Cache thông tin campaigns
  - Unique: `(shop_id, campaign_id)`
- **apishopee_ads_performance_daily**: Performance theo ngày
  - Unique: `(shop_id, campaign_id, performance_date)`
- **apishopee_ads_performance_hourly**: Performance theo giờ
  - Unique: `(shop_id, campaign_id, performance_date, hour)`
- **apishopee_ads_sync_status**: Trạng thái sync
  - Unique: `shop_id`

### 3. Frontend Hook
- **File**: `src/hooks/useAdsData.ts`
- **Chức năng**:
  - Đọc data từ DB (KHÔNG gọi Shopee API)
  - Subscribe Realtime changes
  - Auto-sync mỗi 15 phút (gọi Edge Function)
  - Cache với React Query
  - Combine campaigns + performance data

## Cách tránh vòng lặp vô hạn

### Vấn đề cũ:
```
cachedCampaigns thay đổi → useEffect → gọi API → update DB → Realtime → invalidate → cachedCampaigns thay đổi → ...
```

### Giải pháp:
1. **Frontend chỉ đọc từ DB** - không gọi Shopee API trực tiếp
2. **Edge Function xử lý sync** - tách biệt logic sync
3. **UPSERT với unique constraint** - tránh duplicate data
4. **Stable channel name** - không tạo channel mới mỗi render

## Cách tránh trùng lặp dữ liệu

### UPSERT với Unique Constraint

```sql
-- Daily performance: unique per shop + campaign + date
UNIQUE(shop_id, campaign_id, performance_date)

-- Hourly performance: unique per shop + campaign + date + hour
UNIQUE(shop_id, campaign_id, performance_date, hour)

-- Campaigns: unique per shop + campaign
UNIQUE(shop_id, campaign_id)
```

### Khi sync:
```typescript
// UPSERT - insert nếu chưa có, update nếu đã có
const { error } = await supabase
  .from('apishopee_ads_performance_daily')
  .upsert(data, { onConflict: 'shop_id,campaign_id,performance_date' });
```

## Realtime Subscription

Frontend subscribe các bảng:
- `apishopee_ads_campaign_data` - Khi campaigns thay đổi
- `apishopee_ads_performance_daily` - Khi daily performance cập nhật
- `apishopee_ads_sync_status` - Khi trạng thái sync thay đổi

```typescript
// Stable channel name để tránh tạo nhiều subscription
const channelName = `ads_${shopId}_${userId.slice(0, 8)}`;

const channel = supabase
  .channel(channelName)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'apishopee_ads_campaign_data',
    filter: `shop_id=eq.${shopId}`,
  }, (payload) => {
    queryClient.invalidateQueries({ queryKey: ['ads-campaigns'] });
  })
  .subscribe();
```

## Sử dụng

### Trong Component:
```tsx
import { useAdsData } from '@/hooks/useAdsData';

function AdsPanel({ shopId, userId }) {
  const {
    campaigns,           // Campaigns với performance data (từ DB)
    hourlyData,          // Hourly data theo campaign (từ DB)
    syncStatus,          // Trạng thái sync
    loading,             // Loading state
    syncing,             // Đang sync từ API
    isFetching,          // Background refetch
    syncFromAPI,         // Trigger manual sync (gọi Edge Function)
    loadHourlyData,      // Load hourly cho 1 campaign (từ DB)
    lastSyncAt,          // Thời gian sync cuối
  } = useAdsData(shopId, userId, {
    dateRange: 'today',
    selectedDate: new Date(),
    autoSyncInterval: 15 * 60 * 1000, // 15 phút tự động sync
  });

  return (
    // UI tự động cập nhật khi data thay đổi
  );
}
```

## Flow chi tiết

1. **User mở trang Ads**
   - Hook `useAdsData` được gọi
   - Load data từ DB (React Query)
   - Subscribe Realtime channels

2. **Auto-sync (mỗi 15 phút)**
   - Hook check thời gian sync cuối
   - Gọi Edge Function `apishopee-ads-sync`
   - Worker gọi Shopee API
   - UPSERT data vào DB
   - Realtime broadcast changes
   - Frontend tự động cập nhật

3. **Manual sync**
   - User click "Đồng bộ từ Shopee"
   - Gọi `syncFromAPI()` → Edge Function
   - Hiển thị loading state
   - Cập nhật UI khi hoàn thành

4. **Realtime update**
   - DB trigger broadcast INSERT/UPDATE
   - Frontend nhận event
   - Invalidate cache
   - UI tự động re-render

## Lưu ý quan trọng

1. **KHÔNG gọi Shopee API từ Frontend** - Luôn đi qua Edge Function
2. **Sử dụng UPSERT** - Tránh duplicate data
3. **Stable channel name** - Tránh tạo nhiều subscription
4. **Check syncing state** - Tránh sync đồng thời
5. **Auto-sync interval** - Có thể disable bằng cách set = 0
