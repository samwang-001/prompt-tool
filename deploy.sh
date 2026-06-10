#!/bin/bash
# 一键部署到 Cloudflare Pages（通过 Git 集成自动部署）
# 使用方法: bash deploy.sh

echo "🚀 正在推送到 GitHub 以触发 Cloudflare Pages 自动部署..."
cd "$(dirname "$0")"
git add -A
git commit -m "feat: 删除图片记录 + 修复 Puter.js 画质参数兼容 + 新增模型"
git push origin main
echo ""
echo "✅ 推送完成！Cloudflare Pages 正在自动构建..."
echo "🔗 访问地址: https://www.prompt-tool.dedyn.io"
echo "📋 构建状态: https://dash.cloudflare.com/?to=/:account/pages/view/prompt-tool"
