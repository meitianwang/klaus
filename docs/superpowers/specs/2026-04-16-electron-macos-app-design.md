# Klaus macOS Electron App — Design Spec

## Background

Klaus 现有三个客户端：Web 端（多用户）、iOS 原生、macOS 原生（Swift）。macOS Swift 端架构有根本问题——它把引擎作为 Bun 子进程 fork 出来，通过 stdin/stdout NDJSON 通信，本质是个"遥控器"而非一体化应用。

本方案用 Electron + TypeScript 替代 Swift 端，基于 claude-code 引擎源码构建，做到 app 启动即引擎就绪，无子进程、无管道通信。

## 引擎集成策略

### 为什么复制 Web 端的 engine 目录

claude-code 原始引擎（`/Users/meitianwang/workspace/claude-code/source/src/`）包含大量 CLI/终端特性（Ink React UI、Vim 模式、IDE 集成、Bridge 模式等），需要裁剪。

Web 端已完成这项工作，将引擎源码复制到 `src/engine/`（690 个文件），做了以下处理：

| 改动类型 | 文件数 | 内容 |
|----------|--------|------|
| import 路径改写 | ~200 | `src/...` 绝对路径 → 相对路径 |
| React/Ink 剥离 | ~15 | useCanUseTool 改为工厂函数、AppState 改为 reactive store |
| GrowthBook stub | ~5 | 硬编码三层记忆 gates，去掉远程 feature flag |
| Feature gate 简化 | ~20 | 删 ant-only 工具、删 coordinator/proactive mode |
| Claude.ai 限制移除 | ~5 | 订阅限制和 rate limit stub |
| 新增文件 | 55 | index.ts 公共 API、shims、类型定义、cron bridge |

关键事实：**engine 目录内不含多用户隔离逻辑**。多用户隔离全在上层 `agent-manager.ts` 中。engine 的所有改动（CLI 剥离、feature 简化、业务桥接）恰好也是 Electron app 需要的。

### 具体操作

```
cp -r src/engine/ apps/electron/src/engine/
```

后续 Electron app 可自由修改 engine 内部代码——定制工具行为、改 prompt 逻辑、调权限流程、加新工具，不受任何黑盒限制。

### 与 Web 端 engine 的关系

claude-code 上游已闭源，不存在上游同步。Klaus 的 engine 源码是完全自有的代码资产。

Electron 端从 Web 端的 `src/engine/` 复制一份作为起点。两端 engine 独立演进——Electron 端可能需要不同的适配（如 Bun→Node 兼容），Web 端保持现状。后续如果两端 engine 需要统一维护，可提取为 monorepo 共享包，但这是独立的重构任务，不在本次范围内。

## 项目结构

```
apps/electron/
├── package.json
├── tsconfig.json
├── electron-builder.yml
├── vite.config.ts                  # electron-vite 构建配置
├── src/
│   ├── main/                       # Electron 主进程
│   │   ├── index.ts                # 入口：设置 feature flags → 初始化 → 创建窗口
│   │   ├── engine-host.ts          # 引擎封装：会话、工具、MCP、权限
│   │   ├── ipc-handlers.ts         # IPC 路由
│   │   ├── settings-store.ts       # better-sqlite3 读写 ~/.klaus/settings.db
│   │   ├── message-store.ts        # JSONL 消息持久化
│   │   ├── tray.ts                 # 系统托盘
│   │   └── window.ts              # 窗口管理
│   ├── preload/
│   │   └── preload.ts              # contextBridge 安全 IPC
│   ├── renderer/                   # 渲染进程
│   │   ├── index.html
│   │   ├── css/
│   │   │   └── styles.css
│   │   └── js/
│   │       ├── chat.js             # 聊天：消息渲染、流式、Markdown
│   │       ├── sessions.js         # 会话列表
│   │       ├── settings.js         # 设置面板
│   │       ├── permissions.js      # 权限对话框
│   │       └── i18n.js             # 中英双语
│   ├── engine/                     # 从 Web 端复制的引擎源码
│   │   ├── index.ts                # 公共 API
│   │   ├── query/
│   │   ├── tools/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── hooks/
│   │   ├── shims/
│   │   └── ...                     # 完整 engine 目录（690 文件）
│   └── shared/
│       └── types.ts                # IPC 消息类型（主进程/渲染共享）
└── resources/
    ├── icon.icns
    └── tray-icon.png
```

