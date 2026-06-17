# 🚀 线上部署指南

## 📋 当前配置状态

### ✅ 已完成的配置

1. **Supabase 配置**
   - URL: `https://aishmynicfrueempsbun.supabase.co`
   - Anon Key: 已配置（见 app.js 第 4 行）
   - Admin Email: `hvho1982@163.com`

2. **应用 URL**
   - 线上域名: `https://www.prompt-tool.dedyn.io`
   - 本地开发: `http://localhost:8080`

3. **环境检测**
   - 自动识别开发/生产环境
   - 开发环境使用代理 `/api/manage-users`
   - 生产环境直接调用 Supabase Edge Function

4. **Edge Function**
   - URL: `https://aishmynicfrueempsbun.supabase.co/functions/v1/manage-users`
   - CORS: 已配置允许所有域名 (`Access-Control-Allow-Origin: *`)
   - 功能: 用户管理、密码重置、白名单管理等

---

## 🎯 部署方式选择

### 方案 A：静态托管（推荐）⭐

适用于 Cloudflare Pages、Vercel、Netlify、GitHub Pages 等静态托管平台。

#### 优点
- ✅ 无需维护服务器
- ✅ 自动 CDN 加速
- ✅ 免费额度充足
- ✅ 自动 HTTPS

#### 部署步骤

1. **准备文件**
   ```
   需要上传的文件：
   ├── index.html          # 入口页面
   ├── app.js              # 前端逻辑
   ├── styles.css          # 样式文件
   ├── config.js           # 配置管理
   ├── security.js         # 安全模块
   ├── cache.js            # 缓存模块
   ├── error-monitor.js    # 错误监控
   ├── image-lazyload.js   # 图片懒加载
   └── shortcuts.js        # 快捷键
   
   不需要上传：
   ├── server.js           # ❌ 仅本地开发用
   ├── .env                # ❌ 敏感信息
   ├── node_modules/       # ❌ 依赖目录
   └── supabase/           # ❌ Edge Function 源码
   ```

2. **Cloudflare Pages 部署**
   ```bash
   # 安装 Wrangler CLI
   npm install -g wrangler
   
   # 登录
   wrangler login
   
   # 部署
   wrangler pages deploy . --project-name=prompt-tool
   ```

3. **Vercel 部署**
   ```bash
   # 安装 Vercel CLI
   npm install -g vercel
   
   # 登录
   vercel login
   
   # 部署
   vercel --prod
   ```

4. **配置自定义域名**
   - 在托管平台添加域名 `www.prompt-tool.dedyn.io`
   - 在 DNS 服务商配置 CNAME 记录指向托管平台

---

### 方案 B：Node.js 服务器部署

适用于自有服务器或 VPS。

#### 优点
- ✅ 完全控制
- ✅ 可自定义中间件
- ✅ 支持 SSR

#### 缺点
- ⚠️ 需要维护服务器
- ⚠️ 需要配置 SSL 证书
- ⚠️ 需要处理负载均衡

#### 部署步骤

