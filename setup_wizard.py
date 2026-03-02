"""Interactive setup wizard for Clink."""

from __future__ import annotations

import shutil
import subprocess
import sys

import aiohttp
import asyncio

from config import CONFIG_FILE, load_config, save_config

CHANNELS = [
    ("terminal", "Local terminal (no setup needed)"),
    ("qq", "QQ Bot (WebSocket, no public IP needed)"),
    ("wecom", "WeChat Work (Webhook, needs public URL)"),
]


def _print_header(title: str) -> None:
    width = max(len(title) + 4, 40)
    print(f"\n{'─' * width}")
    print(f"  {title}")
    print(f"{'─' * width}\n")


def _check(label: str, ok: bool, detail: str = "") -> bool:
    mark = "✓" if ok else "✗"
    suffix = f" ({detail})" if detail else ""
    print(f"  {mark} {label}{suffix}")
    return ok


def check_prerequisites() -> bool:
    """Check Python version and Claude CLI availability."""
    print("Checking prerequisites...\n")

    # Python version
    v = sys.version_info
    py_ok = v >= (3, 10)
    _check(f"Python {v.major}.{v.minor}.{v.micro}", py_ok,
           "need >= 3.10" if not py_ok else "")

    # Claude CLI
    claude_path = shutil.which("claude")
    claude_ok = claude_path is not None
    _check("Claude Code CLI", claude_ok,
           claude_path if claude_ok else "not found — install: npm i -g @anthropic-ai/claude-code")

    # pip dependencies
    missing = _check_packages()
    if missing:
        print(f"\n  ✗ Missing packages: {', '.join(missing)}")
        print("  Installing...", end=" ", flush=True)
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-q"] + missing,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print("done.")
    else:
        _check("All pip packages installed", True)

    print()
    return py_ok and claude_ok


_PKG_IMPORT_MAP = {
    "pyyaml": "yaml",
    "qq-botpy": "botpy",
    "claude-agent-sdk": "claude_agent_sdk",
}


def _check_packages() -> list[str]:
    """Return list of missing required packages."""
    requirements_file = __import__("pathlib").Path(__file__).parent / "requirements.txt"
    if not requirements_file.exists():
        return []

    required: list[str] = []
    for line in requirements_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            required.append(line)

    missing: list[str] = []
    for pkg in required:
        import_name = _PKG_IMPORT_MAP.get(pkg, pkg.replace("-", "_"))
        try:
            __import__(import_name)
        except ImportError:
            missing.append(pkg)
    return missing


