#!/bin/bash
# 一键部署到 Netlify
# 使用方法: bash deploy.sh

echo "🚀 正在部署到 Netlify..."
cd "$(dirname "$0")"
npx netlify-cli deploy --prod --dir=.
echo ""
echo "✅ 部署完成！"
echo "🔗 访问地址: https://www.prompt-tool.dedyn.io"
