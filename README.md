# Claude Paw 🐾

在 QQ / 企业微信 中使用 Claude Code。

Claude Paw 基于 [Claude Code SDK](https://www.npmjs.com/package/@anthropic-ai/claude-code)，将 Claude Code 接入即时通讯平台。自动处理多轮对话、会话管理、消息合并（Collect 模式），并支持图片、文件、语音等富媒体消息。

## 安装

> 包名是 `claude-paw`，安装后使用 `cpaw` 命令。

### npm（推荐）

```bash
npm install -g claude-paw
```

### 一键脚本

```bash
curl -fsSL https://raw.githubusercontent.com/meitianwang/cpaw/main/install.sh | bash
```

脚本会自动安装 Node.js（如缺失）、Claude Code CLI 和 Claude Paw。

## 前置条件

- **Node.js >= 18**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- 已登录的 Claude Code 账号（运行 `claude` 完成登录）

## 快速开始

```bash
# 首次运行自动进入配置向导
cpaw start

# 单独运行配置
cpaw setup

# 诊断环境问题
cpaw doctor
```

## 支持的通道

| 通道 | 传输方式 | 需要公网 IP | 富媒体支持 |
|------|---------|------------|-----------|
| QQ Bot | WebSocket | 不需要 | ✅ |
| 企业微信 | HTTP 回调 | 需要 | ✅ |

### QQ Bot

1. 前往 [QQ 开放平台](https://q.qq.com/) 创建机器人
2. 在 开发 > 开发设置 中获取 AppID 和 AppSecret
3. 运行 `cpaw setup`，选择 QQ
4. 在 开发 > 沙箱配置 添加测试用户
5. 用手机 QQ 扫描沙箱二维码即可开始聊天

> `qq-group-bot` SDK 会在首次使用时自动安装。

#### 支持的消息类型

| 类型 | 说明 |
|------|------|
| 文本 | 直接识别 |
| 图片 | 下载到本地，Claude 通过 Read 工具查看 |
| 文件（PDF、Excel 等） | 下载到本地，Claude 通过 Read 工具查看 |
| 视频 / 语音 | 提示用户发送文字（暂不支持） |
| 表情 | 识别为 `[表情:描述]` |
| @提及 | 识别为 `[@用户:id]` |
| 引用回复 | 自动获取被引用消息的内容 |

### 企业微信 (WeCom)

1. 登录 [work.weixin.qq.com](https://work.weixin.qq.com/)
2. 在 我的企业 获取 Corp ID
3. 创建自建应用，获取 Agent ID + Secret
4. 在 接收消息 设置回调 URL
5. 运行 `cpaw setup`，选择企业微信

**提示**：使用 [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 将本地端口暴露到公网：

```bash
cloudflared tunnel --url http://localhost:8080
```

## 配置

配置文件：`~/.cpaw/config.yaml`

```yaml
channel: qq          # 或 wecom
persona: "You are a helpful AI assistant."

qq:
  appid: "your-appid"
  secret: "your-secret"

wecom:
  corp_id: "your-corp-id"
  corp_secret: "your-secret"
  agent_id: 1000002
  token: "callback-token"
  encoding_aes_key: "aes-key"
  port: 8080
```

环境变量（`QQ_BOT_APPID`、`WECOM_CORP_ID` 等）可覆盖配置文件中的值。

## 聊天命令

| 命令 | 效果 |
|------|------|
| `/new` `/reset` `/clear` | 重置当前对话 |
| `/help` | 显示可用命令列表 |
| `/session` | 查看当前会话信息（状态、模型） |
| `/model` | 查看当前使用的模型 |
| `/model <名称>` | 切换模型（sonnet / opus / haiku） |

## 工作原理

```
用户消息 → 通道 (QQ/WeCom) → 会话管理器 → ClaudeChat → Claude Code SDK
                                    ↑
                               LRU 淘汰
                            (最多 20 个会话)
```

- **Collect 模式**：Claude 处理中时，后续消息自动排队并合并为一条 prompt，处理完毕后一并发送。
- **LRU 会话管理**：最多维持 20 个并发会话，空闲最久的会话优先淘汰。
- **富媒体解析**：图片和文件下载到临时目录，以文件路径传递给 Claude，Claude 通过 Read 工具直接查看图片和 PDF 内容。

## License

MIT
