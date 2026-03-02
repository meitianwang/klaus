#!/usr/bin/env bash
# Clink installer — curl -fsSL https://raw.githubusercontent.com/xxx/clink/main/install.sh | bash
set -euo pipefail

CLINK_DIR="${CLINK_INSTALL_DIR:-$HOME/.clink/app}"
REPO_URL="${CLINK_REPO:-https://github.com/meitianwang/clink.git}"

# ── Colors ──────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BOLD}$*${NC}"; }
ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
warn()  { echo -e "  ${YELLOW}!${NC} $*"; }
fail()  { echo -e "  ${RED}✗${NC} $*"; exit 1; }

# ── Prerequisites ───────────────────────────
info "\n── Clink Installer ──────────────────────\n"

# Python >= 3.10
if command -v python3 &>/dev/null; then
    PY="python3"
elif command -v python &>/dev/null; then
    PY="python"
else
    fail "Python not found. Install Python 3.10+ first."
fi

PY_VERSION=$($PY -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$($PY -c "import sys; print(sys.version_info.major)")
PY_MINOR=$($PY -c "import sys; print(sys.version_info.minor)")

if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]; }; then
    fail "Python $PY_VERSION found, but need >= 3.10"
fi
ok "Python $PY_VERSION"

# git
command -v git &>/dev/null || fail "git not found. Install git first."
ok "git"

# Claude Code CLI
if command -v claude &>/dev/null; then
    ok "Claude Code CLI"
else
    warn "Claude Code CLI not found. Install later: npm i -g @anthropic-ai/claude-code"
fi

# ── Clone / Update ──────────────────────────
info "\nInstalling Clink to $CLINK_DIR ...\n"

if [ -d "$CLINK_DIR/.git" ]; then
    info "Updating existing installation..."
    git -C "$CLINK_DIR" pull --ff-only -q
    ok "Updated"
else
    mkdir -p "$(dirname "$CLINK_DIR")"
    git clone -q "$REPO_URL" "$CLINK_DIR"
    ok "Cloned"
fi

# ── Virtual environment ─────────────────────
VENV_DIR="$CLINK_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
    $PY -m venv "$VENV_DIR"
    ok "Created venv"
else
    ok "venv exists"
fi

"$VENV_DIR/bin/pip" install -q -r "$CLINK_DIR/requirements.txt"
ok "Dependencies installed"

# ── Shell alias ─────────────────────────────
ALIAS_CMD="alias clink='$VENV_DIR/bin/python $CLINK_DIR/clink.py'"

# Detect shell config file
if [ -n "${ZSH_VERSION:-}" ] || [ "$(basename "$SHELL")" = "zsh" ]; then
    SHELL_RC="$HOME/.zshrc"
elif [ -n "${BASH_VERSION:-}" ] || [ "$(basename "$SHELL")" = "bash" ]; then
    SHELL_RC="$HOME/.bashrc"
else
    SHELL_RC=""
fi

if [ -n "$SHELL_RC" ] && [ -f "$SHELL_RC" ]; then
    if ! grep -q "alias clink=" "$SHELL_RC" 2>/dev/null; then
        echo "" >> "$SHELL_RC"
        echo "# Clink - Claude Code multi-channel wrapper" >> "$SHELL_RC"
        echo "$ALIAS_CMD" >> "$SHELL_RC"
        ok "Added 'clink' alias to $SHELL_RC"
    else
        ok "'clink' alias already in $SHELL_RC"
    fi
fi

# ── Run setup ───────────────────────────────
info "\n── Running Setup ────────────────────────\n"
"$VENV_DIR/bin/python" "$CLINK_DIR/clink.py" setup

info "\n── Done! ────────────────────────────────"
echo ""
echo "  Restart your terminal, then:"
echo ""
echo "    clink start     # Start the bot"
echo "    clink doctor    # Check environment"
echo "    clink setup     # Re-configure"
echo ""
