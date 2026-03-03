#!/usr/bin/env bash
set -euo pipefail

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✖${NC} $*"; exit 1; }

# ── 1. 检查工作区 ──
info "检查工作区..."
if [[ -n "$(git status --porcelain)" ]]; then
  fail "工作区不干净，请先提交所有变更"
fi
ok "工作区干净"

# ── 2. 当前版本 ──
CURRENT=$(node -p "require('./package.json').version")
info "当前版本: ${CYAN}${CURRENT}${NC}"

# ── 3. 选择版本类型 ──
echo ""
echo "  1) patch  — bug 修复、小改进"
echo "  2) minor  — 新功能"
echo "  3) major  — 破坏性变更"
echo ""
read -rp "选择版本类型 [1/2/3] (默认 1): " choice
choice=${choice:-1}

case "$choice" in
  1) BUMP="patch" ;;
  2) BUMP="minor" ;;
  3) BUMP="major" ;;
  *) fail "无效选择: $choice" ;;
esac

# ── 4. Bump 版本 ──
npm version "$BUMP" --no-git-tag-version > /dev/null
NEW_VERSION=$(node -p "require('./package.json').version")
ok "版本: ${CURRENT} → ${GREEN}${NEW_VERSION}${NC}"

# ── 5. 提交版本号 ──
git add package.json
git commit -m "$NEW_VERSION" --quiet
ok "已提交版本号"

# ── 6. 发布到 npm ──
info "发布到 npm..."
read -rp "输入 OTP 验证码 (无 2FA 直接回车): " otp

if [[ -n "$otp" ]]; then
  npm publish --otp="$otp"
else
  npm publish
fi
ok "npm 发布成功: claude-paw@${NEW_VERSION}"

# ── 7. 推送到 GitHub ──
info "推送到 GitHub..."
git push origin main
ok "已推送到 origin/main"

echo ""
echo -e "${GREEN}🎉 发布完成: claude-paw@${NEW_VERSION}${NC}"
