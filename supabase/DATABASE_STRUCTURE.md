# Database Structure - Shopee Shop Manager

## Overview
Database đã được dọn dẹp và chỉ giữ lại các bảng cần thiết cho chức năng **Xác thực và Quản lý Shop Shopee**.

## Tables (5 bảng)

### 1. `sys_profiles`
**Mô tả:** Thông tin profile của user, liên kết với `auth.users`

**Columns:**
- `id` (uuid, PK) - User ID, foreign key to auth.users
- `email` (text, unique) - Email của user
- `full_name` (text, nullable) - Tên đầy đủ
- `phone` (text, nullable) - Số điện thoại
- `join_date` (date, nullable) - Ngày tham gia
- `created_at` (timestamptz) - Thời gian tạo
- `updated_at` (timestamptz) - Thời gian cập nhật

**Relationships:**
- Referenced by: `apishopee_shop_members.profile_id`
- References: `auth.users.id`

---

### 2. `apishopee_roles`
**Mô tả:** Vai trò của thành viên trong shop (admin, member)

**Columns:**
- `id` (uuid, PK) - Role ID
- `name` (text, unique) - Tên role (admin, member)
- `display_name` (text) - Tên hiển thị
- `description` (text, nullable) - Mô tả
- `permissions` (jsonb) - Danh sách quyền
- `created_at` (timestamptz) - Thời gian tạo
- `updated_at` (timestamptz) - Thời gian cập nhật

**Default Roles:**
- `admin` - Quản trị viên shop
- `member` - Thành viên shop

**Relationships:**
- Referenced by: `apishopee_shop_members.role_id`

---

### 3. `apishopee_shops`
**Mô tả:** Thông tin các shop Shopee được kết nối qua OAuth

**Columns:**
- `id` (uuid, PK) - Internal shop ID
- `shop_id` (bigint, unique) - Shopee shop ID
- `shop_name` (text, nullable) - Tên shop
- `shop_logo` (text, nullable) - Logo shop
- `region` (text) - Khu vực (VN, TH, SG, etc.)
- `access_token` (text, nullable) - Access token từ Shopee
- `refresh_token` (text, nullable) - Refresh token
- `expire_in` (int4) - Thời gian hết hạn token (giây)
- `expired_at` (bigint, nullable) - Timestamp hết hạn access token
- `access_token_expired_at` (bigint, nullable) - Timestamp hết hạn access token
- `merchant_id` (bigint, nullable) - Merchant ID
- `token_updated_at` (timestamptz, nullable) - Lần cuối cập nhật token
- `auth_time` (bigint, nullable) - Thời gian xác thực
- `expire_time` (bigint, nullable) - Thời gian hết hạn authorization (1 năm)
- `partner_id` (bigint, nullable) - Partner ID từ Shopee Open Platform
- `partner_key` (text, nullable) - Partner Key
- `partner_name` (text, nullable) - Tên partner
- `partner_created_by` (uuid, nullable) - User tạo partner
- `status` (text, nullable) - Trạng thái shop
- `description` (text, nullable) - Mô tả
- Shop flags (is_cb, is_sip, is_main_shop, etc.)
- `created_at` (timestamptz) - Thời gian tạo
- `updated_at` (timestamptz) - Thời gian cập nhật

**Relationships:**
- Referenced by: `apishopee_shop_members.shop_id`
- Referenced by: `apishopee_token_refresh_logs.shop_id`
- References: `auth.users.id` (partner_created_by)

---

### 4. `apishopee_shop_members`
**Mô tả:** Quan hệ giữa user và shop, xác định quyền truy cập

**Columns:**
- `id` (uuid, PK) - Member ID
- `shop_id` (uuid, FK) - Shop ID (references apishopee_shops.id)
- `profile_id` (uuid, FK) - User ID (references sys_profiles.id)
- `role_id` (uuid, FK) - Role ID (references apishopee_roles.id)
- `is_active` (boolean) - Trạng thái active
- `created_at` (timestamptz) - Thời gian tạo
- `updated_at` (timestamptz) - Thời gian cập nhật

**Relationships:**
- References: `apishopee_shops.id`
- References: `sys_profiles.id`
- References: `apishopee_roles.id`

**Business Logic:**
- Một user có thể là member của nhiều shop
- Một shop có thể có nhiều members
- Mỗi member có một role (admin hoặc member)

---

### 5. `apishopee_token_refresh_logs`
**Mô tả:** Log các lần refresh token tự động

**Columns:**
- `id` (uuid, PK) - Log ID
- `shop_id` (uuid, FK, nullable) - Shop ID
- `shopee_shop_id` (bigint, nullable) - Shopee shop ID
- `success` (boolean) - Refresh thành công hay không
- `error_message` (text, nullable) - Thông báo lỗi (nếu có)
- `old_token_expired_at` (bigint, nullable) - Thời gian hết hạn token cũ
- `new_token_expired_at` (bigint, nullable) - Thời gian hết hạn token mới
- `refresh_source` (text) - Nguồn refresh (auto, manual, api)
- `created_at` (timestamptz) - Thời gian tạo log

**Relationships:**
- References: `apishopee_shops.id`

**Refresh Sources:**
- `auto` - Tự động refresh bởi cron job
- `manual` - User refresh thủ công
- `api` - Refresh qua API call

---

## Entity Relationship Diagram

```
auth.users (Supabase Auth)
    ↓ (1:1)
sys_profiles
    ↓ (1:N)
apishopee_shop_members ←→ apishopee_roles
    ↓ (N:1)
apishopee_shops
    ↓ (1:N)
apishopee_token_refresh_logs
```

## Key Features

1. **Multi-shop Support**: Một user có thể quản lý nhiều shop
2. **Role-based Access**: Admin và member có quyền khác nhau
3. **OAuth Integration**: Kết nối shop qua Shopee OAuth
4. **Auto Token Refresh**: Tự động refresh token trước khi hết hạn
5. **Audit Trail**: Log tất cả các lần refresh token

## Security

- RLS (Row Level Security) được bật cho tất cả các bảng
- User chỉ có thể truy cập shop mà họ là member
- Admin có quyền quản lý members và xóa shop
- Token được mã hóa khi lưu trữ

## Migrations

Tất cả migrations được lưu trong `supabase/migrations/`
- Migration cuối cùng: `041_drop_campaigns_tables.sql`
