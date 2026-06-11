#!/bin/bash
# 绘画提示词组合工具 - 部署脚本
# 支持多种部署方式：Cloudflare Pages / VPS / 手动打包

set -e  # 遇到错误立即退出

cd "$(dirname "$0")"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印函数
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 显示帮助信息
show_help() {
    echo "使用方法: bash deploy.sh [选项]"
    echo ""
    echo "选项:"
    echo "  cloudflare    推送到 GitHub 触发 Cloudflare Pages 自动部署（默认）"
    echo "  vps           打包并上传到 VPS 服务器"
    echo "  package       仅打包项目文件"
    echo "  check         检查部署前置条件"
    echo "  help          显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  bash deploy.sh                    # 使用默认方式（cloudflare）"
    echo "  bash deploy.sh cloudflare         # 推送到 Cloudflare Pages"
    echo "  bash deploy.sh vps                # 部署到 VPS"
    echo "  bash deploy.sh package            # 仅打包"
    echo "  bash deploy.sh check              # 检查前置条件"
}

# 检查前置条件
check_prerequisites() {
    print_info "检查部署前置条件..."
    echo ""
    
    # 检查 Git
    if ! command -v git &> /dev/null; then
        print_error "Git 未安装"
        exit 1
    fi
    print_success "Git 已安装: $(git --version)"
    
    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js 未安装"
        exit 1
    fi
    print_success "Node.js 已安装: $(node --version)"
    
    # 检查 .env 文件
    if [ ! -f ".env" ]; then
        print_warning ".env 文件不存在，从 .env.example 复制"
        cp .env.example .env
        print_warning "请编辑 .env 文件填入正确的配置"
        exit 1
    fi
    print_success ".env 文件存在"
    
    # 检查关键文件
    local required_files=("app.js" "index.html" "styles.css" "server.js" "config.js")
    for file in "${required_files[@]}"; do
        if [ ! -f "$file" ]; then
            print_error "缺少必要文件: $file"
            exit 1
        fi
    done
    print_success "所有必要文件都存在"
    
    # 检查 Git 状态
    if [ -z "$(git status --porcelain)" ]; then
        print_success "工作区干净"
    else
        print_warning "工作区有未提交的更改"
        git status --short
    fi
    
    echo ""
    print_success "✅ 前置检查通过！"
}

# Cloudflare Pages 部署
deploy_cloudflare() {
    local msg=${1:-"deploy: update"}
    
    print_info "准备部署到 Cloudflare Pages..."
    echo ""
    
    # 添加所有更改
    git add -A
    
    # 提交
    if git diff --cached --quiet; then
        print_warning "没有新的更改需要提交"
    else
        git commit -m "$msg"
        print_success "已提交: $msg"
    fi
    
    # 推送
    print_info "推送到 GitHub..."
    git push origin main
    
    echo ""
    print_success "✅ 已推送到 GitHub！"
    print_info "Cloudflare Pages 将自动构建部署"
    print_info "🔗 访问地址: https://www.prompt-tool.dedyn.io"
    echo ""
    print_info "可以在这里查看部署状态:"
    print_info "https://dash.cloudflare.com/?to=/:account/pages/view/prompt-tool"
}

# VPS 部署
deploy_vps() {
    print_info "准备部署到 VPS..."
    echo ""
    
    # 读取 VPS 配置（可以从环境变量或配置文件读取）
    local VPS_USER=${VPS_USER:-"root"}
    local VPS_HOST=${VPS_HOST:-"your-server.com"}
    local VPS_PORT=${VPS_PORT:-"22"}
    local VPS_PATH=${VPS_PATH:-"/var/www/prompt-tool"}
    
    print_warning "VPS 部署需要配置以下环境变量:"
    echo "  VPS_USER   : SSH 用户名 (默认: root)"
    echo "  VPS_HOST   : 服务器地址"
    echo "  VPS_PORT   : SSH 端口 (默认: 22)"
    echo "  VPS_PATH   : 部署路径 (默认: /var/www/prompt-tool)"
    echo ""
    
    read -p "是否继续？(y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "取消部署"
        exit 0
    fi
    
    # 创建临时打包文件
    local temp_dir=$(mktemp -d)
    local project_name="prompt-tool-$(date +%Y%m%d-%H%M%S)"
    
    print_info "打包项目文件..."
    
    # 复制必要文件（排除不必要的目录）
    rsync -av --exclude='node_modules' \
               --exclude='.git' \
               --exclude='.playwright-cli' \
               --exclude='*.tar.gz' \
               --exclude='.DS_Store' \
               ./ "$temp_dir/$project_name/"
    
    # 压缩
    cd "$temp_dir"
    tar -czf "$project_name.tar.gz" "$project_name/"
    
    print_success "打包完成: $temp_dir/$project_name.tar.gz"
    
    # 上传到 VPS
    print_info "上传到 VPS ($VPS_USER@$VPS_HOST:$VPS_PATH)..."
    scp -P "$VPS_PORT" "$project_name.tar.gz" "$VPS_USER@$VPS_HOST:/tmp/"
    
    # 在 VPS 上解压和部署
    print_info "在 VPS 上部署..."
    ssh -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" << EOF
        mkdir -p $VPS_PATH
        cd $VPS_PATH
        tar -xzf /tmp/$project_name.tar.gz --strip-components=1
        rm /tmp/$project_name.tar.gz
        
        # 安装依赖
        npm install --production
        
        # 重启服务（根据您的实际配置调整）
        pm2 restart prompt-tool || pm2 start server.js --name prompt-tool
EOF
    
    # 清理临时文件
    rm -rf "$temp_dir"
    
    echo ""
    print_success "✅ VPS 部署完成！"
    print_info "访问地址: http://$VPS_HOST"
}

# 仅打包
package_only() {
    print_info "打包项目文件..."
    echo ""
    
    local project_name="prompt-tool-$(date +%Y%m%d-%H%M%S)"
    
    # 创建打包目录
    mkdir -p "dist/$project_name"
    
    # 复制文件（排除不必要的目录）
    rsync -av --exclude='node_modules' \
               --exclude='.git' \
               --exclude='.playwright-cli' \
               --exclude='*.tar.gz' \
               --exclude='.DS_Store' \
               --exclude='dist' \
               ./ "dist/$project_name/"
    
    # 压缩
    cd dist
    tar -czf "$project_name.tar.gz" "$project_name/"
    
    echo ""
    print_success "✅ 打包完成！"
    print_info "文件位置: dist/$project_name.tar.gz"
    print_info "文件大小: $(du -sh "$project_name.tar.gz" | cut -f1)"
}

# 主逻辑
main() {
    local command=${1:-"cloudflare"}
    
    echo "========================================"
    echo "  绘画提示词组合工具 - 部署脚本"
    echo "========================================"
    echo ""
    
    case "$command" in
        cloudflare)
            check_prerequisites
            echo ""
            deploy_cloudflare "${2:-deploy: update}"
            ;;
        vps)
            check_prerequisites
            echo ""
            deploy_vps
            ;;
        package)
            package_only
            ;;
        check)
            check_prerequisites
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            print_error "未知命令: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"
