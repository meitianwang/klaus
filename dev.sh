#!/usr/bin/env bash
# Klaus 桌面端开发启动脚本
#
# 解决几个反复踩到的坑：
#   1. 旧的 Electron 主进程 / Helper / tsup --watch 没死干净，新启动看到空白窗口
#   2. 仓根 npm run dev 跑的是 web 端（tsx src/index.ts），不是 Electron
#   3. node_modules 缺失 / .electron-dev 没初始化
#   4. Ctrl+C 后 Electron + tsup 不会跟着死，下次再跑还是脏的
#
# 用法（仓根目录）：./dev.sh
#                    bash dev.sh
#                    bash dev.sh --no-install   # 跳过依赖自动安装

set -euo pipefail

# ============================================================
# 配置
# ============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ELECTRON_DIR="$SCRIPT_DIR/apps/electron"
APP_NAME="Klaus-Dev"

SKIP_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --no-install) SKIP_INSTALL=1 ;;
    -h|--help)
      cat <<'EOF'
Klaus 桌面端开发启动器

用法：
  ./dev.sh                启动（必要时自动安装依赖）
  ./dev.sh --no-install   跳过依赖自动安装
  ./dev.sh -h | --help    显示这条帮助

行为：
  1. 强制清理残留 Electron 主进程 / Helper / tsup --watch
  2. cd apps/electron 跑 npm run dev
  3. Ctrl+C 退出时连带 kill Electron + tsup
EOF
      exit 0 ;;
    *)
      printf '未知参数：%s（用 --help 看用法）\n' "$arg" >&2
      exit 2 ;;
  esac
done

# ============================================================
# 终端着色（仅在 stdout 是 TTY 时启用，避免污染日志重定向）
# ============================================================
if [[ -t 1 ]]; then
  C_RED=$'\033[0;31m'; C_YEL=$'\033[0;33m'; C_GRN=$'\033[0;32m'; C_BLU=$'\033[0;34m'; C_RST=$'\033[0m'
else
  C_RED=''; C_YEL=''; C_GRN=''; C_BLU=''; C_RST=''
fi
log()  { printf '%s[klaus]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
warn() { printf '%s[klaus]%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
err()  { printf '%s[klaus]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }
ok()   { printf '%s[klaus]%s %s\n' "$C_GRN" "$C_RST" "$*"; }

# ============================================================
# 前置检查
# ============================================================
if [[ ! -d "$ELECTRON_DIR" ]]; then
  err "找不到 $ELECTRON_DIR"
  err "请确认这个脚本放在 klaus 仓根目录"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  err "未检测到 npm，请先安装 Node.js（建议 >= 18）"
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  warn "当前系统：$(uname -s) — apps/electron/package.json 的 dev 脚本写死了 macOS .app bundle 路径"
  warn "Linux/Windows 上请直接 cd apps/electron && npx electron ."
fi

# ============================================================
# 进程清理：先 SIGTERM 给 1 秒优雅退出，仍存活再 SIGKILL
# pgrep -f 在 macOS BSD 上用法略有不同，这里只用 pgrep -f <pattern>
# ============================================================
kill_by_pattern() {
  local pattern="$1" label="$2"
  local pids
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  [[ -z "$pids" ]] && return 0
  warn "清理 ${label}：$(echo "$pids" | tr '\n' ' ')"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -TERM "$pid" 2>/dev/null || true
  done <<< "$pids"
  # 等优雅退出
  local waited=0
  while [[ $waited -lt 10 ]]; do
    pids=$(pgrep -f "$pattern" 2>/dev/null || true)
    [[ -z "$pids" ]] && return 0
    sleep 0.1
    waited=$((waited + 1))
  done
  # 还活着就强杀
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -9 "$pid" 2>/dev/null || true
  done <<< "$pids"
}

cleanup_processes() {
  # 注意：pattern 里 \. 在 ERE 里转义点号，避免误杀其他进程
  kill_by_pattern "$APP_NAME\\.app/Contents/MacOS/Electron" "Electron 主进程"
  kill_by_pattern "$APP_NAME\\.app/Contents/Frameworks/Electron Helper" "Electron Helper"
  kill_by_pattern "tsup --watch" "tsup --watch"
}

cleanup_processes
ok "残留进程已清理"

# ============================================================
# 依赖检查：仓根 + apps/electron 各一份 node_modules
# 用 .package-lock 简单存在性检查，不强求版本一致
# ============================================================
ensure_deps() {
  local dir="$1" label="$2"
  if [[ ! -d "$dir/node_modules" ]]; then
    if [[ $SKIP_INSTALL -eq 1 ]]; then
      err "$label 缺 node_modules，但 --no-install 已传入"
      exit 1
    fi
    warn "$label 缺 node_modules，执行 npm install ..."
    if ! (cd "$dir" && npm install); then
      err "$label npm install 失败"
      exit 1
    fi
  fi
}
ensure_deps "$SCRIPT_DIR" "仓根"
ensure_deps "$ELECTRON_DIR" "apps/electron"

# ============================================================
# 启动 + 退出 trap
# 用 background 启动 + wait，这样 trap 能在 Ctrl+C 时有机会清理。
# 直接 exec 会替换进程，trap 不再生效。
# ============================================================
DEV_PID=

cleanup_on_exit() {
  local code=$?
  # 取消 trap 防止递归
  trap '' INT TERM EXIT
  echo
  warn "停止开发服务..."
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill -TERM "$DEV_PID" 2>/dev/null || true
    # 等 npm 进程下属链路自然退出最多 2 秒
    local waited=0
    while [[ $waited -lt 20 ]] && kill -0 "$DEV_PID" 2>/dev/null; do
      sleep 0.1
      waited=$((waited + 1))
    done
    kill -9 "$DEV_PID" 2>/dev/null || true
  fi
  # 不管 npm 怎么退的，最终再扫一遍确保 Electron / Helper / tsup 都没了
  cleanup_processes
  exit "$code"
}
trap cleanup_on_exit INT TERM EXIT

ok "启动 Klaus 桌面端开发模式（cwd=${ELECTRON_DIR}）"
cd "$ELECTRON_DIR"

# npm run dev 内部：setup:electron-dev → tsup（一次性 bundle）→ Electron & + tsup --watch
# 任何一步失败都会让 npm 退出非 0，trap 兜底清理。
npm run dev &
DEV_PID=$!

# 阻塞等 npm 主进程退出 —— 用户 Ctrl+C 时 wait 会被信号中断，跳到 trap
wait "$DEV_PID" || true
