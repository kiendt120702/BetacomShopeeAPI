# Cải tiến Bảng Quản lý Quảng cáo

## Tổng quan
Đã cải tiến giao diện quản lý quảng cáo để tận dụng tối đa dữ liệu từ API Shopee và tạo trải nghiệm người dùng tốt hơn.

## Các cải tiến chính

### 1. **Dashboard Hiệu suất Tổng quan**
Thêm 8 thẻ metrics hiển thị dữ liệu real-time:
- **Hiển thị (Impressions)**: Số lần quảng cáo được hiển thị
- **Click**: Số lượt click vào quảng cáo
- **CTR (Click-Through Rate)**: Tỷ lệ click/hiển thị
- **Đơn hàng**: Số đơn hàng từ quảng cáo
- **Tỷ lệ chuyển đổi**: Tỷ lệ đơn hàng/click
- **Doanh thu (GMV)**: Tổng giá trị đơn hàng
- **Chi phí**: Tổng chi phí quảng cáo
- **ROAS (Return on Ad Spend)**: Tỷ suất lợi nhuận quảng cáo

Mỗi thẻ hiển thị:
- Giá trị hôm nay (từ hourly performance)
- Giá trị 7 ngày qua (từ daily performance)
- Màu sắc phân biệt theo loại metric

### 2. **Bảng Chiến dịch Cải tiến**
Bố cục mới với 5 cột rõ ràng:
- **Tên chiến dịch**: 
  - Tự động cắt ngắn nếu quá 60 ký tự (thêm "...")
  - Hover để xem tên đầy đủ
  - Hiển thị Campaign ID bên dưới
- **Loại / Phương thức**: 
  - Loại quảng cáo (Tự động/Thủ công)
  - Phương thức đấu giá (Auto/Manual)
- **Vị trí**: Nơi hiển thị quảng cáo (Tất cả/Tìm kiếm/Khám phá)
- **Ngân sách**: Định dạng tiền tệ VNĐ
- **Trạng thái**: Badge màu sắc theo trạng thái

### 3. **Tối ưu UX**
- Header cột với font chữ in hoa, đậm, dễ đọc
- Hover effect trên từng hàng
- Màu sắc phân biệt rõ ràng cho các trạng thái
- Responsive layout với minmax cho cột tên chiến dịch
- Scroll riêng cho bảng (max-height: 600px)

### 4. **Tích hợp Dữ liệu API**
Sử dụng đầy đủ dữ liệu từ các API:
- `get-campaign-id-list`: Danh sách campaign IDs
- `get-campaign-setting-info`: Chi tiết chiến dịch (tên, trạng thái, ngân sách, vị trí, phương thức)
- `get-hourly-performance`: Hiệu suất theo giờ (hôm nay)
- `get-daily-performance`: Hiệu suất theo ngày (7 ngày qua)

## Cấu trúc Code

### Components mới
```typescript
function PerformanceOverview({ data }: { data: PerformanceData })
```
- Tính toán metrics từ hourly và daily data
- Hiển thị 8 thẻ metrics với màu sắc phân biệt
- Responsive grid layout (2 cột mobile, 4 cột desktop)

### State mới
```typescript
const [performanceData, setPerformanceData] = useState<PerformanceData>({ 
  hourly: [], 
  daily: [] 
});
```

### Functions mới
```typescript
const loadPerformanceData = async () => { ... }
```
- Tự động load khi component mount
- Reload sau khi sync từ Shopee

## Kết quả
- ✅ Tận dụng 100% dữ liệu từ API
- ✅ Giao diện dễ nhìn, chuyên nghiệp
- ✅ Tên chiến dịch dài được xử lý tốt (truncate + hover)
- ✅ Metrics real-time giúp theo dõi hiệu suất
- ✅ Không có lỗi TypeScript
- ✅ Performance tốt với useMemo cho calculations
