-- ============================================================
-- Supabase 多用户迁移 SQL
-- 在 Supabase SQL Editor 中执行此文件
-- ⚠️ 请先替换所有 hvho1982@163.com 为你的管理员邮箱
-- ============================================================

-- 1. 添加 user_id 列到已有表
ALTER TABLE formulas ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE thesaurus_categories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE thesaurus_words ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE version_snapshots ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- 2. 创建用户档案表（管理员用来列出所有用户）
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 启用所有表的 RLS（行级安全）
ALTER TABLE formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE thesaurus_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE thesaurus_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE version_snapshots ENABLE ROW LEVEL SECURITY;

-- 4. 创建 RLS 策略

-- 公式表：管理员全部权限
CREATE POLICY "admin_all_formulas" ON formulas FOR ALL 
USING (auth.email() = 'hvho1982@163.com')
WITH CHECK (auth.email() = 'hvho1982@163.com');

-- 公式表：普通用户只能访问自己的
CREATE POLICY "user_own_formulas" ON formulas FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 词库分类表：管理员全部权限
CREATE POLICY "admin_all_categories" ON thesaurus_categories FOR ALL 
USING (auth.email() = 'hvho1982@163.com')
WITH CHECK (auth.email() = 'hvho1982@163.com');

-- 词库分类表：普通用户只能访问自己的
CREATE POLICY "user_own_categories" ON thesaurus_categories FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 词库词汇表：管理员全部权限
CREATE POLICY "admin_all_words" ON thesaurus_words FOR ALL 
USING (auth.email() = 'hvho1982@163.com')
WITH CHECK (auth.email() = 'hvho1982@163.com');

-- 词库词汇表：普通用户只能访问自己的
CREATE POLICY "user_own_words" ON thesaurus_words FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 用户档案表：管理员全部权限
CREATE POLICY "admin_all_profiles" ON user_profiles FOR ALL 
USING (auth.email() = 'hvho1982@163.com')
WITH CHECK (auth.email() = 'hvho1982@163.com');

-- 用户档案表：普通用户只能读写自己的
CREATE POLICY "user_own_profile" ON user_profiles FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 版本快照表：管理员全部权限
CREATE POLICY "admin_all_snapshots" ON version_snapshots FOR ALL 
USING (auth.email() = 'hvho1982@163.com')
WITH CHECK (auth.email() = 'hvho1982@163.com');

-- 版本快照表：普通用户只能访问自己的
CREATE POLICY "user_own_snapshots" ON version_snapshots FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 5. 触发器：用户注册时自动创建 user_profiles 记录
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 删除旧的触发器（如果存在）
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 创建触发器
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 执行完成后，请确认：
-- 1. 所有 hvho1982@163.com 已替换为你的真实邮箱
-- 2. 在 Authentication → Settings 中启用 Email/Password provider
-- 3. 如需邮箱验证，在 Authentication → Settings 中可关闭 "Confirm email"
-- ============================================================
