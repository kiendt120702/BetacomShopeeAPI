# BETACOM - Shopee Shop Manager (Next.js)

Dự án đã được chuyển đổi từ **Vite + React** sang **Next.js 16** với App Router.

## 🚀 Bắt đầu

### 1. Cài đặt dependencies

```bash
cd nextjs-app
pnpm install
```

### 2. Cấu hình Environment Variables

Tạo file `.env.local` trong thư mục `nextjs-app`:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here

# Shopee API Configuration
NEXT_PUBLIC_SHOPEE_PARTNER_ID=123456
NEXT_PUBLIC_SHOPEE_PARTNER_KEY=your_partner_key_here
NEXT_PUBLIC_SHOPEE_CALLBACK_URL=http://localhost:3000/auth/callback

# Optional
NEXT_PUBLIC_SHOPEE_SHOP_ID=
NEXT_PUBLIC_TOKEN_ENCRYPTION_KEY=your_encryption_key_here
```

### 3. Chạy ứng dụng

```bash
pnpm run dev
```

Truy cập http://localhost:3000

## 📁 Cấu trúc dự án

```
nextjs-app/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (dashboard)/        # Layout group cho các trang dashboard
│   │   │   ├── layout.tsx      # Layout với sidebar navigation
│   │   │   ├── dashboard/      # Trang tổng quan
│   │   │   ├── flash-sale/     # Quản lý Flash Sale
│   │   │   ├── ads/            # Quản lý quảng cáo
│   │   │   └── profile/        # Thông tin tài khoản
│   │   ├── auth/               # Trang đăng nhập/đăng ký
│   │   │   └── callback/       # OAuth callback
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Homepage (redirect to /dashboard)
│   │   ├── providers.tsx       # React Query, Theme providers
│   │   └── globals.css         # Global styles + Tailwind
│   ├── components/             # UI Components
│   │   ├── ui/                 # Shadcn UI components
│   │   ├── panels/             # Dashboard panels
│   │   └── profile/            # Profile components
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Utilities và services
│   │   ├── shopee/             # Shopee SDK integration
│   │   └── supabase.ts         # Supabase client
│   └── utils/                  # Helper functions
├── public/                     # Static assets
└── package.json
```

## 🔄 Thay đổi so với Vite

| Vite                          | Next.js                              |
|-------------------------------|--------------------------------------|
| `react-router-dom`            | App Router (folder-based routing)    |
| `import.meta.env.VITE_*`      | `process.env.NEXT_PUBLIC_*`          |
| `BrowserRouter`               | Built-in navigation                  |
| `index.html`                  | `layout.tsx`                         |
| Client-side only              | SSR + Client components              |

## 📝 Lưu ý quan trọng

1. **Environment Variables**: Đổi từ `VITE_*` sang `NEXT_PUBLIC_*`
2. **Client Components**: Các component sử dụng hooks (useState, useEffect...) cần thêm `"use client"` ở đầu file
3. **Routing**: Sử dụng `useRouter` từ `next/navigation` thay vì `react-router-dom`
4. **Images**: Sử dụng `next/image` để tối ưu hình ảnh (tùy chọn)

## 🛠 Commands

```bash
# Development
pnpm dev

# Build
pnpm build

# Start production
pnpm start

# Lint
pnpm lint
```

## 📚 Tài liệu tham khảo

- [Next.js Documentation](https://nextjs.org/docs)
- [App Router](https://nextjs.org/docs/app)
- [Supabase](https://supabase.com/docs)
- [Shopee Open Platform](https://open.shopee.com)