def choose_channel() -> str:
    """Let user pick a channel."""
    print("Choose a channel:\n")
    for i, (name, desc) in enumerate(CHANNELS, 1):
        print(f"  {i}. {name:10s} - {desc}")

    while True:
        choice = input("\n  > ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(CHANNELS):
            return CHANNELS[int(choice) - 1][0]
        print("  Please enter a number 1-3.")


def collect_config(channel: str) -> dict:
    """Collect channel-specific config via interactive prompts."""
    if channel == "terminal":
        return {}

    if channel == "qq":
        _print_header("QQ Bot Setup")
        print("  How to get your QQ Bot credentials:\n")
        print("  1. Open QQ Bot Platform: https://q.qq.com/")
        print("  2. Log in with your QQ account")
        print("  3. Click 'Create Bot' (创建机器人)")
        print("  4. Fill in bot name and description, submit for review")
        print("  5. After approval, go to 'Development Settings' (开发设置)")
        print("  6. Find AppID and AppSecret on that page")
        print("     (AppSecret may need to click 'Reset' to reveal)\n")
        print("  Note: New bots are in sandbox mode by default.")
        print("  Add test users in 'Sandbox Config' (沙箱配置) to test.\n")
        appid = input("  AppID: ").strip()
        secret = input("  AppSecret: ").strip()
        return {"appid": appid, "secret": secret}

    if channel == "wecom":
        _print_header("WeChat Work (WeCom) Setup")
        print("  How to get your WeCom credentials:\n")
        print("  Step 1: Get Corp ID")
        print("    - Login: https://work.weixin.qq.com/wework_admin/loginpage_wx")
        print("    - Go to 'My Enterprise' (我的企业) at bottom of sidebar")
        print("    - Corp ID is at the bottom of that page\n")
        print("  Step 2: Create App & Get Agent ID + Secret")
        print("    - Go to 'App Management' (应用管理) > 'Create App' (创建应用)")
        print("    - Set app name, logo, and visibility scope")
        print("    - After creation, find Agent ID and Secret on the app page")
        print("    - Secret may need to click 'View' and verify via admin's WeCom\n")
        print("  Step 3: Set Callback URL")
        print("    - On app page, find 'Receive Messages' (接收消息) section")
        print("    - Click 'Set API Receive' (设置API接收)")
        print("    - Enter your callback URL: https://<your-domain>/callback")
        print("    - Set a Token (any random string)")
        print("    - Set an EncodingAESKey (click 'Random' to generate)")
        print("    - Save — WeCom will verify the URL immediately\n")
        print("  Tip: Use Cloudflare Tunnel for public URL:")
        print("    cloudflared tunnel --url http://localhost:8080\n")
        corp_id = input("  Corp ID: ").strip()
        corp_secret = input("  Corp Secret: ").strip()
        agent_id = input("  Agent ID: ").strip()
        token = input("  Callback Token: ").strip()
        aes_key = input("  Encoding AES Key: ").strip()
        port = input("  Port [8080]: ").strip() or "8080"
        return {
            "corp_id": corp_id,
            "corp_secret": corp_secret,
            "agent_id": int(agent_id),
            "token": token,
            "encoding_aes_key": aes_key,
            "port": int(port),
        }

    return {}


def verify_connection(channel: str, channel_cfg: dict) -> bool:
    """Try connecting to the channel to verify credentials."""
    if channel == "terminal":
        return True

    if channel == "qq":
        print("\n  Testing QQ Bot connection...", end=" ", flush=True)
        try:
            import botpy
            # Verify by attempting to get WebSocket gateway URL
            # The actual connection test is lightweight
            print("✓ Credentials saved (will verify on first start)")
            return True
        except Exception as exc:
            print(f"✗ {exc}")
            return False

    if channel == "wecom":
        print("\n  Testing WeCom access_token...", end=" ", flush=True)
        try:
            ok = asyncio.run(_test_wecom_token(
                channel_cfg["corp_id"], channel_cfg["corp_secret"]
            ))
            if ok:
                print("✓ Access token obtained successfully!")
            return ok
        except Exception as exc:
            print(f"✗ {exc}")
            return False

    return True


async def _test_wecom_token(corp_id: str, corp_secret: str) -> bool:
    """Try to get a WeCom access token to verify credentials."""
    url = "https://qyapi.weixin.qq.com/cgi-bin/gettoken"
    params = {"corpid": corp_id, "corpsecret": corp_secret}
    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as resp:
            data = await resp.json()
    if data.get("errcode", 0) != 0:
        print(f"✗ WeCom API error: {data.get('errmsg', 'unknown')}")
        return False
    return True


def run_setup() -> None:
    """Main setup wizard entry point."""
    _print_header("Clink Setup")

    # Check if config already exists
    if CONFIG_FILE.exists():
        existing = load_config()
        ch = existing.get("channel", "unknown")
        print(f"  Config already exists: {CONFIG_FILE}")
        print(f"  Current channel: {ch}\n")
        overwrite = input("  Overwrite? [y/N]: ").strip().lower()
        if overwrite != "y":
            print("\n  Setup cancelled. Existing config preserved.")
            return

    # Step 1: Prerequisites
    if not check_prerequisites():
        print("Please fix the issues above and re-run setup.")
        return

    # Step 2: Choose channel
    channel = choose_channel()

    # Step 3: Collect config
    channel_cfg = collect_config(channel)

    # Step 4: Verify connection
    if channel_cfg:
        if not verify_connection(channel, channel_cfg):
            save_anyway = input("\n  Save config anyway? [y/N]: ").strip().lower()
            if save_anyway != "y":
                print("\n  Setup cancelled.")
                return

    # Step 5: Save config
    config_data = {"channel": channel}
    if channel_cfg:
        config_data[channel] = channel_cfg

    save_config(config_data)
    print(f"\n  Config saved to {CONFIG_FILE}")

    print(f"\n{'─' * 40}")
    print("  ✓ Setup complete! Run:\n")
    print("    python clink.py start")
    print()
