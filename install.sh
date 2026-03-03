#!/usr/bin/env bash
set -euo pipefail

# ─── Klaus Installer ─────────────────────────────────────────────────────────
# Usage: curl -fsSL https://raw.githubusercontent.com/meitianwang/klaus/main/install.sh | bash

BOLD="\033[1m"
GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
RESET="\033[0m"

info()  { printf "${BOLD}${GREEN}✓${RESET} %s\n" "$1"; }
warn()  { printf "${BOLD}${YELLOW}!${RESET} %s\n" "$1"; }
error() { printf "${BOLD}${RED}✗${RESET} %s\n" "$1"; }
step()  { printf "\n${BOLD}▸ %s${RESET}\n" "$1"; }

MIN_NODE=18

# ─── Check / Install Node.js ─────────────────────────────────────────────────

check_node() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node -v | sed 's/^v//')
    local major
    major=$(echo "$ver" | cut -d. -f1)
    if [ "$major" -ge "$MIN_NODE" ]; then
      info "Node.js v${ver}"
      return 0
    else
      warn "Node.js v${ver} found but v${MIN_NODE}+ required"
      return 1
    fi
  else
    warn "Node.js not found"
    return 1
  fi
}

install_node() {
  step "Installing Node.js"

  # Try nvm first
  if command -v nvm &>/dev/null || [ -s "$HOME/.nvm/nvm.sh" ]; then
    [ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"
    nvm install --lts
    nvm use --lts
    return 0
  fi

  # Try fnm
  if command -v fnm &>/dev/null; then
    fnm install --lts
    fnm use lts-latest
    return 0
  fi

  # macOS: Homebrew
  if [ "$(uname)" = "Darwin" ] && command -v brew &>/dev/null; then
    brew install node
    return 0
  fi

  # Linux: NodeSource
  if [ "$(uname)" = "Linux" ]; then
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y nodejs
      return 0
    elif command -v dnf &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
      sudo dnf install -y nodejs
      return 0
    fi
  fi

  error "Could not install Node.js automatically."
  echo "  Please install Node.js >= ${MIN_NODE} manually: https://nodejs.org/"
  exit 1
}

# ─── Check / Install Claude Code CLI ─────────────────────────────────────────

check_claude() {
  if command -v claude &>/dev/null; then
    info "Claude Code CLI found"
    return 0
  else
    warn "Claude Code CLI not found"
    return 1
  fi
}

install_claude() {
  step "Installing Claude Code CLI"
  npm install -g @anthropic-ai/claude-code
}

# ─── Install Klaus ────────────────────────────────────────────────────────────

install_klaus() {
  step "Installing Klaus"
  npm install -g klaus-ai
}

# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "  ${BOLD}Klaus Installer${RESET}"
  echo "  Use Claude Code from QQ / WeChat Work"
  echo ""

  # 1. Node.js
  step "Checking Node.js"
  if ! check_node; then
    install_node
    check_node || { error "Node.js installation failed"; exit 1; }
  fi

  # 2. Claude Code CLI
  step "Checking Claude Code CLI"
  if ! check_claude; then
    install_claude
    check_claude || { error "Claude Code CLI installation failed"; exit 1; }
  fi

  # 3. Klaus
  install_klaus

  echo ""
  info "Installation complete!"
  echo ""
  echo "  Next steps:"
  echo "    ${BOLD}klaus setup${RESET}   — Interactive configuration wizard"
  echo "    ${BOLD}klaus start${RESET}   — Start the bot"
  echo "    ${BOLD}klaus doctor${RESET}  — Diagnose environment issues"
  echo ""
}

main "$@"