## 主进程架构

### 启动流程 (main/index.ts)

```
app.whenReady()
  ├─ 设置 process.env.CLAUDE_CODE_FEATURES
  │    EXTRACT_MEMORIES, CONTEXT_COLLAPSE, BUILTIN_EXPLORE_PLAN_AGENTS,
  │    TRANSCRIPT_CLASSIFIER, BASH_CLASSIFIER
  ├─ 初始化 SettingsStore (better-sqlite3 → ~/.klaus/settings.db)
  ├─ 初始化 EngineHost
  │    ├─ 加载工具 (getAllBaseTools)
  │    ├─ 初始化 MCP 连接
  │    ├─ 加载权限规则
  │    └─ 初始化 AutoDream
  ├─ 注册 IPC handlers
  ├─ 创建 BrowserWindow (加载 renderer/index.html)
  ├─ 创建 Tray
  └─ ready
```

### 引擎封装 (main/engine-host.ts)

对标 Web 端 `agent-manager.ts`，核心区别是单用户：

```typescript
class EngineHost {
  private sessions: Map<string, SessionEntry>  // sessionId → session
  private mcpClients: MCPServerConnection[]    // 单用户，一个连接池
  private mcpTools: Tool[]
  private settingsStore: SettingsStore
  
  // 生命周期
  async init(): Promise<void>
  async shutdown(): Promise<void>
  
  // 会话
  async chat(sessionId: string, text: string, media?: MediaFile[]): Promise<void>
  async interrupt(sessionId: string): void
  async newSession(): SessionInfo
  async deleteSession(sessionId: string): void
  async listSessions(): SessionInfo[]
  async getHistory(sessionId: string): ChatMessage[]
  
  // MCP
  async initMcp(): Promise<void>
  async reconnectMcp(): Promise<void>
  
  // 事件推送（通过 BrowserWindow.webContents.send）
  private pushEvent(event: EngineEvent): void
  private pushPermissionRequest(req: PermissionRequest): void
}
```

**SessionEntry 结构：**

```typescript
interface SessionEntry {
  messages: Message[]
  appState: AppState
  toolPermissionContext: ToolPermissionContext
  loopDetector: ToolLoopDetector
  isRunning: boolean
  contentReplacementState: ContentReplacementState
}
```

**核心 chat() 流程：**

```
chat(sessionId, text)
  ├─ 获取/创建 session
  ├─ 构建工具列表 (getAllBaseTools + mcpTools)
  ├─ 构建 system prompt (getSystemPrompt + settingsStore 中的 prompt sections)
  ├─ 构建 queryParams
  ├─ 调用 query(queryParams) → AsyncGenerator
  ├─ for await (event of generator)
  │    ├─ stream events → pushEvent() → IPC → renderer
  │    ├─ tool calls → 执行 + pushEvent()
  │    └─ permission requests → pushPermissionRequest() → IPC → renderer 弹框
  ├─ 完成 → pushEvent({ type: 'done' })
  └─ 持久化消息到 message-store
```

**权限回调：**

```typescript
const onAsk: OnAskCallback = async ({ tool, input, message, suggestions }) => {
  // 发 IPC 到 renderer
  const requestId = randomUUID()
  mainWindow.webContents.send('permission:request', {
    requestId, toolName: tool.name, toolInput: input, message, suggestions
  })
  
  // 等待 renderer 回传决策
  const response = await waitForPermissionResponse(requestId)
  
  // 如果选了 "Always Allow"，持久化规则
  if (response.acceptedSuggestionIndices?.length) {
    persistPermissionRules(suggestions, response.acceptedSuggestionIndices)
  }
  
  return { decision: response.decision, updatedInput: response.updatedInput }
}

const canUseTool = createCanUseTool(onAsk)
```

