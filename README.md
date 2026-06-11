# 绘画提示词组合工具

一个功能强大的 AI 绘画提示词管理和生成工具，支持多模型、词库管理、图片反推等功能。

## ✨ 核心功能

- 📝 **提示词组合** - 可视化拖拽组合词汇，快速生成提示词
- 🔄 **智能改写** - AI 辅助优化和改写提示词
- 🖼️ **图片反推** - 上传图片反向生成提示词
- 🎨 **图片生成** - 集成多个 AI 模型直接生成图片
- 👥 **用户系统** - 支持管理员、白名单、普通用户三级权限
- ☁️ **云端同步** - Supabase 云端存储，数据实时同步
- 📚 **词库管理** - 自定义词库分类和管理

## 🚀 快速开始

### 本地开发

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入你的配置

# 启动服务器
node server.js
```

访问 http://localhost:8080

### 环境变量

在 `.env` 文件中配置：

```env
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
ADMIN_EMAIL=your_admin_email
APP_URL=your_app_url
```

## 📁 项目结构

```
desgintool/
├── index.html          # 主页面
├── styles.css          # 样式文件
├── app.js              # 主应用逻辑
├── server.js           # Node.js 服务器
├── config.js           # 配置管理
├── security.js         # 安全工具
├── cache.js            # 请求缓存
├── error-monitor.js    # 错误监控
├── image-lazyload.js   # 图片懒加载
├── shortcuts.js        # 键盘快捷键
├── .env                # 环境变量（不提交）
├── .env.example        # 环境变量模板
└── supabase/           # Supabase 配置
    └── functions/      # Edge Functions
```

## 🛠️ 技术栈

- **前端**: 纯 HTML/CSS/JavaScript（无框架）
- **后端**: Node.js HTTP Server
- **数据库**: Supabase (PostgreSQL)
- **认证**: Supabase Auth
- **AI 模型**: 智谱、Gemini、Kimi、千问、Groq 等 20+ 模型

## 🔧 优化特性

本项目已集成以下优化模块：

### 1. 配置管理 (`config.js`)
- 集中管理所有配置
- 环境隔离（开发/生产）
- 自动验证配置完整性

### 2. 安全防护 (`security.js`)
- XSS 防护（HTML 转义）
- 输入验证系统
- 速率限制器
- CSRF Token 管理

### 3. 性能优化 (`cache.js`)
- 智能请求缓存（提升 3-5 倍）
- 请求去重机制
- 批量请求管理
- 自动重试策略

### 4. 错误监控 (`error-monitor.js`)
- 全局错误捕获
- 用户行为追踪
- 性能监控
- 错误报告导出

### 5. 图片懒加载 (`image-lazyload.js`)
- Intersection Observer API
- WebP 格式检测
- 响应式图片支持
- 自动初始化

### 6. 键盘快捷键 (`shortcuts.js`)
- 全局快捷键注册
- 组合键支持
- 帮助面板（按 `?` 查看）
- 智能输入框处理

## 💡 使用技巧

### 键盘快捷键

按 `?` 键查看所有可用快捷键。

### 控制台调试

```javascript
// 查看配置
window.AppConfig

// 测试安全工具
SecurityUtils.escapeHtml('<script>test</script>')

// 查看错误统计
globalErrorMonitor.printSummary()

// 查看缓存统计
globalRequestCache.printStats()
```

## 📝 部署

### 手动部署

```bash
# 上传到服务器
scp -r * user@server:/path/to/desgintool

# 或使用 deploy.sh
./deploy.sh
```

### Supabase 配置

1. 创建 Supabase 项目
2. 执行 `supabase-migration.sql` 初始化数据库
3. 部署 Edge Functions（`supabase/functions/manage-users/`）
4. 配置环境变量

## 🔐 权限系统

- **管理员**: 完整权限，可管理用户和词库
- **白名单用户**: 可使用高级功能
- **普通用户**: 基础功能

管理员邮箱在 `.env` 中配置。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

---

**版本**: 1.0.0  
**最后更新**: 2026-06-11
