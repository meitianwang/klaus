# Klaus 技术文档

> 单文件累积的项目实现说明。每章按主题独立，可单独阅读。引擎层位于 [apps/electron/src/engine/](../apps/electron/src/engine/)，移植自 Claude Code（以下简称 CC，源码 [/Users/meitianwang/workspace/claude-code](file:///Users/meitianwang/workspace/claude-code)）；UI 层（HTML/JS）是 Klaus 自研。

## 目录

- [Agent 系统](#agent-系统)

---

## Agent 系统

本章覆盖 Klaus 桌面端 **agent 子系统**从来源、协调、控制、数据流到 UI 的完整实现。

### 1. 整体定位

Klaus 的"主 agent"是用户在 chat 界面对话的那个 LLM 实例；"sub-agent"（也叫 teammate / subagent / task agent）是主 agent 通过 [`AgentTool`](../apps/electron/src/engine/tools/AgentTool/AgentTool.ts) 调起的子 LLM 实例，让它独立完成某段子任务后把结果带回来。

> **通俗讲**：主 agent 像一个项目经理，遇到不想自己干的活就喊一个"实习生"去做，做完拿报告回来。

整套系统要解决四件事：
1. **来源**：实习生从哪里招？（内置 / 用户写的 .md / 克隆自己）
2. **协调**：项目经理怎么调度这些实习生？（点名、并行、后台、互相通话、克隆）
3. **控制**：哪些招聘和调度方式默认开？（feature gate）
4. **回流**：实习生的产出怎么回到主对话？（数据流 + UI）

---

### 2. Agent 来源（三层 definition pool）

主 agent 调 `AgentTool` 时要传 `subagent_type` 字段，能传哪些值由这三层 union 决定。

#### 2.1 内置 agent（built-in）

由 [`getBuiltInAgents()`](../apps/electron/src/engine/tools/AgentTool/builtInAgents.ts#L22) 硬编码返回，每个内置 agent 是一个 [`BuiltInAgentDefinition`](../apps/electron/src/engine/tools/AgentTool/loadAgentsDir.ts) 对象，含 `agentType` / `whenToUse` / `tools` / `getSystemPrompt()`。

| agentType | 默认状态 | 用途 |
|---|---|---|
| `general-purpose` | ✅ 始终开 | 通用搜索、分析、多步研究。最常用。[generalPurposeAgent.ts:25](../apps/electron/src/engine/tools/AgentTool/built-in/generalPurposeAgent.ts#L25) |
| `statusline-setup` | ✅ 始终开 | 配置终端 statusline |
| `sandbox-checker` | ✅ 始终开 | 沙箱检查 |
| `explore` | ⚠️ 实验开关 | 用 haiku 模型快速扫代码库结构。受 `BUILTIN_EXPLORE_PLAN_AGENTS` + GrowthBook `tengu_amber_stoat` 控制 |
| `plan` | ⚠️ 实验开关 | 复杂改动前先规划 |
| `verification` | ❌ 默认关 | 反复审查修改是否真的解决了问题。受 `VERIFICATION_AGENT` + GrowthBook `tengu_hive_evidence`（默认 false）|

CC 自带的 `claude-code-guide` Klaus 没移植（[builtInAgents.ts:47](../apps/electron/src/engine/tools/AgentTool/builtInAgents.ts#L47) 注释写明）。

#### 2.2 用户自定义 markdown agent

[`getAgentDefinitionsWithOverrides()`](../apps/electron/src/engine/tools/AgentTool/loadAgentsDir.ts#L296) 通过 [`loadMarkdownFilesForSubdir('agents', cwd)`](../apps/electron/src/engine/utils/markdownConfigLoader.ts#L297) 扫描下列目录里的 `.md` 文件：

- `~/.claude/agents/*.md`（用户级）
- `<projectRoot>/.claude/agents/*.md`（项目级）
- 沿 cwd 向上的所有 `.claude/agents/`（项目内嵌 monorepo 时有用）
- managed dir（policySettings，企业部署用）

每个 `.md` 用 frontmatter + body 定义：

```markdown
---
agentType: code-reviewer
whenToUse: 审查代码改动找出安全/性能问题
tools: [Read, Grep, Glob]
model: haiku  # 可选，默认走 getDefaultSubagentModel()
---

你是个代码审查员。只看，不改。挑出 SQL 注入、未处理 error...
```

> **通俗讲**：你自己写一份"职位说明书"招的专员。`whenToUse` 那一句话是它的招聘启事 —— 主 agent 选谁就看这一句。

#### 2.3 fork-subagent（克隆自己）

实验性功能，由 [`isForkSubagentEnabled()`](../apps/electron/src/engine/tools/AgentTool/forkSubagent.ts#L33) gate。开启后 `subagent_type` 字段变可选：

- **传了 subagent_type** → 走静态 agent（路径 2.1 / 2.2）
- **省略 subagent_type** → 触发 fork：[`buildForkedMessages()`](../apps/electron/src/engine/tools/AgentTool/forkSubagent.ts#L107) 把主 agent 的最后一条 assistant message + tool_result 占位符复制成子 agent 的初始历史，**继承完整 system prompt + 对话历史**

[`FORK_AGENT`](../apps/electron/src/engine/tools/AgentTool/forkSubagent.ts#L60) 定义：`tools: ['*']`、`useExactTools: true`、`model: 'inherit'`、`permissionMode: 'bubble'`（权限请求上浮到父 agent 而非自己处理）。

> **通俗讲**：不是喊别人，是把当前的我复制一份去并行干活。克隆体记得我们之前聊了什么，上手就能继续干。

#### 2.4 三种来源的关键差异

|  | 静态 agent | 用户 .md | fork |
|---|---|---|---|
| 是否继承主 agent 对话历史 | ❌ | ❌ | ✅ |
| system prompt 来源 | `getSystemPrompt()` 硬编码 | markdown body | 父 agent 的 rendered system prompt（字节精确） |
| 工具池 | `tools` 字段 | frontmatter `tools` | 父的精确 tool 集（`useExactTools`）|
| 默认是否开 | ✅ 三个常驻 | ✅ 取决于用户 | ❌ 默认关 |

---

### 3. 协调机制：五种套路

主 agent 怎么用这些 sub-agent 把事干完，本质上是 **LLM 自己看到工具 schema 后选择哪种调用模式**。引擎不硬编码 workflow，只提供工具 + prompt 引导。

#### 套路 1：派活（最基础）

主 agent 在一次 turn 里调一次 `AgentTool`，传 `subagent_type` + `description` + `prompt`，等子 agent 跑完拿到结果。

```jsonc
// 主 agent 发出的 tool_use
{
  "name": "Agent",
  "input": {
    "subagent_type": "general-purpose",
    "description": "梳理 Klaus 架构",
    "prompt": "请扫描 src/...，回报架构图"
  }
}
```

> **通俗讲**：项目经理点名一个实习生，给一份任务书，等他拿结果回来。子 agent 看不到主对话，**任务书必须自包含**。

#### 套路 2：一次喊多个（同 turn 并行）

LLM 可以在**同一条 assistant message 里发多个 `Agent` tool_use 块**。引擎不强制串行，所有子 agent 并行跑，结果各自独立返回。

主 agent 提示词里有引导：[`prompt.ts:271`](../apps/electron/src/engine/tools/AgentTool/prompt.ts#L271) 之类的位置写着 "Use a single message with multiple tool uses"。

> **通俗讲**：让 3 个实习生分头查 3 个不同问题，比一个一个查快 3 倍。

#### 套路 3：后台跑 + 通知回流

`AgentTool` 入参支持 `run_in_background: true`。开启时：

1. 主 agent **立刻拿到** `{ status: 'background', agent_id: '...' }`，继续往下干别的
2. 子 agent 在后台跑（`task.isBackgrounded = true`，参考 [`LocalAgentTaskState`](../apps/electron/src/engine/tasks/LocalAgentTask/LocalAgentTask.ts#L115)）
3. 框架以 1 秒为周期 [`pollTasks()`](../apps/electron/src/engine/utils/task/framework.ts#L255) 检查后台任务状态
4. 任务完成 → [`generateTaskAttachments()`](../apps/electron/src/engine/utils/task/framework.ts#L158) 生成 `TaskAttachment[]`
5. **下一轮 user message 前面**自动塞 `<task-notification>...</task-notification>` XML 块，主 agent 看到才回头处理结果

如果 `BACKGROUND_TASKS` 被禁用，schema 里 `run_in_background` 字段会被 omit 掉（[`AgentTool.ts:121`](../apps/electron/src/engine/tools/AgentTool/AgentTool.ts#L121)），主 agent 看不到这个选项。

> **通俗讲**：你让助理出门办事，他出去了你接着开会；他办完留张便条放你桌上，你下次回办公室才看到。

#### 套路 4：teammate 群体协作（swarm）

最复杂的形态，多个独立 agent 之间能**横向通信**。

涉及的工具：
- [`TeamCreateTool`](../apps/electron/src/engine/tools/TeamCreateTool/TeamCreateTool.ts) — 主 agent 调它建一个 team，分配 team lead
- [`SendMessageTool`](../apps/electron/src/engine/tools/SendMessageTool/SendMessageTool.ts) — agent 之间发消息
- [`TaskOutputTool`](../apps/electron/src/engine/tools/TaskOutputTool/TaskOutputTool.tsx) — 查看某个 teammate 当前进度
- [`TaskStopTool`](../apps/electron/src/engine/tools/TaskStopTool/TaskStopTool.ts) — 让某个 teammate 停下来

两种部署形态：

| 形态 | 隔离方式 | 通信寻址 |
|---|---|---|
| **In-process teammate** | 同进程，AsyncLocalStorage 隔离 context（[`spawnInProcess.ts`](../apps/electron/src/engine/utils/swarm/spawnInProcess.ts)） | `to: "researcher@my-team"` 按 agentName 路由 |
| **跨进程 teammate** | 独立 OS 进程 | `to: "uds:<socket-path>"` Unix Domain Socket / `to: "bridge:<session-id>"` |

`SendMessageTool` 还支持广播 `to: "*"`（发给团队所有人）和结构化消息类型（`shutdown_request` / `plan_approval_response` 等），通过 mailbox 机制实现请求-响应模式（[`teammateMailbox.ts`](../apps/electron/src/engine/utils/teammate/teammateMailbox.ts) 类似位置）。

> **通俗讲**：项目经理建了个微信群，拉进来 researcher、reviewer、qa 三个角色。它们之间能在群里 @ 对方："hey reviewer 你看下这段对吗"。这是**横向**通信，不是只通过项目经理转发。

#### 套路 5：fork swarm

fork 模式开启时，主 agent 一次发 N 个不带 `subagent_type` 的 `Agent` tool_use，每个都触发一次 fork → **N 个克隆体并行处理子任务**，每个都带着完整对话历史。共享 prompt cache 的前缀（[`forkSubagent.ts`](../apps/electron/src/engine/tools/AgentTool/forkSubagent.ts) buildForkedMessages 注释里详述）。

> **通俗讲**：把"现在的我"复制 5 份去并行干 5 件相关的事，每份都记得我们之前的所有对话。完事后把 5 份结果合并。

---

### 4. 控制层：feature gate

CC 不是把所有套路全开，是**分层 gate**控制哪些套路在当前 build 里可用。

#### 4.1 三道关卡

```
编译时常量 (feature('NAME'))
    ↓
GrowthBook 远程实验 flag
    ↓
环境变量
    ↓
当前 build 实际启用的能力
```

| 套路 / agent | 编译时 flag | GrowthBook | 环境变量 | Klaus 默认 |
|---|---|---|---|---|
| 派活（套路 1）| 无 | 无 | 无 | ✅ 始终开 |
| 并行（套路 2）| 无 | 无 | 无 | ✅ 始终开（LLM 自由） |
| 后台（套路 3）| `BACKGROUND_TASKS` 控制 schema 字段是否出现 | 无 | 无 | ✅ 默认开 |
| swarm（套路 4）| - | `isAgentSwarmsEnabled()` | - | ⚠️ 看 GrowthBook |
| fork（套路 5）| `FORK_SUBAGENT` | - | `CLAUDE_CODE_FEATURES` 列表 | ❌ 默认关 |
| `general-purpose` | 无 | 无 | `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS` 全关 | ✅ 默认开 |
| `explore` / `plan` | `BUILTIN_EXPLORE_PLAN_AGENTS` | `tengu_amber_stoat`（3P 默认 true）| - | ⚠️ 看 GrowthBook |
| `verification` | `VERIFICATION_AGENT` | `tengu_hive_evidence`（默认 false）| - | ❌ 默认关 |

#### 4.2 编译时常量（`feature()` 调用）

CC 内部用 bun 的 bundler 在编译期把 `feature('FOO')` 调用替换成 `true`/`false` 常量。Klaus 桌面端在 dev 模式没有 bun bundler，用 [shim](../apps/electron/src/engine/shims/bun-bundle.ts) 模拟：

```ts
// apps/electron/src/engine/shims/bun-bundle.ts:12-18
const enabledFeatures = new Set(
  (process.env.CLAUDE_CODE_FEATURES ?? "").split(",").filter(Boolean),
);
export function feature(name: string): boolean {
  return enabledFeatures.has(name);
}
```

要在 Klaus 桌面端开 fork：
```bash
CLAUDE_CODE_FEATURES=FORK_SUBAGENT npm run dev
```

#### 4.3 GrowthBook 远程实验 flag

部分功能由 [`getFeatureValue_CACHED_MAY_BE_STALE()`](../apps/electron/src/engine/services/analytics/growthbook.ts) 控制 —— 这是 Anthropic 内部的 A/B 实验系统。Klaus 桌面端通常用默认值（fallback to true/false）。

> **通俗讲**：Anthropic 自己 dogfooding 时几乎全开，但发到外部用户的 build 会按 GrowthBook 配置在不同人群里灰度开关，做 A/B 对比。

#### 4.4 互斥关系

[`isForkSubagentEnabled()`](../apps/electron/src/engine/tools/AgentTool/forkSubagent.ts#L33) 第一行检查 `isCoordinatorMode()`：

```ts
if (feature('FORK_SUBAGENT')) {
  if (isCoordinatorMode()) return false        // coordinator 模式下不允许 fork
  if (getIsNonInteractiveSession()) return false  // SDK / API 模式下不允许 fork
  return true
}
```

**fork** 和 **coordinator mode**（CC 内部 orchestrator pattern）是互斥的，因为 coordinator 已经是另一种 agent 编排模式。Klaus 没启用 coordinator（[`forkSubagent.ts:9-10`](../apps/electron/src/engine/tools/AgentTool/forkSubagent.ts#L9) 注释 `coordinator mode removed — always false in Klaus`），所以 fork 只看后两个条件。

---

### 5. 决策层：主 agent 怎么挑

引擎只负责"亮出工具盒"，**真正决定用哪个套路是主 agent 的 LLM 自己**。引擎做两件事引导：

#### 5.1 把可选项透出去

`AgentTool` 的 schema description 里会**列出当前所有可用 agent**，每行格式 `- <agentType>: <whenToUse>`。CC 有两种透出模式（[`prompt.ts:59-64`](../apps/electron/src/engine/tools/AgentTool/prompt.ts#L59) `shouldInjectAgentListInMessages()`）：

- **静态内嵌**：直接在 schema description 里列出。简单但 GrowthBook flag 变化会导致 schema 缓存失效
- **动态附件**：作为 user message 的 attachment 注入，schema 不变。CC 倾向动态模式

#### 5.2 用 prompt 写"使用建议"

[`prompt.ts`](../apps/electron/src/engine/tools/AgentTool/prompt.ts) 里写了大量软引导文案：
- "独立的搜索任务用 general-purpose"
- "需要并行多个独立子任务时，在一条消息里发多个 Agent 调用"
- "长任务（超过几分钟）加 `run_in_background: true`"
- fork 开启时：`"需要继承当前对话上下文用 fork（省略 subagent_type），独立任务用 subagent_type 指定"`

#### 5.2.1 用户偏好（Agents 设置页）

CC 默认把 feature gate 全部交给编译时常量 / GrowthBook 实验 / 环境变量管，**用户没有 GUI 控制权**。Klaus 桌面端在「设置 → 智能体」页**只暴露 CC 引擎本身就有 gate 的 3 条套路**，让普通用户能直接切换。

**为什么只有 3 个开关，不是 5 个**：派活（套路 1）和同轮并行（套路 2）在 CC 引擎里**始终开启，没有 gate** —— 它们是 sub-agent 体系的基础能力。给它们加伪开关会变成"自己实现一套控制逻辑"（要么过滤工具集要么注入 prompt），违背"基于 CC 机制"的设计原则；且关掉它们等于禁用整个 sub-agent 体系，是 anti-feature。所以 UI 只暴露 CC 真有 gate 的 3、4、5 三条。

| 开关 | KV key | 默认 | 对应的 CC gate | 落地点 |
|---|---|---|---|---|
| 后台任务 | `feature.agent.background` | on | `isBackgroundTasksDisabled` | env `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`；**改后需重启 Klaus**（[`AgentTool.ts:65`](../apps/electron/src/engine/tools/AgentTool/AgentTool.ts#L65) 模块级常量） |
| 群组协作 | `feature.agent.swarm` | off | [`isAgentSwarmsEnabled()`](../apps/electron/src/engine/utils/agentSwarmsEnabled.ts#L24) | env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`；下一次 chat() 立即生效（每次调用重读 env）|
| 克隆 fork | `feature.agent.fork` | off | [`feature('FORK_SUBAGENT')`](../apps/electron/src/engine/tools/AgentTool/forkSubagent.ts#L33) | env `CLAUDE_CODE_FEATURES` 加减 `FORK_SUBAGENT`；下一次 chat() 立即生效 |

控制流：

```
SettingsStore.set('feature.agent.X', 'on'|'off')
  → IPC 'agents:apply-features'
  → engine.applyAgentFeatures()
  → 修改 process.env (3 个 env 变量)
  → 下一次 chat() 时 CC 引擎自带的 gate 函数读到新值
  → 工具 schema / 工具是否注册 自动反映
```

> **通俗讲**：UI 上的开关只是 CC 引擎已有的 3 个 gate 的可视化遥控器。开了等于"允许使用"，主 agent 自己决定要不要真用。前 1 个默认开（CC 也是默认开），后 2 个默认关（CC 也是默认关 —— 实验性能力）。

shim 改动：[`bun-bundle.ts`](../apps/electron/src/engine/shims/bun-bundle.ts) 把 `feature()` 从模块加载时一次性读 env 改成**每次调用都重读**，让运行时切换 SettingsStore 后下一次 chat 立刻读到新值。CC 内部 build 用 bun bundler 在编译期把 `feature()` 替换成常量，不受此影响。Klaus 桌面端是 dev/source build，必须走这条动态路径。

#### 5.3 工作流不是引擎硬编码

下面这些"高级模式"都不是引擎写死的 pipeline，而是**主 agent 自发组合**：

| 模式 | 主 agent 的内部决策 |
|---|---|
| **plan-then-execute** | 看到任务复杂 → 调 plan agent 拿规划 → 自己按规划执行 |
| **explore-then-decide** | 不知道改哪儿 → 调 explore（用便宜模型 haiku 扫一遍）→ 拿结果决定下一步 |
| **verification loop** | 干完事 → 调 verification agent 找漏洞 → 有问题再改 → 再 verification |
| **fork swarm** | 任务分成 N 个独立子任务 → 一次 fork N 份并行 → 合并结果 |

**结论**：同一个用户输入，不同模型能力 / 不同 prompt 调教程度，可能走完全不同路径。这也是为什么 CC 重点做 prompt engineering —— 你写的 `whenToUse` 描述质量直接决定主 agent 派活准不准。

> **通俗讲**：引擎给主 agent 一份工具说明书，剩下用还是不用、什么时候用哪个，全看主 agent 自己。聪明的主 agent 会自发组合套路，傻的主 agent 只会用 general-purpose 一把梭。

---

### 6. 数据流：state + transcript + 通信

#### 6.1 Task state（运行时状态）

`session.appState.tasks: Record<taskId, TaskState>`（[AppState.ts:147](../apps/electron/src/engine/state/AppState.ts#L147)）是**单一事实源**。每次 `setAppState()` 都会触发增量更新。

[`TaskStateBase`](../apps/electron/src/engine/Task.ts#L45) 公共字段：
- `id` / `type` / `status` / `description` / `startTime` / `endTime`
- `notified` — 是否已经把结果作为 attachment 注入下一轮 user message
- `outputFile` / `outputOffset` — 大输出文件的写入游标

[`LocalAgentTaskState`](../apps/electron/src/engine/tasks/LocalAgentTask/LocalAgentTask.ts#L115) 在此基础上加：
- `agentId` / `agentType` / `selectedAgent` / `model`
- `progress: AgentProgress` —— `toolUseCount` / `tokenCount` / `recentActivities[]` 等动态指标
- `messages: Message[]` —— sub-agent 的内部对话（按需 lazy load）
- `retain: boolean` —— UI 是否在查看该 agent transcript（true 时阻止 GC）
- `evictAfter?: number` —— 进入 terminal 时设 `Date.now() + 30_000`，到期被 [`evictTerminalTask()`](../apps/electron/src/engine/utils/task/framework.ts#L125) GC 删除

#### 6.2 Sub-agent transcript（持久化）

CC 引擎 sub-agent 的内部对话**走独立 JSONL 文件**：

```
<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl
```

每条 message 带 `isSidechain: true` + `agentId: <agent-id>` 标记（[sessionStorage.ts:889](../apps/electron/src/engine/utils/sessionStorage.ts#L889) 的 `recordTranscript` 第三个参数 `isSidechain`）。

读取入口 [`getAgentTranscript(agentId)`](../apps/electron/src/engine/utils/sessionStorage.ts#L4019) 加载并 chain-build 出该 agent 的完整对话。

> **通俗讲**：每个实习生有自己的工作笔记本，主对话是另一本。打开实习生的笔记本要专门去翻。

#### 6.3 后台任务通知回流

后台 sub-agent 完成 → 主 agent 不会立刻看到 → 等下一轮 user message 时，引擎在 user message 前面塞一段：

```xml
<task-notification>
  Agent <agent-id> (general-purpose) completed.
  Status: completed
  Description: 梳理 Klaus 架构
  Result: <final report 摘要>
</task-notification>
```

生成路径 [`getUnifiedTaskAttachments()`](../apps/electron/src/engine/utils/attachments.ts#L3303) → [`generateTaskAttachments()`](../apps/electron/src/engine/utils/task/framework.ts#L158) → 主 agent 看到 notification 自然回应。

#### 6.4 LocalAgent vs InProcessTeammate 数据形态对比

| 字段 / 概念 | LocalAgent | InProcessTeammate |
|---|---|---|
| 触发方式 | `Agent()` tool 调用 | `TeamCreateTool` + spawn |
| 隔离 | 后台异步任务，主 agent 不阻塞 | 同进程 AsyncLocalStorage，可阻塞或并发 |
| 命名 | 无 `name` 字段，UI 用 `description` | `identity.agentName` (e.g., `researcher`) |
| 生命周期管理字段 | `evictAfter` / `retain` / `notified` 三件套 | 同上 + `awaitingPlanApproval` / `permissionMode` |
| 通信 | 主 ↔ sub 单向 | 多 sub 间 SendMessage 双向 |

#### 6.5 Klaus 桌面端 main↔renderer 数据流

```
LLM 调 AgentTool
  → AgentTool 写 setAppState(tasks[id] = ...)
  → engine-host.ts setAppState hook 拦截
  → dispatchTaskChanges(prev.tasks, next.tasks)
  → push 'tasks_changed' 事件（含 sanitize 后的全量 snapshot）
  → IPC 通过 sessionEmitters[sessionId] 路由到 mainWindow
  → preload chatEvent 转发
  → renderer chat.js case 'tasks_changed': tasksBySession.set(...) + renderAgentPanel()
```

关键点：UI 是**数据驱动**而非事件驱动 —— 哪怕中间事件丢了，下一次 setAppState 会推完整快照重新覆盖，UI 自我修复。

---

### 7. UI 呈现层（Klaus 桌面端实现）

#### 7.1 Agent dialog（CC BackgroundTasksDialog 风格）

输入框旁边新增 toggle 按钮 [`#agent-toggle`](../apps/electron/src/renderer/index.html)，带角标显示运行中数量。点击弹出浮层 [`#agent-panel.agent-panel-popup`](../apps/electron/src/renderer/css/styles.css)，列出当前 session 的所有 agent。

每行展示：
- 颜色圆点（运行中带闪烁动画）
- agent 名称（`task.description` 或 `task.agentName`）
- 状态文案（运行中显示 "运行中 · N 次工具调用"，终态显示对应 i18n 文案）
- unread 徽章（completed && !notified 时显示）

#### 7.2 Status pill 五态

对齐 CC `pillLabel.ts`：

| status | 颜色 | i18n |
|---|---|---|
| pending | 默认灰 | 排队中 |
| running | 蓝色闪烁 dot | 运行中 |
| completed | 灰色 | 已完成 |
| failed | 红色 | 失败 |
| killed | 红色 | 已终止 |
| cancelled | 红色 | 已取消 |

#### 7.3 evictAfter 客户端轮询

CC main 进程的 GC 是 **lazy** 的 —— 只在下一轮 user message 触发 attachment 生成时才删 expired task。Klaus renderer 起一个 1Hz [`agentEvictionTimer`](../apps/electron/src/renderer/js/chat.js)（`setInterval(1000)`）扫描 `tasksBySession`，对 `evictAfter <= now && !retain` 的 task **客户端隐藏**（不动 main 端 state，等下次 user message 触发真删）。

> **通俗讲**：主 agent 完事的实习生会"挂着"30 秒让你看到结果，然后自动从面板淡出。不依赖任何事件触发，纯时间戳驱动。

#### 7.4 enterTeammateView / exitTeammateView

点击 agent 行 → [`enterTeammateView(taskId)`](../apps/electron/src/renderer/js/chat.js)：

1. 隐藏 `#messages`（主对话，但**保留 DOM 节点**让流式事件继续累积）
2. 显示 `#subagent-banner`（顶部带"返回"按钮）+ `#subagent-messages`（独立容器）
3. IPC 调 `agents:history(sessionId, agentId)` → main 端 [`getSubAgentHistory()`](../apps/electron/src/main/engine-host.ts) 调引擎 `getAgentTranscript(agentId)` 读 sub-agent JSONL
4. 把返回的 `ChatMessage[]` 渲染进 `#subagent-messages`

退出（点"返回"按钮 / 切 session 自动）→ [`exitTeammateView()`](../apps/electron/src/renderer/js/chat.js)：清空 `#subagent-messages`，恢复 `#messages` 显示。**主对话期间累积的流式 DOM 节点都还在**。

> **通俗讲**：切到实习生的笔记本看，主对话还在自己跑，跑完的内容你切回去就能看到。

#### 7.5 IPC 接口清单

| 频道 | 方向 | 用途 |
|---|---|---|
| `tasks_changed`（event） | main → renderer | tasks Record 全量 snapshot |
| `teammate_spawned` / `agent_progress` / `agent_done` | main → renderer | 增量事件（向后兼容，UI 已忽略，仅外部消费）|
| `agents:snapshot`（invoke）| renderer → main | 主动拉当前 session tasks（session 切换时 hydrate 用）|
| `agents:history`（invoke）| renderer → main | 拉 sub-agent transcript |

---

### 8. 实现现状

#### 8.1 已完整对齐 CC 的部分

- ✅ AppState.tasks 数据模型（含 description / evictAfter / retain / notified / agentType / agentId / progress 等所有字段）
- ✅ 三类 agent 来源（built-in / 用户 markdown / fork 框架代码）
- ✅ AgentTool 派活套路（套路 1）
- ✅ 同 turn 并行（套路 2，引擎不限制）
- ✅ 后台任务通知回流（套路 3，attachments 链路）
- ✅ Sub-agent JSONL 持久化（CC sidechain 机制现成）
- ✅ Renderer dialog UI、五态 pill、unread 徽章、evictAfter 客户端轮询
- ✅ enterTeammateView / exitTeammateView 切换交互

#### 8.2 已移植但需 feature flag 才能工作

| 能力 | 启用方式 |
|---|---|
| fork-subagent（套路 5）| 设置页「智能体 → 克隆」 / 或 `CLAUDE_CODE_FEATURES=FORK_SUBAGENT npm run dev` |
| swarm（套路 4）| 设置页「智能体 → 群组协作」 / 或 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 npm run dev` |
| `explore` / `plan` 内置 agent | `CLAUDE_CODE_FEATURES=BUILTIN_EXPLORE_PLAN_AGENTS npm run dev`（暂未接入 UI 开关）|
| `verification` 内置 agent | `CLAUDE_CODE_FEATURES=VERIFICATION_AGENT npm run dev`（暂未接入 UI 开关）|

#### 8.3 已移植但需要进一步验证

- **In-process teammate 路径**：[`spawnInProcess.ts`](../apps/electron/src/engine/utils/swarm/spawnInProcess.ts) / [`InProcessTeammateTask`](../apps/electron/src/engine/tasks/InProcessTeammateTask/) 代码移过来了，但 Klaus UI 没接入 team 创建入口（`TeamCreateTool` 默认在 tools 集合里，但用户层面没暴露快捷调用）
- **Permission bubble**（fork child 的权限上浮）：fork 开启时未端到端测试
- **Task delta summary**：[`generateTaskAttachments()`](../apps/electron/src/engine/utils/attachments.ts#L3303) 的 `deltaSummary` 计算依赖 `lastReportedToolCount` / `lastReportedTokenCount`，在 Klaus 桌面端的初始化路径里要确认这两个字段被正确维护

#### 8.4 引擎层和 UI 层的边界

| 责任 | 在哪里 |
|---|---|
| Agent definition 加载与缓存 | engine：`loadAgentsDir.ts` |
| Tool schema 生成（含 agent 列表注入）| engine：`AgentTool.tsx` + `prompt.ts` |
| Sub-agent 实例 spawn / 状态机 | engine：`LocalAgentTask.tsx` + `framework.ts` |
| State 增量 → 事件 dispatch | main：`engine-host.ts` `dispatchTaskChanges()` |
| 状态广播 IPC | main：`ipc-handlers.ts` |
| Panel 渲染 / 切换交互 | renderer：`chat.js` |
| 视觉样式 / i18n | renderer：`styles.css` + `i18n.js` |

---

### 9. 调试与扩展指南

#### 9.1 排查"agent 没出现在面板"

1. 看 main 进程日志是否有 `tasks_changed` event push
2. devtools console 看 `klausApi.agents.snapshot(currentSessionId)` 返回值
3. 确认 `task.type === 'local_agent' || 'in_process_teammate'`，否则 [`sanitizeTaskSnapshot()`](../apps/electron/src/main/engine-host.ts) 会过滤掉

#### 9.2 排查"agent 跑完不消失"

1. 看 task 的 `evictAfter` 是否被设置（终态时应该是 `Date.now() + 30_000`）
2. `retain` 是否为 true（用户在查看 transcript 会阻止 evict）
3. 客户端 `agentEvictionTimer` 是否在跑（renderer 全局变量 `agentEvictionTimer`）
4. main 端 GC 滞后是正常的，要等下一轮 user message 才真删

#### 9.3 写一个新的自定义 agent

放 `~/.claude/agents/<name>.md`：

```markdown
---
agentType: my-custom
whenToUse: 当主 agent 需要做 X 时调用我
tools: [Read, Grep]
---

System prompt 写在这里。
```

重启对话或调用 `clearAgentDefinitionsCache()` 让 [`getAgentDefinitionsWithOverrides`](../apps/electron/src/engine/tools/AgentTool/loadAgentsDir.ts#L296) 重读。

#### 9.4 关键文件 cheat sheet

| 文件 | 作用 |
|---|---|
| [Task.ts](../apps/electron/src/engine/Task.ts) | TaskStatus / TaskStateBase / generateTaskId |
| [AppState.ts](../apps/electron/src/engine/state/AppState.ts) | 全局 appState 类型 + tasks Record |
| [AgentTool/AgentTool.ts](../apps/electron/src/engine/tools/AgentTool/AgentTool.ts) | 派活入口 + fork 路由 |
| [AgentTool/builtInAgents.ts](../apps/electron/src/engine/tools/AgentTool/builtInAgents.ts) | 内置 agent 列表 |
| [AgentTool/loadAgentsDir.ts](../apps/electron/src/engine/tools/AgentTool/loadAgentsDir.ts) | 用户自定义 agent 加载 |
| [AgentTool/forkSubagent.ts](../apps/electron/src/engine/tools/AgentTool/forkSubagent.ts) | fork 实现 |
| [LocalAgentTask.tsx](../apps/electron/src/engine/tasks/LocalAgentTask/LocalAgentTask.ts) | 后台 agent 状态机 |
| [task/framework.ts](../apps/electron/src/engine/utils/task/framework.ts) | pollTasks / generateTaskAttachments / evictTerminalTask |
| [sessionStorage.ts](../apps/electron/src/engine/utils/sessionStorage.ts) | sub-agent JSONL 持久化、getAgentTranscript |
| [main/engine-host.ts](../apps/electron/src/main/engine-host.ts) | dispatchTaskChanges / getAgentTasksSnapshot / getSubAgentHistory |
| [renderer/js/chat.js](../apps/electron/src/renderer/js/chat.js) | tasksBySession / renderAgentPanel / enterTeammateView |