### Settings Store (main/settings-store.ts)

接口与 Web 端 `settings-store.ts` 一致，底层用 `better-sqlite3` 替代 `bun:sqlite`：

```typescript
class SettingsStore {
  // 模型
  listModels(): ModelRecord[]
  getDefaultModel(): ModelRecord | undefined
  upsertModel(m: ModelRecord): void
  setDefaultModel(id: string): void
  
  // 提示词
  listPrompts(): PromptRecord[]
  upsertPrompt(p: PromptRecord): void
  deletePrompt(id: string): boolean
  
  // 通用 KV
  get(key: string): string | undefined
  set(key: string, value: string): void
  
  // Cron
  listTasks(): CronTask[]
  upsertTask(task: CronTask): void
  deleteTask(id: string): boolean
  
  // 技能
  getSkillSettings(): Map<string, { enabled?: boolean }>
}
```

无 userId 参数。所有方法直接操作，不分用户。

### Bun → Node 适配

| Bun API | Node 替代 | 影响范围 |
|---------|-----------|----------|
| `bun:sqlite` | `better-sqlite3` | settings-store、analytics sink |
| `Bun.spawn` / `Bun.spawnSync` | `child_process.spawn` / `spawnSync` | BashTool |
| `bun:ffi` | 已有 shim (`pkg-bun-ffi.ts`) | 无影响 |
| `Bun.file()` | `fs.readFile()` | 少量工具代码 |

engine 内的 shims 目录已处理了大部分兼容。settings-store 是新写的，直接用 better-sqlite3。BashTool 可能需要确认 spawn 兼容性。

## IPC 协议

### Renderer → Main (invoke，有返回值)

```typescript
// 聊天
'chat:send'       { sessionId, text, media? }        → void
'chat:interrupt'   { sessionId }                      → void

// 会话
'session:new'      {}                                 → SessionInfo
'session:list'     {}                                 → SessionInfo[]
'session:delete'   { sessionId }                      → void
'session:rename'   { sessionId, title }               → void
'session:history'  { sessionId }                      → ChatMessage[]

// 设置
'settings:models:list'     {}                         → ModelRecord[]
'settings:models:upsert'   ModelRecord                → void
'settings:models:default'  { id }                     → void
'settings:prompts:list'    {}                         → PromptRecord[]
'settings:prompts:upsert'  PromptRecord               → void
'settings:prompts:delete'  { id }                     → void
'settings:kv:get'          { key }                    → string | undefined
'settings:kv:set'          { key, value }             → void
'settings:cron:list'       {}                         → CronTask[]
'settings:cron:upsert'     CronTask                   → void
'settings:cron:delete'     { id }                     → void

// 权限决策回传
'permission:respond'  { requestId, decision, acceptedSuggestionIndices? } → void

// MCP
'mcp:reconnect'    {}                                 → void
'mcp:status'       {}                                 → McpServerInfo[]
```

### Main → Renderer (push 事件)

```typescript
// 聊天流
'chat:event'  EngineEvent
  { type: 'text_delta', sessionId, text }
  { type: 'thinking_delta', sessionId, thinking }
  { type: 'tool_start', sessionId, toolName, toolCallId, args }
  { type: 'tool_end', sessionId, toolName, toolCallId, isError }
  { type: 'tool_input_delta', sessionId, toolCallId, delta }
  { type: 'progress', sessionId, toolName, toolCallId, content }
  { type: 'stream_mode', sessionId, mode }
  { type: 'message_complete', sessionId, message }
  { type: 'context_collapse_stats', sessionId, collapsedSpans, stagedSpans }
  { type: 'api_error', sessionId, error }
  { type: 'api_retry', sessionId, attempt, maxRetries, delayMs }
  { type: 'done', sessionId }

// 权限请求
'permission:request'  { requestId, toolName, toolInput, message, suggestions }

// 引擎状态
'engine:status'  { status: 'initializing' | 'ready' | 'error', error? }
```

### Preload 桥接 (preload/preload.ts)

