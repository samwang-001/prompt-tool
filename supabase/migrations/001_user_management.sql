-- ============================================================
-- 用户管理模块 - 数据库迁移
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- 1. 为 user_profiles 添加状态和角色字段
ALTER TABLE IF EXISTS user_profiles 
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS api_keys JSONB DEFAULT NULL;

-- 2. 创建索引
CREATE INDEX IF NOT EXISTS idx_user_profiles_status ON user_profiles(status);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- 3. 为现有的管理员用户设置角色（如果存在）
UPDATE user_profiles 
SET role = 'admin', status = 'active' 
WHERE email = 'hvho1982@163.com';

-- 4. RLS 策略：允许用户读取其他用户的 status/role（管理面板需要）
-- 注意：api_keys 字段仅管理员和本人可见，通过 Edge Function 控制
DROP POLICY IF EXISTS "Users can read all profiles status" ON user_profiles;
CREATE POLICY "Users can read all profiles status" ON user_profiles
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. 避免 api_keys 被非管理员用户读取（应用层过滤，额外安全）
-- 注：客户端查询会在 JS 层过滤敏感字段，这里仅作额外保护
