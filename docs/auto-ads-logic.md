# Logic Hoạt động Tự động ADS

## Tổng quan
Tính năng "Tự động ADS" cho phép người dùng lên lịch tự động thay đổi ngân sách quảng cáo vào khung giờ cụ thể.

## Yêu cầu bắt buộc
Người dùng **PHẢI** điền đầy đủ 4 thông tin sau:

1. **Chọn chiến dịch** - Ít nhất 1 chiến dịch đang chạy
2. **Chọn ngày áp dụng**:
   - Hàng ngày (mặc định)
   - Ngày cụ thể (chọn từ 14 ngày tới)
3. **Chọn khung giờ** - Chọn 1 khung giờ (mỗi slot = 30 phút)
4. **Nhập ngân sách** - Tối thiểu 100.000đ

## Validation ngân sách
- Bấm **Tăng**: ngân sách nhập phải > ngân sách hiện tại
- Bấm **Giảm**: ngân sách nhập phải < ngân sách hiện tại

## Flow hoạt động

```
┌─────────────────────────────────────────────────────────────────┐
│                    NGƯỜI DÙNG                                    │
│  1. Chọn chiến dịch (kiểm tra ad_type: auto/manual)             │
│  2. Chọn ngày áp dụng (hàng ngày / ngày cụ thể)                 │
│  3. Chọn 1 khung giờ                                            │
│  4. Nhập ngân sách (≥ 100.000đ)                                 │
│  5. Bấm [Tăng] hoặc [Giảm]                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LƯU SCHEDULE VÀO DB                          │
│  - KHÔNG gọi API Shopee ngay                                    │
│  - Lưu vào bảng apishopee_scheduled_ads_budget                  │
│  - Bao gồm: shop_id, campaign_id, ad_type, hour, budget,        │
│             days_of_week hoặc specific_dates                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CRON JOB (mỗi 30 phút)                       │
│  1. Lấy giờ hiện tại (timezone Việt Nam UTC+7)                  │
│  2. Query schedules active phù hợp với giờ hiện tại             │
│  3. Lọc theo:                                                   │
│     - days_of_week: kiểm tra ngày trong tuần                    │
│     - specific_dates: kiểm tra ngày cụ thể                      │
│  4. Với mỗi schedule phù hợp:                                   │
│     - Kiểm tra ad_type (auto/manual)                            │
│     - Gọi API tương ứng:                                        │
│       • manual → edit_manual_product_ads                        │
│       • auto → edit_auto_product_ads                            │
│     - Ghi log vào apishopee_ads_budget_logs                     │
└─────────────────────────────────────────────────────────────────┘
```

## API Shopee sử dụng

### Quảng cáo Thủ công (manual)
```
POST /api/v2/ads/edit_manual_product_ads
{
  "reference_id": "scheduler-xxx",
  "campaign_id": 123,
  "edit_action": "change_budget",
  "budget": 500000
}
```

### Quảng cáo Tự động (auto)
```
POST /api/v2/ads/edit_auto_product_ads
{
  "reference_id": "scheduler-xxx",
  "campaign_id": 456,
  "edit_action": "change_budget",
  "budget": 500000
}
```

## Cấu trúc dữ liệu

### Bảng `apishopee_scheduled_ads_budget`
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| shop_id | BIGINT | ID shop |
| campaign_id | BIGINT | ID chiến dịch |
| campaign_name | TEXT | Tên chiến dịch |
| ad_type | TEXT | 'auto' hoặc 'manual' |
| hour_start | INT | Giờ bắt đầu (0-23) |
| hour_end | INT | Giờ kết thúc (0-24) |
| budget | DECIMAL | Ngân sách VNĐ (≥ 100.000) |
| days_of_week | INT[] | Ngày trong tuần [0=CN, 1=T2, ..., 6=T7] |
| specific_dates | TEXT[] | Ngày cụ thể ['YYYY-MM-DD'] |
| is_active | BOOLEAN | Trạng thái hoạt động |

### Bảng `apishopee_ads_budget_logs`
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| shop_id | BIGINT | ID shop |
| campaign_id | BIGINT | ID chiến dịch |
| schedule_id | UUID | FK đến schedule |
| old_budget | DECIMAL | Ngân sách cũ |
| new_budget | DECIMAL | Ngân sách mới |
| status | TEXT | 'success', 'failed', 'skipped' |
| error_message | TEXT | Thông báo lỗi (nếu có) |
| executed_at | TIMESTAMPTZ | Thời gian thực thi |

## Cron Job

### Schedule
- Chạy mỗi 30 phút (phút 0 và 30)
- Cron expression: `0,30 * * * *`

### Logic xử lý
```sql
-- Lấy schedules phù hợp với giờ hiện tại
SELECT * FROM apishopee_scheduled_ads_budget
WHERE is_active = true
  AND hour_start <= current_hour
  AND hour_end > current_hour
  AND (
    -- Hàng ngày
    (days_of_week IS NOT NULL AND current_day = ANY(days_of_week))
    OR
    -- Ngày cụ thể
    (specific_dates IS NOT NULL AND today = ANY(specific_dates))
  );
```

## Ví dụ sử dụng

### Tăng ngân sách hàng ngày lúc 8:00
1. Chọn chiến dịch "Khuyến mãi tháng 1"
2. Chọn "Hàng ngày"
3. Chọn khung giờ "08:00"
4. Nhập ngân sách "500.000"
5. Bấm "Tăng"

→ Mỗi ngày lúc 8:00, cron job sẽ tự động set ngân sách chiến dịch lên 500.000đ

### Giảm ngân sách vào ngày cụ thể
1. Chọn chiến dịch "Flash Sale"
2. Chọn "Ngày cụ thể" → chọn 20/01, 21/01
3. Chọn khung giờ "22:00"
4. Nhập ngân sách "100.000"
5. Bấm "Giảm"

→ Vào 22:00 ngày 20/01 và 21/01, cron job sẽ set ngân sách xuống 100.000đ