```typescript
contextBridge.exposeInMainWorld('klaus', {
  // invoke (request-response)
  chat: {
    send: (sessionId, text, media?) => ipcRenderer.invoke('chat:send', { sessionId, text, media }),
    interrupt: (sessionId) => ipcRenderer.invoke('chat:interrupt', { sessionId }),
  },
  session: { /* new, list, delete, rename, history */ },
  settings: { /* models, prompts, kv, cron */ },
  permission: {
    respond: (requestId, decision, indices?) => ipcRenderer.invoke('permission:respond', { requestId, decision, acceptedSuggestionIndices: indices }),
  },
  mcp: { /* reconnect, status */ },
  
  // listen (push events)
  onChatEvent: (cb) => ipcRenderer.on('chat:event', (_, event) => cb(event)),
  onPermissionRequest: (cb) => ipcRenderer.on('permission:request', (_, req) => cb(req)),
  onEngineStatus: (cb) => ipcRenderer.on('engine:status', (_, status) => cb(status)),
})
```

## 渲染进程 UI

### 布局

```
┌──────────────────────────────────────────────────────┐
│  ┌──────────┐  ┌──────────────────────────────────┐  │
│  │  Sidebar  │  │         Chat Area                │  │
│  │           │  │                                  │  │
│  │  [+ 新建] │  │  messages (scrollable)           │  │
│  │           │  │  ┌──── user msg ──────────────┐  │  │
│  │  Today    │  │  │ 用户消息                   │  │  │
│  │   sess-1  │  │  └────────────────────────────┘  │  │
│  │   sess-2  │  │  ┌──── assistant msg ─────────┐  │  │
│  │           │  │  │ Markdown 渲染              │  │  │
│  │  Earlier  │  │  │ thinking (折叠)            │  │  │
│  │   sess-3  │  │  │ tool calls (进度+结果)     │  │  │
│  │           │  │  │ permission (内联对话框)     │  │  │
│  │           │  │  └────────────────────────────┘  │  │
│  │           │  ├──────────────────────────────────┤  │
│  │           │  │  [textarea]            [发送]    │  │
│  │  ──────── │  │  拖放文件 / 粘贴图片             │  │
│  │  [⚙ 设置]│  └──────────────────────────────────┘  │
│  └──────────┘                                        │
└──────────────────────────────────────────────────────┘
```

### 技术选型

- **纯 HTML + CSS + JS**，无框架
- **Markdown**：marked.js
- **代码高亮**：highlight.js
- **主题**：CSS 变量，暖色调（Klaus 设计语言），支持 light/dark
- **i18n**：`data-i18n` 属性，中英双语

### 关键 UI 组件

**消息渲染：**
- 用户消息：简单气泡
- 助手消息：Markdown → HTML（marked + hljs）
- 思考块：可折叠区域，淡色背景
- 工具调用：显示工具名 + 参数摘要 + 执行状态 + 结果（可折叠）
- 权限对话框：内联卡片，显示工具名、参数、建议选项、Allow/Deny 按钮

**设置面板：**
- 侧边栏底部 ⚙ 按钮切换显示
- 标签页：Models / Prompts / MCP / Preferences
- 通过 IPC 读写 settings-store

### 不需要的 UI（Web 端有但 Electron 不需要）

- 登录/注册/邀请码
- 用户管理（Admin Users/Invites 页面）
- 频道管理（IM Channels 页面）
- Google OAuth 配置

## 系统托盘 (main/tray.ts)

- macOS 菜单栏图标，显示引擎状态（idle/running）
- 右键菜单：新建对话、显示窗口、设置、退出
- 关闭窗口时隐藏到托盘（不退出 app）

## 数据存储

与 Web 端共享数据目录，Electron app 和 Web 端可以读同一份数据：

| 用途 | 路径 |
|------|------|
| 运行时配置 | `~/.klaus/settings.db` |
| 消息记录 | `~/.klaus/transcripts/` |
| MCP 配置 | `~/.klaus/.mcp.json` |
| 权限规则 | `~/.claude/settings.json`（引擎原生路径） |
| 会话元数据 | `~/.klaus/electron-sessions.json` |

