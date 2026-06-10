#!/bin/bash
# Cloudflare Pages 自动部署（通过 Git 推送触发）
# 确保本地改动已 commit，执行此脚本推送到 GitHub 即可触发部署
# 使用方法: bash deploy.sh [commit message]

cd "$(dirname "$0")"

MSG=${1:-"deploy: update"}

echo "🚀 推送至 GitHub..."
git add -A
git commit -m "$MSG" || echo "（无新改动，跳过 commit）"
git push origin main
echo ""
echo "✅ 已推送！Cloudflare Pages 将自动构建部署"
echo "🔗 https://www.prompt-tool.dedyn.io"