1. **安装 Node.js**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # CentOS/RHEL
   curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
   sudo yum install -y nodejs
   ```

2. **上传文件到服务器**
   ```bash
   scp -r /local/path/desgintool user@server:/var/www/prompt-tool
   ```

3. **安装依赖**
   ```bash
   cd /var/www/prompt-tool
   npm install
   ```

4. **启动服务**
   ```bash
   # 前台运行（测试）
   node server.js
   
   # 后台运行（生产）
   nohup node server.js > server.log 2>&1 &
   
   # 或使用 PM2（推荐）
   npm install -g pm2
   pm2 start server.js --name prompt-tool
   pm2 save
   pm2 startup
   ```

5. **配置 Nginx 反向代理**
   ```nginx
   server {
       listen 80;
       server_name www.prompt-tool.dedyn.io;
       
       location / {
           proxy_pass http://localhost:8080;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   
   # HTTPS 配置（使用 Let's Encrypt）
   server {
       listen 443 ssl http2;
       server_name www.prompt-tool.dedyn.io;
       
       ssl_certificate /etc/letsencrypt/live/www.prompt-tool.dedyn.io/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/www.prompt-tool.dedyn.io/privkey.pem;
       
       location / {
           proxy_pass http://localhost:8080;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

6. **配置 SSL 证书**
   ```bash
   # 安装 Certbot
   sudo apt-get install certbot python3-certbot-nginx
   
   # 获取证书
   sudo certbot --nginx -d www.prompt-tool.dedyn.io
   
   # 自动续期
   sudo crontab -e
   # 添加：0 0,12 * * * /usr/bin/certbot renew --quiet
   ```

---

## 🔍 验证部署

### 1. 检查环境检测日志

打开浏览器控制台（F12），应该看到：

**本地开发环境：**
```
[App] 环境: 开发 | 域名: localhost | Edge Function: /api/manage-users
```

**线上生产环境：**
```
[App] 环境: 生产 | 域名: www.prompt-tool.dedyn.io | Edge Function: https://aishmynicfrueempsbun.supabase.co/functions/v1/manage-users
```

### 2. 测试用户管理功能

1. 登录管理员账户
2. 打开管理员面板
3. 尝试以下操作：
   - ✅ 加载用户列表
   - ✅ 创建白名单用户
   - ✅ 发送密码重置邮件
   - ✅ 删除用户

### 3. 检查网络请求

打开浏览器开发者工具 → Network 标签：

**本地开发：**
- 请求 URL: `http://localhost:8080/api/manage-users`
- 状态码: 200

**线上生产：**
- 请求 URL: `https://aishmynicfrueempsbun.supabase.co/functions/v1/manage-users`
- 状态码: 200

---

## ⚠️ 常见问题排查

### 问题 1：CORS 错误

**症状：**
```
Access to fetch at 'https://aishmynicfrueempsbun.supabase.co/functions/v1/manage-users' 
from origin 'https://www.prompt-tool.dedyn.io' has been blocked by CORS policy
```

**解决方案：**
1. 检查 Edge Function 的 CORS 配置（已配置为 `*`）
2. 重新部署 Edge Function：
   ```bash
   cd supabase
   supabase functions deploy manage-users
   ```

### 问题 2：401 未授权

**症状：**
```json
{ "error": "未授权，请先登录" }
```

**解决方案：**
1. 确认用户已登录
2. 检查 Supabase Session 是否有效
3. 查看控制台是否有 token 过期警告

### 问题 3：403 禁止访问

**症状：**
```json
{ "error": "仅管理员可执行此操作" }
```

**解决方案：**
1. 确认登录邮箱是 `hvho1982@163.com`
2. 检查 user_profiles 表中的 role 字段是否为 `admin`

### 问题 4：网络超时

**症状：**
```
Failed to fetch
NetworkError when attempting to fetch resource
```

**解决方案：**
1. 检查网络连接
2. 检查防火墙设置
3. 尝试切换网络（WiFi/移动数据）
4. 检查 Supabase 服务状态：https://status.supabase.com

---

## 📊 性能优化建议

### 1. 启用 CDN 缓存

在 Cloudflare/Vercel 等平台启用缓存策略：

```
静态资源（.js, .css, .html）: Cache-Control: public, max-age=3600
API 请求: Cache-Control: no-cache
```

### 2. 压缩资源

启用 Gzip/Brotli 压缩：

```nginx
# Nginx 配置
gzip on;
gzip_types text/plain text/css application/javascript application/json;
gzip_min_length 1000;
```

### 3. 图片优化

- 使用 WebP 格式
- 启用懒加载（已实现）
- 使用 CDN 加速

---

## 🔄 更新部署

### 静态托管平台

```bash
# Cloudflare Pages
wrangler pages deploy . --project-name=prompt-tool

# Vercel
vercel --prod

# Netlify
netlify deploy --prod
```

### Node.js 服务器

```bash
# 拉取最新代码
cd /var/www/prompt-tool
git pull origin main

# 重启服务
pm2 restart prompt-tool

# 查看日志
pm2 logs prompt-tool
```

---

## 📞 技术支持

如遇到问题，请提供以下信息：

1. **环境信息**
   - 部署方式（静态托管 / Node.js 服务器）
   - 浏览器版本
   - 操作系统

2. **错误信息**
   - 控制台完整输出（截图）
   - Network 标签的请求详情
   - 具体的错误消息

3. **复现步骤**
   - 详细操作步骤
   - 预期结果 vs 实际结果

---

## ✅ 部署清单

- [ ] 代码已推送到 GitHub
- [ ] 静态文件已上传到托管平台 / Node.js 服务器已启动
- [ ] 自定义域名已配置并解析
- [ ] SSL 证书已安装（HTTPS）
- [ ] 环境检测日志正常显示
- [ ] 用户管理功能测试通过
- [ ] CORS 配置正确
- [ ] 性能优化已启用

---

**最后更新时间：** 2026-06-11  
**维护者：** hvho1982@163.com
