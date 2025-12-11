-- Migration: Tạo bảng profiles và user_shops
-- Lưu thông tin user và liên kết với shop Shopee

-- Bảng profiles - thông tin user mở rộng
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng user_shops - liên kết user với shop Shopee
CREATE TABLE IF NOT EXISTS user_shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id BIGINT NOT NULL,
  shop_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expired_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Mỗi user chỉ có 1 record cho mỗi shop
  UNIQUE(user_id, shop_id)
);

-- Index để query nhanh
CREATE INDEX IF NOT EXISTS idx_user_shops_user_id ON user_shops(user_id);
CREATE INDEX IF NOT EXISTS idx_user_shops_shop_id ON user_shops(shop_id);

-- RLS (Row Level Security) - User chỉ xem được data của mình
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_shops ENABLE ROW LEVEL SECURITY;

-- Policy cho profiles
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Policy cho user_shops
CREATE POLICY "Users can view own shops" ON user_shops
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own shops" ON user_shops
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shops" ON user_shops
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own shops" ON user_shops
  FOR DELETE USING (auth.uid() = user_id);

-- Function tự động tạo profile khi user đăng ký
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger tạo profile khi có user mới
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Function cập nhật updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger cập nhật updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_user_shops_updated_at
  BEFORE UPDATE ON user_shops
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