## 工具列表

使用 `getAllBaseTools()` 获取全部可用工具，与 Web 端一致：

BashTool, FileReadTool, FileEditTool, FileWriteTool, GlobTool, GrepTool,
WebFetchTool, WebSearchTool, AgentTool, SkillTool, TodoWriteTool,
AskUserQuestionTool, NotebookEditTool, EnterPlanModeTool, ExitPlanModeTool,
BriefTool, TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool,
TaskOutputTool, TaskStopTool, TeamCreateTool, TeamDeleteTool,
CronCreateTool, CronDeleteTool, CronListTool, SendMessageTool,
ToolSearchTool, MCPTool, McpAuthTool, ListMcpResourcesTool,
ReadMcpResourceTool, EnterWorktreeTool, ExitWorktreeTool,
SyntheticOutputTool

Feature flags 控制的工具随 `CLAUDE_CODE_FEATURES` 环境变量生效。

## Feature Flags

```typescript
process.env.CLAUDE_CODE_FEATURES = [
  'EXTRACT_MEMORIES',
  'CONTEXT_COLLAPSE',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'TRANSCRIPT_CLASSIFIER',
  'BASH_CLASSIFIER',
].join(',')
```

与 Web 端保持一致。后续可按需开启更多 flag。

## 构建与打包

### 开发依赖

```json
{
  "devDependencies": {
    "electron": "^34",
    "electron-builder": "^25",
    "electron-vite": "^3",
    "typescript": "^5.5"
  },
  "dependencies": {
    "better-sqlite3": "^11",
    "@anthropic-ai/sdk": "^0.50",
    "marked": "^15",
    "highlight.js": "^11"
  }
}
```

### 构建脚本

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "package": "electron-builder --mac"
  }
}
```

### electron-builder 配置

```yaml
appId: ai.klaus.desktop
productName: Klaus
mac:
  category: public.app-category.developer-tools
  target: dmg
  icon: resources/icon.icns
```

## 实施阶段

### P1: 项目骨架 + 引擎集成
- 创建 `apps/electron/` 目录结构
- 初始化 package.json、tsconfig、electron-vite 配置
- 复制 `src/engine/` 到 `apps/electron/src/engine/`
- 写 `main/index.ts` 启动流程
- 写 `settings-store.ts`（better-sqlite3）
- 验证：app 启动，引擎加载成功，能执行一次 query
- **产出：Electron 窗口弹出，控制台输出引擎回复**

### P2: IPC + 基础聊天 UI
- 写 `engine-host.ts` 核心 chat 流程
- 写 `ipc-handlers.ts` + `preload.ts`
- 写 renderer 基础聊天 UI（发消息、看流式回复）
- Markdown 渲染 + 代码高亮
- **产出：能在 UI 里对话，看到流式文本**

### P3: 会话管理 + 消息持久化
- 会话 CRUD（新建、切换、删除、重命名）
- 侧边栏会话列表（按日期分组）
- 消息持久化（JSONL）
- 历史消息加载
- **产出：多会话工作，重启 app 后历史保留**

### P4: 完整消息渲染 + 权限
- 思考块渲染（折叠/展开）
- 工具调用渲染（名称、参数、进度、结果）
- 权限对话框（IPC 流程完整串通）
- Always Allow 持久化
- **产出：工具使用体验完整**

### P5: 设置面板
- Models 管理（CRUD、设默认、API Key）
- Prompts 管理（编辑系统提示词分段）
- MCP 服务器状态查看 + 重连
- 偏好设置（语言、主题、权限模式）
- **产出：所有运行时配置可在 UI 管理**

### P6: 系统集成 + 打磨
- 系统托盘（菜单栏图标 + 菜单）
- 窗口关闭 → 隐藏到托盘
- 深色模式
- 文件拖放/图片粘贴
- i18n 中英双语
- **产出：完整桌面体验**

### P7: 打包分发
- electron-builder 配置
- macOS .dmg 构建
- 应用图标
- 代码签名（后续）
- **产出：可分发的 .dmg 安装包**
