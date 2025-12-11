-- Tạo bảng lưu Shopee tokens
CREATE TABLE IF NOT EXISTS shopee_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id BIGINT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expire_in INTEGER NOT NULL,
  expired_at BIGINT NOT NULL,
  merchant_id BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index cho shop_id
CREATE INDEX IF NOT EXISTS idx_shopee_tokens_shop_id ON shopee_tokens(shop_id);

-- Index cho user_id
CREATE INDEX IF NOT EXISTS idx_shopee_tokens_user_id ON shopee_tokens(user_id);

-- Index cho expired_at (để query tokens sắp hết hạn)
CREATE INDEX IF NOT EXISTS idx_shopee_tokens_expired_at ON shopee_tokens(expired_at);

-- RLS policies
ALTER TABLE shopee_tokens ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own tokens
CREATE POLICY "Users can view own tokens" ON shopee_tokens
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can insert their own tokens
CREATE POLICY "Users can insert own tokens" ON shopee_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own tokens
CREATE POLICY "Users can update own tokens" ON shopee_tokens
  FOR UPDATE USING (auth.uid() = user_id);

-- Policy: Service role can do everything (for Edge Functions)
CREATE POLICY "Service role full access" ON shopee_tokens
  FOR ALL USING (auth.role() = 'service_role');
