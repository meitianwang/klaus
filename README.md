# Klaus

在 QQ / 企业微信 / 飞书 / 网页 中使用 Claude Code。

Klaus 基于 [Claude Code SDK](https://www.npmjs.com/package/@anthropic-ai/claude-code)，将 Claude Code 接入即时通讯平台和浏览器。自动处理多轮对话、会话管理、消息合并（Collect 模式），并支持图片、文件、语音等富媒体消息。

## 安装

> 包名是 `klaus-ai`，安装后使用 `klaus` 命令。

### npm（推荐）

```bash
npm install -g klaus-ai
```

### 一键脚本

```bash
curl -fsSL https://raw.githubusercontent.com/meitianwang/klaus/main/install.sh | bash
```

脚本会自动安装 Node.js（如缺失）、Claude Code CLI 和 Klaus。

## 前置条件

- **Node.js >= 18**
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- 已登录的 Claude Code 账号（运行 `claude` 完成登录）

## 快速开始

```bash
# 首次运行自动进入配置向导
klaus start

# 单独运行配置
klaus setup

# 诊断环境问题
klaus doctor
```

## 支持的通道

| 通道 | 传输方式 | 需要公网 IP | 富媒体支持 |
|------|---------|------------|-----------|
| QQ Bot | WebSocket | 不需要 | ✅ |
| 企业微信 | HTTP 回调 | 需要 | ✅ |
| 飞书 / Lark | WebSocket 或 Webhook | WebSocket 不需要 | ✅ |
| 网页聊天 | HTTP + SSE | 不需要（可选 Tunnel） | 文本 |

### QQ Bot

1. 前往 [QQ 开放平台](https://q.qq.com/) 创建机器人
2. 在 开发 > 开发设置 中获取 AppID 和 AppSecret
3. 运行 `klaus setup`，选择 QQ
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
5. 运行 `klaus setup`，选择企业微信

**提示**：使用 [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 将本地端口暴露到公网：

```bash
cloudflared tunnel --url http://localhost:8080
```

#### 支持的消息类型

| 类型 | 说明 |
|------|------|
| 文本 | 直接识别 |
| 图片 | 通过 PicUrl 下载到本地，Claude 通过 Read 工具查看 |
| 文件 | 通过企业微信 media API 下载，Claude 通过 Read 工具查看 |
| 语音 | 有语音识别结果时自动转文字；无识别时提示用户发文字 |
| 视频 | 提示用户发送文字或截图（暂不支持） |
| 位置 | 自动解析为地点名称 + 经纬度坐标 |
| 链接 | 自动解析为标题 + 描述 + URL |

### 飞书 / Lark

1. 前往 [飞书开发者后台](https://open.feishu.cn/app)（Lark 用户访问 [open.larksuite.com](https://open.larksuite.com/app)）
2. 创建企业自建应用，获取 App ID 和 App Secret
3. 添加权限：`im:message`、`im:message:send_as_bot`、`im:resource`
4. 事件订阅：
   - **WebSocket 模式（推荐）**：开启「使用长连接」，无需公网 IP
   - **Webhook 模式**：设置回调地址，需公网可达
5. 订阅事件 `im.message.receive_v1`
6. 运行 `klaus setup`，选择飞书
7. `klaus start` 启动

> `@larksuiteoapi/node-sdk` 会在首次使用时自动安装。

#### 支持的消息类型

| 类型 | 说明 |
|------|------|
| 文本 | 直接识别，群聊需 @机器人 |
| 富文本（Post） | 完整解析：加粗、斜体、删除线、代码、链接、@提及 |
| 图片 | 下载到本地，Claude 通过 Read 工具查看 |
| 文件 | 下载到本地，Claude 通过 Read 工具查看 |
| 音频 | 下载到本地 |
| 视频 | 下载到本地 |
| 合并转发 | 自动展开子消息内容（最多 50 条） |
| 卡片消息 | 解析 Markdown / div 文本内容 |
| 分享群聊 | 解析群名称 |

#### 特性

- **消息去重**：24 小时 TTL，防止 SDK 重复推送
- **发送者名称解析**：自动获取发送者姓名（需 `contact:user.base:readonly` 权限）
- **Domain 支持**：飞书（默认）、Lark（国际版）、自定义 URL（私有化部署）
- **已撤回消息回退**：回复目标被撤回时自动改为直接发送

### 网页聊天 (Web)

无需任何第三方平台账号，直接在浏览器中和 Claude 对话。

1. 运行 `klaus setup`，选择 Web
2. Token 留空自动生成（也可自定义）
3. 选择是否启用 Cloudflare Tunnel（公网访问）
4. `klaus start` 启动后，打开终端显示的 URL 即可聊天

```
Klaus Web channel listening on http://localhost:3000
Chat URL: http://localhost:3000/?token=abc123...
```

**分享给别人**：将含 Token 的 URL 发给对方即可。每个 Token 对应一个独立会话。

**公网访问**：配置 `tunnel: true`，启动时会自动运行 `cloudflared tunnel`（需先安装 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)），生成公网 URL：

```bash
# macOS 安装 cloudflared
brew install cloudflared
```

## 定时任务 (Cron)

Klaus 支持 cron 定时任务，按计划自动执行 Claude 对话并可选推送结果到通道。

### 配置

在 `~/.klaus/config.yaml` 中添加 `cron` 段：

```yaml
cron:
  enabled: true
  tasks:
    - id: daily-summary
      name: "每日总结"
      schedule: "0 9 * * *"        # 每天 9:00
      prompt: "总结最近的技术新闻"
      model: sonnet                # 可选，覆盖默认模型
      deliver:                     # 可选，推送结果到通道
        channel: web               # web | wecom（QQ 不支持主动推送）
        to: "*"                    # web: "*" 广播 或 userId；wecom: userId

    - id: health-check
      name: "健康检查"
      schedule: "*/30 * * * *"     # 每 30 分钟
      prompt: "检查系统状态"
      enabled: true
```

### 调度表达式

| 格式 | 示例 | 说明 |
|------|------|------|
| 标准 cron（5/6 段） | `0 9 * * *` | 每天 9:00 |
| 间隔 | `*/30 * * * *` | 每 30 分钟 |
| 一次性 | ISO 8601 时间戳 | 到达指定时间执行一次 |
| 相对时间 | `20m`、`1h`、`2h30m` | 从现在起的相对延迟 |

### 聊天命令

在聊天中发送 `/cron` 可查看定时任务状态：

```
/cron                    # 查看所有任务状态
/cron add <id> <cron> <prompt>  # 动态添加任务
/cron remove <id>        # 删除任务
/cron enable <id>        # 启用任务
/cron disable <id>       # 禁用任务
```

### 高级配置

```yaml
cron:
  enabled: true
  max_concurrent_runs: 3           # 最大并发任务数
  retry:
    max_attempts: 3                # 失败重试次数
    backoff_ms: [30000, 60000]     # 重试退避间隔
  failure_alert:                   # 连续失败告警
    enabled: true
    after: 2                       # 连续失败 N 次后告警
    channel: web
  tasks:
    - id: my-task
      schedule: "0 */6 * * *"
      prompt: "执行任务"
      timeout_seconds: 300         # 超时（默认 600 秒）
      delete_after_run: true       # 一次性任务，执行后自动删除
```

## 配置

配置文件：`~/.klaus/config.yaml`

```yaml
channel: qq          # qq | wecom | web | feishu（支持多选：[qq, web]）
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

web:
  token: "your-access-token"   # setup 自动生成
  port: 3000                   # 默认 3000
  tunnel: false                # 是否自动启动 Cloudflare Tunnel

feishu:
  app_id: "cli_xxx"            # 飞书 App ID
  app_secret: "xxx"            # 飞书 App Secret
  mode: websocket              # websocket（默认）或 webhook
  port: 9000                   # webhook 模式端口，默认 9000
  domain: feishu               # feishu（默认）| lark | 自定义 URL

session:                       # 可选，会话持久化
  idle_minutes: 240            # 空闲超时（默认 4 小时）
  max_entries: 100             # 最大持久化会话数
  max_age_days: 7              # 过期清理天数
```

环境变量（`QQ_BOT_APPID`、`WECOM_CORP_ID`、`FEISHU_APP_ID`、`KLAUS_WEB_TOKEN` 等）可覆盖配置文件中的值。

### 配置验证

`klaus start` 启动时会自动验证配置，检查必填字段和格式。如有问题会一次性列出所有错误并退出，不会静默失败：

```
Config invalid
File: ~/.klaus/config.yaml

  ✗ wecom.corp_id: missing required field "corp_id" (or env: WECOM_CORP_ID)
    → provide Corp ID
  ✗ wecom.encoding_aes_key: invalid "encoding_aes_key": must be exactly 43 characters (Base64)

  Run klaus doctor to diagnose, or klaus setup to reconfigure.
```

`klaus doctor` 也会复用相同的验证逻辑进行诊断。

## 聊天命令

| 命令 | 效果 |
|------|------|
| `/new` `/reset` `/clear` | 重置当前对话 |
| `/help` | 显示可用命令列表 |
| `/session` | 查看当前会话信息（状态、模型） |
| `/model` | 查看当前使用的模型 |
| `/model <名称>` | 切换模型（sonnet / opus / haiku） |
| `/cron` | 查看定时任务状态 |

## 工作原理

```
用户消息 → 通道 (QQ/WeCom/Feishu/Web) → InboundMessage → formatPrompt() → 会话管理器 → ClaudeChat → Claude Code SDK
                                    ↑                                 ↑
                            结构化消息提取                        LRU 淘汰
                          (图片/文件/语音等)                   (最多 20 个会话)
```

- **结构化消息**：通道将平台消息解析为统一的 `InboundMessage` 结构（文本、图片、文件、语音、位置、链接等），`formatPrompt()` 集中转换为 Claude 可理解的文本提示词。
- **Collect 模式**：Claude 处理中时，后续消息自动排队并合并为一条 prompt，处理完毕后一并发送。
- **LRU 会话管理**：最多维持 20 个并发会话，空闲最久的会话优先淘汰。
- **会话持久化**：会话 ID 保存到 `~/.klaus/sessions.json`，重启后自动恢复（默认 4 小时内有效）。
- **富媒体解析**：图片和文件下载到临时目录，以文件路径传递给 Claude，Claude 通过 Read 工具直接查看图片和 PDF 内容。
- **消息分片**：Claude 的长回复自动按平台限制拆分发送（QQ 按字符数、企业微信按 UTF-8 字节数、飞书按 4000 字符），避免被平台截断。
- **自动重试**：API 调用失败（限频、token 过期、网络抖动）时自动指数退避重试；QQ WebSocket 断连后自动重连。
- **定时任务**：Cron 调度器按计划执行 Claude 对话，每个任务使用独立会话，结果可推送到指定通道。

## License

MIT
