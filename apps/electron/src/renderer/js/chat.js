// Klaus Desktop — Chat UI (fully aligned with Web端)

const klausApi = window.klaus

// --- State ---
let currentSessionId = null
let sessions = []
let busy = false
let streamBuffer = ''
let currentMsgGroup = null
// --- Thinking indicator 单例状态机 ---
// 单一真相源，所有 show/append/finalize/reset 都走这里
// 不管事件触发多少次，DOM 上只会有一个 indicator，不会产生孤儿节点
const thinkingUI = {
  el: null,
  startTime: 0,
  show() {
    if (this.el) return // 幂等
    // 新一轮思考开始前先给上一段 text block 收口，避免旧 msg-group 被后续 text_delta 回填
    finalizeStream()
    this.startTime = Date.now()
    const el = document.createElement('div')
    el.className = 'thinking-indicator'
    el.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div><span class="thinking-label" data-i18n="thinking_label">${tt('thinking_label')}</span>`
    const content = document.createElement('div')
    content.className = 'thinking-content'
    el.appendChild(content)
    messagesEl.appendChild(el)
    this.el = el
    scrollToBottom()
  },
  append(text) {
    if (!this.el) this.show()
    const content = this.el.querySelector('.thinking-content')
    if (content) content.textContent += text
    scrollToBottom()
  },
  finalize() {
    if (!this.el) return
    const content = this.el.querySelector('.thinking-content')?.textContent || ''
    if (!content.trim()) {
      this.el.remove() // 没思考内容：直接移除，不留 "Thought for 0s" 残骸
    } else {
      const elapsed = Math.round((Date.now() - this.startTime) / 1000)
      const done = document.createElement('div')
      done.className = 'thinking-done' + (foldsOpen ? ' open' : '')
      // Split the label into its own data-i18n span so applyI18n() picks
      // it up on language switch — the parent span keeps the duration,
      // which stays numeric across locales.
      done.innerHTML = `<div class="thinking-toggle"><span><span data-i18n="thought_for">${tt('thought_for') || 'Thought for '}</span>${elapsed}s</span><svg class="thinking-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4.5 3l3 3-3 3"/></svg></div><div class="thinking-detail">${escapeHtml(content)}</div>`
      done.querySelector('.thinking-toggle').onclick = () => setAllFolds(!foldsOpen)
      this.el.replaceWith(done)
    }
    this.el = null
    this.startTime = 0
  },
  // 清理未完成的 indicator（session 切换等场景，直接丢弃而非折叠保留）
  reset() {
    this.el?.remove()
    this.el = null
    this.startTime = 0
  },
}
// thinking-done 和 tool-item 的折叠箭头共享一个状态：点任意一个 → 全部同步开/合;
// 流式输出过程中新创建的卡片也按当前状态初始化,避免与已展开的旁邻视觉错位
let foldsOpen = false
function setAllFolds(open) {
  foldsOpen = open
  document.querySelectorAll('.thinking-done, .tool-item').forEach(el => {
    el.classList.toggle('open', open)
  })
}

let slashSkillsCache = null
let slashActiveIdx = -1
let agentPanel = { team: null, agents: new Map() }

// Task list state (mirrors CC's TasksV2Store). Per-session cache keyed by
// sessionId; currentSessionId's entry drives rendering inside the right
// Monitor panel's Tasks section. Engine pushes `task_list` events for any
// session, we cache them; switchSession also pulls a fresh snapshot from
// disk. No auto-hide timer — Monitor is an always-on surface; when all tasks
// complete the section stays so the user can see the final outcome.
// Engine tools whose tool_use blocks are suppressed from the inline message
// stream. CC's TaskCreateTool/TaskUpdateTool both return `null` from
// renderToolUseMessage() — the canonical UI is the Monitor panel's Tasks
// section, not a per-call card. Without this filter every status flip
// ("in_progress" → "completed") shows up as a raw-JSON tool card and floods
// the transcript.
const SUPPRESSED_TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate'])
let taskPanel = {
  sessions: new Map(),  // sessionId → TaskItem[]
}

const AGENT_COLOR_MAP = { blue: '#3b82f6', green: '#16a34a', purple: '#9333ea', orange: '#ea580c', red: '#dc2626', yellow: '#eab308' }
let pendingFiles = []  // { file, objectUrl, uploadId, uploading }
let sessionDom = new Map()  // sessionId → DocumentFragment cache
// sessionId → PermissionRequest[]: permission asks that arrived while the user
// was looking at a different session (cron-run sessions trigger these in the
// background). switchSession() drains the list when the user opens that session
// so the card materializes at that moment. permission_cancelled drops the entry
// here too. We don't try to render into the off-screen session's DOM because
// chat:event for off-screen sessions is fully filtered out (see
// klausApi.on.chatEvent), so no tool_use anchors exist to attach to anyway.
let pendingPermissionsBySession = new Map()
let switchSeq = 0  // monotonic; each switchSession run captures this and bails out if a newer click superseded it mid-await
let sidebarCollapsed = localStorage.getItem('klaus_sidebar_collapsed') === '1'

// sessionId → 未发送的输入（草稿）。持久化到 localStorage，应用重启后仍在。
// 后端 SessionInfo 不带草稿字段，保持纯前端状态。
const sessionDrafts = (() => {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem('klaus_session_drafts') || '{}'))) }
  catch { return new Map() }
})()
function persistDrafts() {
  const obj = {}
  for (const [k, v] of sessionDrafts) obj[k] = v
  try { localStorage.setItem('klaus_session_drafts', JSON.stringify(obj)) } catch {}
}
function setDraft(sessionId, text) {
  if (!sessionId) return
  const trimmed = (text || '').trim()
  const had = sessionDrafts.has(sessionId)
  if (trimmed) sessionDrafts.set(sessionId, text)
  else sessionDrafts.delete(sessionId)
  persistDrafts()
  // presence 变化时才重渲染侧栏，避免每个按键都 repaint
  if ((had && !trimmed) || (!had && trimmed)) renderSessionList()
}
let userMenuOpen = false

// --- Sidebar cron group state ---
// The pinned "定时任务" group at the top of the session list. Each task is a
// collapsible row; each expanded task shows its per-run sessionIds as clickable
// sub-items (one execution = one chat thread, via CronScheduler per-run ids).
let cronTasks = []                           // CronTask[] fetched on demand
const cronRunsByTask = new Map()             // taskId → CronRun[]
// Per-task expand state — each task in the cron pinned group is collapsed by
// default (just a row), and the user clicks it to reveal its run history.
const cronTaskExpanded = (() => {
  try { return new Set(JSON.parse(localStorage.getItem('klaus_cron_tasks_expanded') || '[]')) }
  catch { return new Set() }
})()
function persistCronTaskExpanded() {
  try { localStorage.setItem('klaus_cron_tasks_expanded', JSON.stringify([...cronTaskExpanded])) } catch {}
}
function isCronRunSession(id) { return typeof id === 'string' && id.startsWith('cron-run-') }

// Unread-run tracking — persists per-run-session "has the user opened this
// yet?" across restarts. When a cron run finishes, its sessionId is still
// out of the set → the task row shows a blue dot. On switchSession, we add
// the id so the dot clears. Running runs force the dot regardless of read
// state (pulsing animation indicates "in flight").
const cronReadRuns = (() => {
  try { return new Set(JSON.parse(localStorage.getItem('klaus_cron_read_runs') || '[]')) }
  catch { return new Set() }
})()
function markCronRunRead(sessionId) {
  if (!sessionId || !isCronRunSession(sessionId) || cronReadRuns.has(sessionId)) return
  cronReadRuns.add(sessionId)
  try { localStorage.setItem('klaus_cron_read_runs', JSON.stringify([...cronReadRuns])) } catch {}
}
function runNeedsDot(run) {
  if (!run) return false
  if (run.status === 'running') return true
  return !!run.sessionId && !cronReadRuns.has(run.sessionId)
}
function taskHasUnread(taskId) {
  const runs = cronRunsByTask.get(taskId) || []
  return runs.some(runNeedsDot)
}

// Channel display label — reuses the settings_ch_<id> keys that the
// Channels settings page already localizes (微信 / 飞书 / 钉钉 / ...). Stays
// current with the locale without us maintaining a second table.
function cronChannelLabel(channelId) {
  const key = 'settings_ch_' + channelId
  const v = typeof tt === 'function' ? tt(key) : key
  return v === key ? channelId : v
}
// Resolve a cron-run sessionId back to its parent task so we can seed the
// user prompt bubble before the engine JSONL exists. Returns null when the
// run isn't in the per-task run cache (refreshCronTasksForSidebar preloads
// every known task's runs on boot so this is almost always a hit).
function findCronTaskBySessionId(sid) {
  for (const task of cronTasks) {
    const runs = cronRunsByTask.get(task.id) || []
    if (runs.some(r => r.sessionId === sid)) return task
  }
  return null
}

// Exposed so cron.js (the full Scheduled Tasks view) can force a sidebar
// refresh after create/edit/delete without knowing about chat.js internals.
window.refreshCronSidebar = () => refreshCronTasksForSidebar()
// Exposed so cron.js can surface a freshly-started cron run in the sidebar
// without pulling the user out of the cron management page. Runs are always
// shown under their task in the sidebar — we just refresh to pick up the
// newly-minted row; the user decides whether to click in and watch.
// (Auto-switching meant staring at a blank chat while the engine spun up,
// which was worse than just leaving a pulsing dot in the sidebar.)
window.surfaceCronRunInSidebar = async (taskId) => {
  await refreshCronTasksForSidebar()
  if (taskId) await refreshCronRunsForTask(taskId)
}
async function refreshCronTasksForSidebar() {
  try {
    cronTasks = (await klausApi.settings.cron.list()) || []
    // Drop cached runs for tasks that no longer exist (user deleted them from
    // the cron page — engine.deleteSession already wiped their JSONLs).
    const keep = new Set(cronTasks.map(t => t.id))
    for (const tid of [...cronRunsByTask.keys()]) if (!keep.has(tid)) cronRunsByTask.delete(tid)
    // Pull a bounded page of recent runs across all tasks and fan them
    // out per-task. Serves two purposes: expanded tasks get their runs
    // preloaded (no flicker on first paint), and collapsed tasks get the
    // run data needed to compute task-level unread dots. One IPC call
    // instead of N-per-task.
    try {
      const runs = (await klausApi.settings.cron.runs({ limit: 500 })) || []
      const byTask = new Map()
      for (const r of runs) {
        if (!r?.taskId) continue
        if (!byTask.has(r.taskId)) byTask.set(r.taskId, [])
        byTask.get(r.taskId).push(r)
      }
      for (const task of cronTasks) {
        cronRunsByTask.set(task.id, byTask.get(task.id) || [])
      }
    } catch {}
    // If the currently-open chat is a cron-run whose task got deleted, the
    // JSONL is gone — the viewport is showing a zombie. Pull the engine's
    // fresh session list and fall back to the first surviving one (or the
    // welcome screen).
    if (isCronRunSession(currentSessionId)) {
      const live = await klausApi.session.list()
      if (!live.some(s => s.id === currentSessionId)) {
        sessions = live
        const next = sessions.find(s => !isCronRunSession(s.id))
        if (next) await switchSession(next.id)
        else {
          currentSessionId = null
          messagesEl.innerHTML = ''
          messagesEl.style.display = 'none'
          welcomeEl.style.display = 'flex'
        }
      }
    }
  } catch (err) {
    console.warn('[Sidebar] cron load failed:', err)
    cronTasks = []
  }
  renderSessionList()
}

async function refreshCronRunsForTask(taskId) {
  try {
    const runs = (await klausApi.settings.cron.runs({ taskId, limit: 100 })) || []
    cronRunsByTask.set(taskId, runs)
  } catch { cronRunsByTask.set(taskId, []) }
  renderSessionList()
}

// Refresh runs for every known task in one IPC call. The task-level unread
// dot depends on `cronRunsByTask.get(taskId)` — collapsed tasks never get
// their runs refreshed on the normal event path, so a freshly-fired
// scheduled run wouldn't surface any badge. This grabs a bounded page of
// the newest runs across all tasks and fans them out per-task.
async function refreshCronRunsForAllTasks() {
  if (!cronTasks || cronTasks.length === 0) return
  try {
    const runs = (await klausApi.settings.cron.runs({ limit: 500 })) || []
    const byTask = new Map()
    for (const r of runs) {
      if (!r?.taskId) continue
      if (!byTask.has(r.taskId)) byTask.set(r.taskId, [])
      byTask.get(r.taskId).push(r)
    }
    for (const task of cronTasks) {
      cronRunsByTask.set(task.id, byTask.get(task.id) || [])
    }
  } catch {}
  renderSessionList()
}

// --- DOM refs ---
const messagesEl = document.getElementById('messages')
const welcomeEl = document.getElementById('welcome')
const inputEl = document.getElementById('input')
const btnSend = document.getElementById('send')
const btnNewChat = document.getElementById('btn-new-chat')
const btnAttach = document.getElementById('attach')
const fileInput = document.getElementById('file-input')
const sessionListEl = document.getElementById('session-list')
const statusEl = document.getElementById('status')
const dropOverlay = document.getElementById('drop-overlay')
const slashMenu = document.getElementById('slash-menu')
const agentPanelEl = document.getElementById('agent-panel')

// --- Markdown + Syntax Highlighting ---
let renderMarkdown
if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer()
  // Security: escape raw HTML
  renderer.html = function(text) { return escapeHtml(typeof text === 'object' ? text.text || text.raw || '' : text) }
  // Links open in new tab
  renderer.link = function(token) {
    const href = typeof token === 'object' ? token.href : token
    const text = typeof token === 'object' ? token.text : arguments[1]
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${text || href}</a>`
  }
  // Code blocks with hljs
  renderer.code = function(token) {
    const code = typeof token === 'object' ? token.text : token
    const lang = typeof token === 'object' ? token.lang : arguments[1]
    let highlighted = escapeHtml(code)
    if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
      try { highlighted = hljs.highlight(code, { language: lang }).value } catch {}
    }
    return `<pre><code class="language-${lang || ''}">${highlighted}</code></pre>`
  }
  marked.setOptions({ breaks: true, gfm: true, renderer })
  renderMarkdown = (text) => marked.parse(text)
} else {
  renderMarkdown = (text) => {
    let html = escapeHtml(text)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="language-${lang}">${code}</code></pre>`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
    html = html.replace(/\n/g, '<br>')
    return html
  }
}

// --- Init ---
async function init() {
  // Sidebar collapse state
  if (sidebarCollapsed) document.getElementById('sidebar')?.classList.add('collapsed')

  sessions = await klausApi.session.list()
  // Kick off cron sidebar load in parallel — it renders the pinned "定时任务"
  // group above the flat session list. Non-blocking: renderSessionList() runs
  // now with an empty cronTasks, then re-renders once tasks arrive.
  refreshCronTasksForSidebar()
  renderSessionList()
  updateWelcomeGreeting()
  refreshAuthPill()
  if (typeof window.bootstrapProfile === 'function') window.bootstrapProfile()
  if (sessions.length > 0) await switchSession(sessions[0].id)

  // Re-run dynamic renders on language switch. applyI18n() in i18n.js only
  // refreshes static [data-i18n] nodes; anything built via innerHTML (the
  // sidebar, auth pill, cron banner, channel badges, …) stays stuck at the
  // tt() value from when it was last rendered. setLanguage() dispatches
  // this event so listeners can re-resolve their labels.
  window.addEventListener('klaus:lang-change', () => {
    renderSessionList()
    refreshAuthPill()
    renderCronChannelBanner(currentSessionId)
  })
}

// 刷新头部认证模式指示器
async function refreshAuthPill() {
  const pill = document.getElementById('auth-mode-pill')
  if (!pill) return
  try {
    const mode = (await klausApi.settings.kv.get('auth_mode')) || 'subscription'
    if (mode === 'subscription') {
      const status = await klausApi.auth?.status?.()
      if (status?.loggedIn) {
        pill.className = 'auth-mode-pill'
        pill.innerHTML = `<span class="dot"></span><span class="mode-label">${tt('auth_subscription')}</span><span class="mode-detail">· ${escapeHtml(status.account || tt('auth_logged_in'))}</span>`
      } else {
        pill.className = 'auth-mode-pill warning'
        pill.innerHTML = `<span class="dot"></span><span class="mode-label">${tt('auth_subscription')}</span><span class="mode-detail">· ${tt('auth_not_logged_in')}</span>`
      }
    } else {
      const models = await klausApi.settings.models.list()
      const def = models.find(m => m.isDefault) || models[0]
      if (def) {
        pill.className = 'auth-mode-pill'
        pill.innerHTML = `<span class="dot"></span><span class="mode-label">${tt('auth_custom')}</span><span class="mode-detail">· ${escapeHtml(def.name || def.model)}</span>`
      } else {
        pill.className = 'auth-mode-pill warning'
        pill.innerHTML = `<span class="dot"></span><span class="mode-label">${tt('auth_custom')}</span><span class="mode-detail">· ${tt('auth_not_configured')}</span>`
      }
    }
    pill.style.display = 'inline-flex'
  } catch {
    pill.style.display = 'none'
  }
}

// 设置页切了 auth_mode / 登录 / 登出后都会触发这个事件来刷新 pill
window.addEventListener('klaus:auth-mode-changed', refreshAuthPill)

// 点 pill 跳设置页模型 tab
document.getElementById('auth-mode-pill')?.addEventListener('click', () => {
  if (!settingsVisibleIfAny()) {
    if (typeof window.toggleSettings === 'function') window.toggleSettings('models')
  } else {
    if (typeof window.loadSettingsTab === 'function') window.loadSettingsTab('models')
  }
})

function updateWelcomeGreeting() {
  const h = new Date().getHours()
  const el = document.getElementById('welcome-greeting')
  if (el) el.textContent = h < 12 ? tt('good_morning') : h < 18 ? tt('good_afternoon') : tt('good_evening')
}

// ==================== Sessions ====================

// Channel prefix → short label key (mirrors Web 端 web-ui-chat-js.ts:176-181).
// When a session id carries one of these prefixes it was created by an external
// channel plugin; show the channel badge in the sidebar so users can tell.
const CHANNEL_PREFIXES = ['feishu', 'dingtalk', 'wechat', 'wecom', 'qq', 'telegram', 'whatsapp']
function detectChannelPrefix(sessionId) {
  for (const p of CHANNEL_PREFIXES) if (sessionId.startsWith(p + ':')) return p
  return null
}

// 草稿徽章只在"空会话 + 输入区有内容"时显示。空会话判定：
// 当前会话看 messagesEl 里有没有 DOM；非当前看 DOM 缓存；title 被 auto-title
// 覆盖过（!== 'New Chat'）直接视为有消息——后端只有 registry-only 会话才叫
// 'New Chat'，一旦落盘就会拿 firstPrompt.slice(0,50) 当 title。
function sessionHasMessages(s) {
  if (s.id === currentSessionId) return messagesEl.childNodes.length > 0
  if (sessionDom.has(s.id)) return true
  return s.title !== 'New Chat'
}

function renderSessionList() {
  sessionListEl.innerHTML = ''
  // Pinned "定时任务" group lives in its own container ABOVE the "Recents"
  // label, rendered fresh each time so the unread dots stay current.
  const cronWrap = document.getElementById('cron-pinned-wrap')
  if (cronWrap) {
    cronWrap.innerHTML = ''
    renderCronSidebarGroup(cronWrap)
  }
  // Pinned "IM 会话" group — aggregates every channel-prefixed session so
  // Recents can stay a clean list of locally-started web chats.
  const imWrap = document.getElementById('im-pinned-wrap')
  if (imWrap) {
    imWrap.innerHTML = ''
    renderImSidebarGroup(imWrap)
  }
  // Regular flat sessions, excluding cron-run sessions (they live under
  // their task in the pinned group above) and channel-prefixed sessions
  // (they live in the IM pinned group above).
  for (const s of sessions) {
    if (isCronRunSession(s.id)) continue
    if (detectChannelPrefix(s.id)) continue
    sessionListEl.appendChild(buildSessionItem(s))
  }
}

// One session row — reused by both Recents and the IM pinned group so a
// session rendered in either place looks and behaves identically.
function buildSessionItem(s) {
  const div = document.createElement('div')
  div.className = 'session-item' + (s.id === currentSessionId ? ' active' : '')
  const displayTitle = s.title && s.title !== 'New Chat' ? s.title : tt('new_chat')
  const ch = detectChannelPrefix(s.id)
  const badgeHtml = ch ? `<span class="s-channel-badge">${escapeHtml(tt('settings_ch_' + ch))}</span>` : ''
  const hasDraft = (sessionDrafts.get(s.id) || '').trim().length > 0
  const showDraft = hasDraft && !sessionHasMessages(s) && s.id !== currentSessionId
  const draftHtml = showDraft ? `<span class="s-draft-badge">${escapeHtml(tt('draft_badge'))}</span>` : ''
  div.innerHTML = `${badgeHtml}<div class="s-title">${escapeHtml(displayTitle)}</div>${draftHtml}<button class="s-del" title="${escapeHtml(tt('delete_title'))}">&times;</button>`
  div.onclick = () => switchSession(s.id)
  div.querySelector('.s-del').onclick = (e) => { e.stopPropagation(); deleteSession(s.id) }
  return div
}

// Pinned IM sessions group. Static section header (matches 定时任务 / 最近),
// body is a flat list of session rows — no sub-tree, no per-task expansion.
// Empty → whole group hidden so Recents sits flush against the sidebar nav
// when nothing is pinned.
function renderImSidebarGroup(container) {
  const imSessions = sessions.filter(s => !isCronRunSession(s.id) && detectChannelPrefix(s.id))
  if (imSessions.length === 0) return

  const group = document.createElement('div')
  group.className = 'cron-sb-group'

  const head = document.createElement('div')
  head.className = 'sidebar-section-label'
  head.textContent = tt('im_sessions')
  group.appendChild(head)

  const body = document.createElement('div')
  body.className = 'cron-sb-body'
  for (const s of imSessions) body.appendChild(buildSessionItem(s))
  group.appendChild(body)

  container.appendChild(group)
}

// Pinned "定时任务" group at top of the sidebar.
//
// Layout:
//   ▸ Group header: static muted section label, visually mirroring "最近".
//   ▸ Task row: clock icon + name + aggregate unread dot. Collapsed by
//     default; click toggles expansion. Caret only fades in on hover or
//     when open, so collapsed rows read as flat leaves.
//   ▸ Run sub-rows (when task is open): timestamp + channel badge + unread
//     dot. Click opens the run's dedicated chat thread. Active state lives
//     here only — picking a run does NOT highlight the task header above it.
//
// 零任务时整个 group 不渲染 —— 顶部已有"定时任务"入口按钮，这里再显示一个
// 空分组标题 + "还没有定时任务"文案视觉冗余。有任务才出现 pinned group。
function renderCronSidebarGroup(container) {
  if (!cronTasks || cronTasks.length === 0) return

  const group = document.createElement('div')
  group.className = 'cron-sb-group'

  const head = document.createElement('div')
  head.className = 'sidebar-section-label'
  head.textContent = tt('cron')
  group.appendChild(head)

  const body = document.createElement('div')
  body.className = 'cron-sb-body'
  for (const task of cronTasks) {
    body.appendChild(renderCronSidebarTask(task))
  }
  group.appendChild(body)

  ;(container || sessionListEl).appendChild(group)
}

function renderCronSidebarTask(task) {
  const expanded = cronTaskExpanded.has(task.id)
  const wrap = document.createElement('div')
  wrap.className = 'cron-sb-task' + (expanded ? ' open' : '')

  const head = document.createElement('div')
  head.className = 'cron-sb-task-head'
  const title = task.name || task.id
  const unread = taskHasUnread(task.id)
  head.innerHTML = `
    <svg class="cron-sb-caret" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4.5,3 7.5,6 4.5,9"/></svg>
    <svg class="cron-sb-task-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><polyline points="8,4 8,8 10.5,9.5"/></svg>
    <span class="cron-sb-task-title">${escapeHtml(title)}</span>
    ${unread ? '<span class="cron-sb-dot"></span>' : ''}`
  head.onclick = async () => {
    if (cronTaskExpanded.has(task.id)) {
      cronTaskExpanded.delete(task.id)
      persistCronTaskExpanded()
      renderSessionList()
    } else {
      cronTaskExpanded.add(task.id)
      persistCronTaskExpanded()
      // Always re-fetch on expand — a run may have fired while this task
      // was collapsed (the chat-event refresh only pokes currently-open tasks).
      // refreshCronRunsForTask ends with a renderSessionList() call.
      await refreshCronRunsForTask(task.id)
    }
  }
  wrap.appendChild(head)

  if (expanded) {
    const runs = cronRunsByTask.get(task.id) || []
    const body = document.createElement('div')
    body.className = 'cron-sb-runs'
    if (runs.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'cron-sb-run-empty'
      empty.textContent = tt('cron_runs_empty')
      body.appendChild(empty)
    } else {
      for (const run of runs) {
        body.appendChild(renderCronSidebarRun(run, task))
      }
    }
    wrap.appendChild(body)
  }
  return wrap
}

function renderCronChannelBanner(sessionId) {
  const el = document.getElementById('cron-channel-banner')
  if (!el) return
  if (!isCronRunSession(sessionId)) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  const task = findCronTaskBySessionId(sessionId)
  const binding = task?.channelBinding
  if (!binding) {
    el.hidden = true
    el.innerHTML = ''
    return
  }
  const chLabel = cronChannelLabel(binding.channelId)
  const target = binding.chatType === 'group'
    ? (tt('cron_form_channel_group') || '群 · ') + (binding.label || binding.targetId)
    : (binding.label || tt('cron_form_channel_me') || '发给你本人')
  el.innerHTML = `
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M5 9l3 3 3-3M8 12V3M3 14h10"/>
    </svg>
    <span class="cron-channel-banner-text">
      ${escapeHtml(tt('cron_chat_banner_prefix') || '运行结束会推到')}
      <strong>${escapeHtml(chLabel)}</strong> · ${escapeHtml(target)}
    </span>`
  el.hidden = false
}

function renderCronSidebarRun(run, parentTask) {
  const el = document.createElement('div')
  const active = run.sessionId && run.sessionId === currentSessionId
  el.className = 'cron-sb-run' + (active ? ' active' : '')
  const label = formatCronRunLabel(run)
  // Status tint on the dot: running pulses, failed is red, everything
  // else (success) uses the default blue. But the dot only shows if the
  // run genuinely needs attention — running OR unread.
  const needsDot = runNeedsDot(run)
  let dotClass = ''
  if (needsDot) {
    if (run.status === 'failed') dotClass = 'failed'
    else if (run.status === 'running') dotClass = 'running'
    else dotClass = 'unread'
  }
  // Tiny channel badge on runs whose parent task is IM-bound — hints that
  // the run's final text also lands in a remote chat. Purely informational;
  // clicking still opens the in-app cron-run view.
  let channelBadge = ''
  if (parentTask?.channelBinding) {
    const chLabel = cronChannelLabel(parentTask.channelBinding.channelId)
    // Chinese labels like 微信/飞书 are already 2 chars — slice stays full.
    // English labels like "Feishu" clip to "Fe" which is fine for a 20px badge.
    channelBadge = `<span class="cron-sb-run-channel" title="${escapeHtml(chLabel)}">${escapeHtml(chLabel.slice(0, 2))}</span>`
  }
  const dotHtml = needsDot ? `<span class="cron-sb-dot ${dotClass}"></span>` : ''
  el.innerHTML = `<span class="cron-sb-run-label">${escapeHtml(label)}</span>${channelBadge}${dotHtml}`
  el.onclick = () => {
    if (!run.sessionId) return
    switchSession(run.sessionId)
  }
  return el
}

function formatCronRunLabel(run) {
  const d = new Date(run.startedAt)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function switchSession(id) {
  const mySeq = ++switchSeq
  // Leaving any full-screen overlay — clicking a session in the sidebar
  // means the user wants to return to the chat surface.
  if (typeof window.hideCronView === 'function') window.hideCronView()
  if (document.getElementById('settings-view')?.classList.contains('active')) toggleSettings()

  // 必须在 DOM 搬运前快照；搬运会清空 messagesEl，之后 childNodes.length 恒为 0。
  const leavingHadContent = !!(currentSessionId && messagesEl.childNodes.length)

  // Save current session's DOM
  if (leavingHadContent) {
    const frag = document.createDocumentFragment()
    while (messagesEl.firstChild) frag.appendChild(messagesEl.firstChild)
    sessionDom.set(currentSessionId, frag)
  }

  // 离开前把输入框里的东西写进草稿。setDraft 内部会按 presence 变化触发
  // renderSessionList，所以下面紧跟的那次 render 会覆盖到最新状态。
  if (currentSessionId && currentSessionId !== id) setDraft(currentSessionId, inputEl.value)

  // 离开时回收空壳：title 还是 'New Chat'、没消息、没草稿 = 用户点了"新对话"但
  // 啥也没干。后端 newSession() 只写 registry 不落盘，delete 只是抹掉 registry
  // 条目，没磁盘副作用。channelPrefix 保护飞书/微信等渠道会话不被误删。
  if (currentSessionId && currentSessionId !== id && !leavingHadContent) {
    const leaving = sessions.find(s => s.id === currentSessionId)
    if (leaving
        && leaving.title === 'New Chat'
        && !detectChannelPrefix(leaving.id)
        && !(sessionDrafts.get(currentSessionId) || '').trim()) {
      const gone = currentSessionId
      klausApi.session.delete(gone).catch(() => {})
      sessions = sessions.filter(s => s.id !== gone)
      sessionDom.delete(gone)
    }
  }

  currentSessionId = id
  // Entering a cron-run session clears its "unread" mark — the next
  // renderSessionList reflects that (dot removed from the run row, and
  // from the parent task row if this was the last unread one).
  if (isCronRunSession(id)) markCronRunRead(id)
  renderSessionList()
  renderCronChannelBanner(id)
  messagesEl.innerHTML = ''
  resetStreamState()

  // Monitor's Tasks section reflects the new session immediately from cache
  // (if any), then refreshes from disk in the background — IPC roundtrip is
  // a few ms but rendering from cache first avoids a flash of empty section.
  renderTaskPanel()
  refreshTasksForSession(id)
  // Context section: render cached snapshot immediately, then trigger a
  // throttled re-fetch. Same cache-first pattern as tasks.
  renderContextPanel()
  refreshContextStatsThrottled(id, 0)

  // 恢复目标会话的草稿（没有则清空）
  inputEl.value = sessionDrafts.get(id) || ''
  autoResize()
  updateSendBtn()

  // Restore from DOM cache if available
  const cached = sessionDom.get(id)
  if (cached) {
    messagesEl.appendChild(cached)
    sessionDom.delete(id)
  } else {
    const history = await klausApi.session.history(id)
    // If the user clicked another session while we were awaiting history,
    // bail out: otherwise this old response would append into the new
    // session's message area and mangle both views.
    if (mySeq !== switchSeq) return
    // Cron-run sessions: engine boot adds ~100-500ms of dead air between
    // runNow returning and the first JSONL write. If history is empty and
    // we can identify the parent task, seed the user bubble from its
    // prompt so the view isn't blank. The scheduler intentionally doesn't
    // emit user_message to avoid duplicating this seed.
    if (history.length === 0 && isCronRunSession(id)) {
      const task = findCronTaskBySessionId(id)
      if (task?.prompt) {
        appendUserMsg(task.prompt)
        const runs = cronRunsByTask.get(task.id) || []
        const run = runs.find(r => r.sessionId === id)
        if (run && run.status === 'running') thinkingUI.show()
      }
    }
    for (const msg of history) renderHistoryMessage(msg)
    pruneIntermediateAssistantActions()
  }

  // Drain pending permission asks that arrived while this session was
  // off-screen (typically cron-run sessions hitting Bash/AskUserQuestion).
  // Now that messagesEl reflects this session, route them through the normal
  // showPermissionRequest path — sessionId === currentSessionId so the
  // re-entry into showPermissionRequest takes the in-session render branch.
  const queued = pendingPermissionsBySession.get(id)
  if (queued && queued.length > 0) {
    pendingPermissionsBySession.delete(id)
    for (const req of queued) showPermissionRequest(req)
  }

  // 空 session → 显示 welcome（带 chips）；有消息 → 隐藏
  const hasContent = messagesEl.childNodes.length > 0
  messagesEl.style.display = hasContent ? 'block' : 'none'
  welcomeEl.style.display = hasContent ? 'none' : 'flex'
  scrollToBottom()
  loadArtifacts(id)
}

async function newChat() {
  // 复用已有的"未使用"会话：后端 newSession() 写入 title='New Chat' 的 registry
  // 条目且不落盘（见 engine-host.ts:445）。只要 title 还是 'New Chat' 就说明
  // 用户没发过首条消息，再造一个只会让侧栏堆空壳。
  const reusable = sessions.find(s =>
    s.title === 'New Chat'
    && !detectChannelPrefix(s.id)
    && !isCronRunSession(s.id)
    && !(sessionDrafts.get(s.id) || '').trim(),
  )
  if (reusable) {
    if (reusable.id !== currentSessionId) await switchSession(reusable.id)
    inputEl.focus()
    return
  }
  const info = await klausApi.session.new()
  sessions.unshift(info)
  await switchSession(info.id)
  renderSessionList()
  inputEl.focus()
}

async function deleteSession(id) {
  const target = sessions.find(s => s.id === id)
  const titleStr = (target?.title || '').trim() || tt('untitled') || '(untitled)'
  const result = await window.klausDialog.confirm({
    title: tt('delete_session_title') || 'Delete conversation',
    message: (tt('delete_session_message') || 'Delete this conversation? This cannot be undone.\n\n{title}').replace('{title}', titleStr),
    danger: true,
    checkbox: {
      label: tt('delete_session_wipe_workspace') || 'Also delete files in this conversation\'s workspace',
      defaultChecked: false,
    },
  })
  if (!result || !result.confirmed) return
  await klausApi.session.delete(id, { wipeWorkspace: !!result.checked })
  sessions = sessions.filter(s => s.id !== id)
  sessionDom.delete(id)
  if (sessionDrafts.has(id)) { sessionDrafts.delete(id); persistDrafts() }
  if (currentSessionId === id) {
    // CRITICAL: clear currentSessionId + messagesEl BEFORE switchSession.
    // Otherwise switchSession's opening block re-caches the deleted session's
    // DOM into sessionDom[deletedId], and when the user later opens a freshly-
    // recreated session with the same channelKey (e.g. same wechat senderId
    // chatting again), switchSession reads the stale DOM cache and shows the
    // old conversation instead of the new one.
    messagesEl.innerHTML = ''
    resetStreamState()
    currentSessionId = null
    if (sessions.length > 0) await switchSession(sessions[0].id)
    else { messagesEl.style.display = 'none'; welcomeEl.style.display = 'flex' }
  }
  renderSessionList()
}

function resetStreamState() {
  streamBuffer = ''; currentMsgGroup = null
  thinkingUI.reset() // 丢弃上一轮未完成的 indicator（含 DOM）
  agentPanel = { team: null, agents: new Map() }
  if (agentPanelEl) agentPanelEl.style.display = 'none'
}

// ==================== Message-meta (time + copy) helpers ====================

// HH:MM for today, MM-DD HH:MM otherwise. Empty string if ts is missing/bad.
function formatMsgTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => n.toString().padStart(2, '0')
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return sameDay ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

function appendTimeLabel(bar, ts) {
  const text = formatMsgTime(ts)
  if (!text) return
  const span = document.createElement('span')
  span.className = 'msg-time'
  span.textContent = text
  bar.appendChild(span)
}



const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'

function copyTextToClipboard(text, btn) {
  navigator.clipboard.writeText(text || '').then(() => {
    if (!btn) return
    btn.classList.add('copied')
    btn.innerHTML = CHECK_ICON_SVG
    btn.setAttribute('aria-label', tt('copied'))
    setTimeout(() => {
      btn.classList.remove('copied')
      btn.innerHTML = COPY_ICON_SVG
      btn.setAttribute('aria-label', tt('copy'))
    }, 1500)
  }).catch(() => {
    if (btn) btn.setAttribute('aria-label', tt('copy_failed'))
  })
}

// Icon-only copy button. `getText` is called at click time so streaming text
// can finalize before being read.
function makeCopyButton(getText) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'msg-action-btn'
  btn.innerHTML = COPY_ICON_SVG
  btn.title = tt('copy')
  btn.setAttribute('aria-label', tt('copy'))
  btn.onclick = (e) => { e.stopPropagation(); copyTextToClipboard(getText() || '', btn) }
  return btn
}

function ensureMsgActions(group) {
  if (!group) return null
  let bar = group.querySelector(':scope > .msg-actions')
  if (!bar) {
    bar = document.createElement('div')
    bar.className = 'msg-actions'
    group.appendChild(bar)
  }
  return bar
}

// Rewind = curved-arrow back; Delete = trash. Same 24x24 viewBox + stroke
// style as the copy icon so the row stays visually homogeneous.
const REWIND_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-15-6.7L3 13"></path></svg>'
const TRASH_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>'

function makeIconActionBtn(svg, label, onClick, opts = {}) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'msg-action-btn' + (opts.danger ? ' danger' : '')
  btn.innerHTML = svg
  btn.title = label
  btn.setAttribute('aria-label', label)
  btn.onclick = (e) => { e.stopPropagation(); onClick(btn) }
  return btn
}

// Rewind/delete buttons for a user bubble. The user message must already have
// been written to the JSONL — i.e. uuid is present. For just-sent live
// messages the buttons are attached lazily after the `done` event via
// refreshLiveUserUuids() once the host has flushed the line.
function attachUserMessageActions(group, uuid, originalText) {
  if (!group || !uuid) return
  const bar = ensureMsgActions(group)
  if (!bar || bar.querySelector('[data-action="rewind"]')) return
  const sessionAtBind = currentSessionId
  // Per-bubble re-entry lock — without this a second click while the dialog
  // confirm is still awaiting fires a second IPC. Engine logs showed the same
  // truncate request twice in a row before this guard.
  let inFlight = false
  const rewindBtn = makeIconActionBtn(REWIND_ICON_SVG, tt('msg_rewind'), async () => {
    if (busy || inFlight) return
    if (!(await window.klausDialog.confirm({ message: tt('msg_rewind_confirm') }))) return
    if (inFlight) return
    inFlight = true
    try {
      const res = await klausApi.chat.rewindFrom(sessionAtBind, uuid)
      if (!res?.ok) {
        await window.klausDialog.alert(`撤销失败：${res?.reason || 'unknown'}`)
        return
      }
      if (typeof res.text === 'string' && res.text) {
        inputEl.value = res.text
        autoResize()
        inputEl.focus()
      }
      await reloadSessionTranscript(sessionAtBind)
    } catch (err) {
      await window.klausDialog.alert(String(err?.message || err))
    } finally {
      inFlight = false
    }
  })
  rewindBtn.dataset.action = 'rewind'
  const deleteBtn = makeIconActionBtn(TRASH_ICON_SVG, tt('msg_delete'), async () => {
    if (busy || inFlight) return
    if (!(await window.klausDialog.confirm({ message: tt('msg_delete_confirm'), danger: true }))) return
    if (inFlight) return
    inFlight = true
    try {
      const res = await klausApi.chat.deleteFrom(sessionAtBind, uuid)
      if (!res?.ok) {
        await window.klausDialog.alert(`删除失败：${res?.reason || 'unknown'}`)
        return
      }
      await reloadSessionTranscript(sessionAtBind)
    } catch (err) {
      await window.klausDialog.alert(String(err?.message || err))
    } finally {
      inFlight = false
    }
  }, { danger: true })
  deleteBtn.dataset.action = 'delete'
  // Insert before the copy button so the row reads: time, rewind, delete, copy.
  const copyBtn = bar.querySelector('.msg-action-btn:not([data-action])')
  if (copyBtn) {
    bar.insertBefore(rewindBtn, copyBtn)
    bar.insertBefore(deleteBtn, copyBtn)
  } else {
    bar.appendChild(rewindBtn)
    bar.appendChild(deleteBtn)
  }
}

// After rewind/delete (host truncated the JSONL), repaint the current view
// from the freshly-loaded transcript. Drops cached DOM fragments so a future
// switchSession picks up the updated state too.
async function reloadSessionTranscript(sessionId) {
  if (!sessionId || sessionId !== currentSessionId) return
  sessionDom.delete(sessionId)
  const history = await klausApi.session.history(sessionId)
  messagesEl.innerHTML = ''
  resetStreamState()
  if (history.length === 0) {
    messagesEl.style.display = 'none'
    welcomeEl.style.display = 'flex'
    return
  }
  messagesEl.style.display = 'block'
  welcomeEl.style.display = 'none'
  for (const msg of history) renderHistoryMessage(msg)
  pruneIntermediateAssistantActions()
  // Artifacts panel — host rebuilt the session_artifacts table from the
  // truncated transcript, so refresh the panel to drop ghost rows.
  try { if (typeof loadArtifacts === 'function') await loadArtifacts(sessionId) } catch {}
}

// Live-stream user bubbles render before the engine has flushed their line to
// disk, so they don't carry a uuid. After the turn finishes (`done` event)
// pull a fresh history snapshot and patch user bubbles in DOM order — same
// filter rules as getHistory so positional matching is stable.
async function refreshLiveUserUuids(sessionId) {
  if (!sessionId || sessionId !== currentSessionId) return
  let history
  try { history = await klausApi.session.history(sessionId) } catch { return }
  if (!Array.isArray(history)) return
  if (sessionId !== currentSessionId) return
  const userMsgs = history.filter(m => m && m.role === 'user')
  const groups = messagesEl.querySelectorAll('.msg-group.user')
  const n = Math.min(groups.length, userMsgs.length)
  for (let i = 0; i < n; i++) {
    const group = groups[i]
    if (group.dataset.uuid) continue
    const u = userMsgs[i]?.uuid
    if (!u) continue
    group.dataset.uuid = u
    attachUserMessageActions(group, u, userMsgs[i].text || '')
  }
}

// ==================== Send ====================

async function send() {
  const text = inputEl.value.trim()
  if (!text && pendingFiles.length === 0) return
  if (busy) return
  if (!currentSessionId) await newChat()
  busy = true
  btnSend.disabled = false           // busy 态按钮仍可点击（用于中断）
  btnSend.classList.add('busy')      // 切到停止图标 + 深色实心
  const finalText = inputEl.value.trim()
  inputEl.value = ''; autoResize(); hideSlashMenu()
  // 发送后清掉本会话的草稿（走 setDraft 以便触发侧栏重渲染，去掉残留的草稿徽章）
  if (currentSessionId) setDraft(currentSessionId, '')

  // Collect uploaded file paths
  const media = pendingFiles
    .filter(e => e.uploadPath)
    .map(e => ({ type: e.file.type.startsWith('image/') ? 'image' : 'file', path: e.uploadPath, name: e.file.name }))
  const fileNames = pendingFiles.map(e => e.file.name)
  pendingFiles = []; renderPreviews()

  // Show user message with file badges
  const displayText = fileNames.length > 0
    ? `[Files: ${fileNames.join(', ')}]${finalText ? ' ' + finalText : ''}`
    : finalText
  // 从 welcome 态切到消息态（第一条消息发送时）
  welcomeEl.style.display = 'none'
  messagesEl.style.display = 'block'
  appendUserMsg(displayText)
  resetStreamState()
  thinkingUI.show() // 立即显示"三个点在转"，覆盖 requesting 到 thinking 开始之间的空白期
  // The user message has been pushed to session.messages on the main side;
  // refresh the context monitor right away so the bar reflects "your input
  // landed" instead of staying frozen until the turn fully completes.
  refreshContextStatsThrottled(currentSessionId, 200)
  await klausApi.chat.send(currentSessionId, finalText, media.length > 0 ? media : undefined)
}

// 欢迎页 chip 点击：把 chip 文字填到输入框并触发 input 事件（对齐 Web 端，不自动发送）
document.querySelectorAll('.welcome-chip[data-chip]').forEach(chip => {
  chip.addEventListener('click', () => {
    inputEl.value = chip.textContent || ''
    inputEl.dispatchEvent(new Event('input'))
    inputEl.focus()
  })
})

// ==================== Slash command menu ====================

async function fetchSkills() {
  if (slashSkillsCache) return slashSkillsCache
  try {
    const skills = await klausApi.skills.list()
    slashSkillsCache = skills.filter(s => s.enabled)
    return slashSkillsCache
  } catch { return [] }
}

async function handleSlashMenu() {
  const text = inputEl.value
  if (!text.startsWith('/') || text.includes(' ') || text.includes('\n')) { hideSlashMenu(); return }
  const query = text.slice(1).toLowerCase()
  const skills = await fetchSkills()
  const builtins = [
    { name: 'new', description: tt('slash_new_desc') },
    { name: 'clear', description: tt('slash_clear_desc') },
    { name: 'help', description: tt('slash_help_desc') },
  ]
  const all = [...builtins, ...skills]
  const filtered = query ? all.filter(s => s.name.toLowerCase().includes(query)) : all
  if (filtered.length === 0) { hideSlashMenu(); return }
  showSlashMenu(filtered)
}

function showSlashMenu(items) {
  slashMenu.classList.remove('hidden')
  slashMenu.innerHTML = ''
  slashActiveIdx = 0
  items.forEach((s, i) => {
    const el = document.createElement('div')
    el.className = 'slash-menu-item' + (i === 0 ? ' active' : '')
    el.innerHTML = `<span class="slash-menu-item-name">/${escapeHtml(s.name)}</span>${s.description ? `<span class="slash-menu-item-desc">${escapeHtml(s.description)}</span>` : ''}`
    el.onclick = () => selectSlashItem(s)
    slashMenu.appendChild(el)
  })
}

function hideSlashMenu() { slashMenu.classList.add('hidden'); slashActiveIdx = -1 }

function selectSlashItem(skill) {
  inputEl.value = '/' + skill.name + ' '
  autoResize(); updateSendBtn(); hideSlashMenu(); inputEl.focus()
}

function navigateSlashMenu(dir) {
  const items = slashMenu.querySelectorAll('.slash-menu-item')
  if (!items.length) return
  items[slashActiveIdx]?.classList.remove('active')
  slashActiveIdx = (slashActiveIdx + dir + items.length) % items.length
  items[slashActiveIdx]?.classList.add('active')
  items[slashActiveIdx]?.scrollIntoView({ block: 'nearest' })
}

// ==================== Message rendering ====================

const fileSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>'
const imgSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'

function appendUserMsg(text, ts, uuid) {
  const group = document.createElement('div')
  group.className = 'msg-group user'
  if (uuid) group.dataset.uuid = uuid
  let html = escapeHtml(text)
  // File badges
  html = html.replace(/\[Files?: (.+?)\]/g, (_, names) =>
    names.split(',').map(n => `<span class="file-badge">${fileSvg} ${escapeHtml(n.trim())}</span>`).join(' '))
  html = html.replace(/\[Pasted image\]/g, `<span class="file-badge">${imgSvg} image</span>`)
  // Image badges from history
  html = html.replace(/\[图片: (.+?)\]/g, (_, name) => `<span class="file-badge">${imgSvg} ${escapeHtml(name)}</span>`)
  html = html.replace(/\[图片\]/g, `<span class="file-badge">${imgSvg} image</span>`)
  html = html.replace(/\[文件: (.+?)\]/g, (_, name) => `<span class="file-badge">${fileSvg} ${escapeHtml(name)}</span>`)
  // Uploaded image paths → render actual images
  html = html.replace(/@(\/[^\s]+\.(png|jpg|jpeg|gif|webp))/gi, (_, path) =>
    `<img src="file://${escapeHtml(path)}" style="max-height:200px;border-radius:8px;margin:4px 0;display:block">`)
  group.innerHTML = `<div class="msg user">${html}</div>`
  // Time label + copy button. Time first so it sits LEFT of the icon.
  const bar = ensureMsgActions(group)
  appendTimeLabel(bar, ts ?? Date.now())
  bar.appendChild(makeCopyButton(() => text))
  // Rewind/delete only available once the message has a uuid — live (just-sent)
  // bubbles get the buttons retroactively in refreshLiveUserUuids() after `done`.
  if (uuid) attachUserMessageActions(group, uuid, text)
  messagesEl.appendChild(group)
  scrollToBottom()
}

function appendFinalAssistantMsg(text, ts) {
  const group = document.createElement('div')
  group.className = 'msg-group assistant'
  const msgEl = document.createElement('div')
  msgEl.className = 'msg assistant'
  msgEl.innerHTML = renderMarkdown(text)
  // Stash the raw markdown source for the copy button — the rendered HTML
  // alone can't be reversed back to original markdown.
  msgEl.dataset.md = text || ''
  group.appendChild(msgEl)
  postProcessMsg(msgEl)
  const bar = ensureMsgActions(group)
  appendTimeLabel(bar, ts ?? Date.now())
  bar.appendChild(makeCopyButton(() => msgEl.dataset.md || ''))
  messagesEl.appendChild(group)
}

// CC's persisted slash-command breadcrumb: a "/compact" pill rendered like a
// terse command line, not a regular user bubble. Same visual grammar a CLI
// transcript would show — terminal prompt + command — so users reading the
// reloaded conversation see "ah, here's where I ran /compact".
function appendSlashCommandRow(commandName) {
  const group = document.createElement('div')
  group.className = 'msg-group system slash-command-row'
  const inner = document.createElement('div')
  inner.className = 'slash-command-pill'
  inner.innerHTML = `<span class="slash-command-prompt">/</span><span class="slash-command-name">${escapeHtml(commandName || 'command')}</span>`
  group.appendChild(inner)
  messagesEl.appendChild(group)
}

// Captured stdout from a local command (e.g. compact's "Compacted X→Y").
// Dim system row, mirrors how CC TUI shows local-command-stdout.
function appendCommandStdoutRow(text) {
  const group = document.createElement('div')
  group.className = 'msg-group system command-stdout-row'
  const inner = document.createElement('div')
  inner.className = 'command-stdout-text'
  inner.textContent = text
  group.appendChild(inner)
  messagesEl.appendChild(group)
}

// Single dispatch point used by both initial history load (switchSession,
// truncateAtMessage flow) and post-compact reload. Handles the three special
// kinds that need bespoke rendering plus the default user/assistant bubbles.
function renderHistoryMessage(msg) {
  if (msg.kind === 'slash-command') return appendSlashCommandRow(msg.commandName || msg.text)
  if (msg.kind === 'command-stdout') return appendCommandStdoutRow(msg.text)
  if (msg.role === 'user') return appendUserMsg(msg.text, msg.timestamp, msg.uuid)
  if (Array.isArray(msg.contentBlocks)) return appendAssistantFromBlocks(msg.contentBlocks, msg.timestamp, msg.thinkingDurationMs)
  return appendFinalAssistantMsg(msg.text, msg.timestamp)
}

// Restore an assistant turn from its original engine content block array.
// Mirrors the live-stream rendering (thinking fold + tool cards + text), so
// Cmd+R reload looks identical to what the user saw during streaming. Block
// shapes match CC: { type: 'thinking', thinking } / { type: 'text', text } /
// { type: 'tool_use', name, id, input } / { type: 'tool_result', ... }.
// `thinkingDurationMs`：getHistory 从 sidecar JSON 读到的 live 测时长（如果有），
// 用来还原 "Thought for Xs"。没记到（旧会话或非 thinking 模型）就退回 "…"。
//
// 渲染顺序遵循 contentBlocks 数组次序 —— 这次渲染流（thinking → text → tool 或
// thinking → tool → text，由模型实际发出顺序决定）跟 live 一致。多个连续
// thinking block 累成一个 fold；同一段连续 tool_use 进同一个 tool-container；
// text 块各自起一个 bubble（被 tool / thinking 切开就分段）。
function appendAssistantFromBlocks(blocks, ts, thinkingDurationMs) {
  if (!Array.isArray(blocks) || blocks.length === 0) return

  let pendingThinking = ''
  let thinkingDurationUsed = false  // 一次 msg 里可能有多段 thinking，duration 只挂第一段
  let pendingText = ''
  let toolContainer = null  // 当前累积工具卡片的 .tool-container；遇到 text/thinking 后置 null，下一个 tool 会新建

  const flushThinking = () => {
    if (!pendingThinking.trim()) { pendingThinking = ''; return }
    const dur = (!thinkingDurationUsed && typeof thinkingDurationMs === 'number' && Number.isFinite(thinkingDurationMs) && thinkingDurationMs >= 0)
      ? `${Math.max(1, Math.round(thinkingDurationMs / 1000))}s`
      : '…'
    const done = document.createElement('div')
    done.className = 'thinking-done' + (foldsOpen ? ' open' : '')
    done.innerHTML = `<div class="thinking-toggle"><span><span data-i18n="thought_for">${tt('thought_for') || 'Thought for '}</span>${dur}</span><svg class="thinking-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4.5 3l3 3-3 3"/></svg></div><div class="thinking-detail">${escapeHtml(pendingThinking)}</div>`
    done.querySelector('.thinking-toggle').onclick = () => setAllFolds(!foldsOpen)
    messagesEl.appendChild(done)
    pendingThinking = ''
    thinkingDurationUsed = true
    toolContainer = null
  }
  const flushText = () => {
    if (!pendingText.trim()) { pendingText = ''; return }
    appendFinalAssistantMsg(pendingText, ts)
    pendingText = ''
    toolContainer = null
  }

  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'thinking' || b.type === 'redacted_thinking') {
      // thinking 出现在 text 后面（罕见）：先把之前的 text bubble 收口
      flushText()
      pendingThinking += (b.thinking ?? b.data ?? '')
    } else if (b.type === 'text' && typeof b.text === 'string') {
      flushThinking()
      pendingText += b.text
      toolContainer = null
    } else if (b.type === 'tool_use') {
      flushThinking()
      flushText()
      if (b.name === 'AskUserQuestion') {
        rebuildAskUserQuestionCard(b)
        toolContainer = null
        continue
      }
      // Skip Agent — its sub-tools and resolution are reconstructed elsewhere;
      // showing it as a plain card would duplicate the agent panel info.
      if (getToolCategory(b.name || '') === 'agent') continue
      // Skip TaskCreate/TaskUpdate — surfaced by the task panel; mirrors the
      // live-stream filter in appendToolStart (CC suppresses these via
      // renderToolUseMessage() returning null).
      if (SUPPRESSED_TASK_TOOLS.has(b.name || '')) continue
      if (!toolContainer) {
        toolContainer = document.createElement('div')
        toolContainer.className = 'tool-container'
        toolContainer.dataset.done = '1'
        messagesEl.appendChild(toolContainer)
      }
      const item = renderToolCard(b.name || '', b.id || '', b.input, 'done')
      // engine-host.getHistory attaches __result onto the tool_use block when a
      // matching tool_result was found in the same transcript pass.
      const result = sanitizeToolOutput(b.__result)
      if (result) {
        const outPre = ensureToolOutputPre(item)
        if (outPre) {
          outPre.textContent = result
          updateOutputMeta(outPre)
        }
      }
      toolContainer.appendChild(item)
    }
  }
  // Trailing flushes — order matters: thinking before text so a final
  // thinking-only block lands before any (empty) text segment would.
  flushThinking()
  flushText()
}

function ensureAssistantGroup() {
  if (!currentMsgGroup) {
    currentMsgGroup = document.createElement('div')
    currentMsgGroup.className = 'msg-group assistant'
    messagesEl.appendChild(currentMsgGroup)
  }
  return currentMsgGroup
}

// --- Code block enhancement ---
function postProcessMsg(container) {
  container.querySelectorAll('pre code').forEach(block => {
    // Language label
    const langClass = [...block.classList].find(c => c.startsWith('language-'))
    const lang = langClass ? langClass.replace('language-', '') : ''
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block'
    block.parentElement.replaceWith(wrapper)
    wrapper.appendChild(block.parentElement)
    if (lang && lang !== 'plaintext') {
      const badge = document.createElement('span')
      badge.className = 'code-lang'
      badge.textContent = lang
      wrapper.appendChild(badge)
    }
    // Copy button
    const btn = document.createElement('button')
    btn.className = 'code-copy'
    btn.textContent = tt('copy')
    btn.onclick = () => {
      navigator.clipboard.writeText(block.textContent).then(() => {
        btn.textContent = tt('copied')
        setTimeout(() => { btn.textContent = tt('copy') }, 2000)
      }).catch(() => { btn.textContent = tt('copy_failed'); setTimeout(() => { btn.textContent = tt('copy') }, 2000) })
    }
    wrapper.appendChild(btn)
  })
}

// --- Thinking 函数全部迁移到 thinkingUI 单例对象（定义在文件顶部） ---

// --- Streaming text ---
function appendStreamText(text) {
  // 防御：text 开始流但 thinking 还没收口（mode 跳过 responding 直接进 tool-use/text）。
  // 不主动 finalize 的话，thinking-indicator 720px 大盒子就一直挂在 user 和 assistant 之间。
  if (thinkingUI.el) thinkingUI.finalize()
  streamBuffer += text
  const group = ensureAssistantGroup()
  let msgEl = group.querySelector('.msg.assistant')
  if (!msgEl) {
    msgEl = document.createElement('div')
    msgEl.className = 'msg assistant streaming'
    group.appendChild(msgEl)
  }
  msgEl.innerHTML = renderMarkdown(streamBuffer)
  msgEl.dataset.md = streamBuffer
  msgEl.classList.add('streaming')
  // 流式三点指示器：紧贴文字末尾 inline，每次 innerHTML 重渲染后重新追加。
  const dots = document.createElement('span')
  dots.className = 'streaming-dots'
  dots.innerHTML = '<span></span><span></span><span></span>'
  msgEl.appendChild(dots)
  scrollToBottom()
}

function finalizeStream() {
  if (!currentMsgGroup) return
  const msgEl = currentMsgGroup.querySelector('.msg.assistant.streaming')
  if (msgEl) {
    msgEl.classList.remove('streaming')
    postProcessMsg(msgEl)
    // 不在这里挂时间+复制按钮 —— 一轮里 text 段可能被 tool_use 切成多段，
    // 中间段不该带按钮。统一在 `done` 事件里给本轮最后一段挂
    // (attachCopyToTurnTail)。
  }
  // 对齐 cc 的 content-block 模型：每段 text block 到此收口。
  // 下一段 text_delta 必须新建 msg-group，不能回填旧组——否则 tool_use 之后的第二段正文
  // 会覆盖到第一段上面的旧气泡里，顺序和光标都会错位。
  currentMsgGroup = null
  streamBuffer = ''
}

// 给本轮最后一段 assistant text 气泡挂时间+复制按钮。在 `done` 时调用。
function attachCopyToTurnTail() {
  const groups = messagesEl.querySelectorAll(':scope > .msg-group.assistant')
  const last = groups[groups.length - 1]
  if (!last) return
  const msgEl = last.querySelector(':scope > .msg.assistant')
  if (!msgEl) return
  const bar = ensureMsgActions(last)
  if (bar.querySelector('.msg-action-btn')) return
  appendTimeLabel(bar, Date.now())
  bar.appendChild(makeCopyButton(() => msgEl.dataset.md || ''))
}

// 历史还原时每条 assistant 行各自走 appendFinalAssistantMsg 都挂了按钮,
// 走完整列表后用这个把"中间段"按钮拿掉 —— 一段是不是中间段，看它后面在遇到
// 下一个 .msg-group.user 之前是否还有 .msg-group.assistant。
function pruneIntermediateAssistantActions() {
  const groups = messagesEl.querySelectorAll(':scope > .msg-group.assistant')
  for (const group of groups) {
    let next = group.nextElementSibling
    while (next) {
      if (next.classList?.contains('msg-group')) {
        if (next.classList.contains('user')) break // 下一轮 — 当前是末尾段，保留
        if (next.classList.contains('assistant')) {
          group.querySelector(':scope > .msg-actions')?.remove()
          break
        }
      }
      next = next.nextElementSibling
    }
  }
}

// ==================== Tool rendering ====================

function getToolCategory(name) {
  if (/bash/i.test(name)) return 'terminal'
  if (/file|read|write|edit|glob|notebook/i.test(name)) return 'file'
  if (/grep|search|web/i.test(name)) return 'search'
  if (/agent/i.test(name)) return 'agent'
  return ''
}

// CC 引擎在某些工具结果里注入 <system-reminder> 给模型看（如 FileReadTool 的
// 反恶意代码提示）。后端 stringifyToolResultContent 已经过滤一次，这里是 UI
// 层的兜底，确保展示给用户的 Output 永远不会带 system-reminder。
const SYSTEM_REMINDER_RE = /\n*<system-reminder>[\s\S]*?<\/system-reminder>\n*/g
function sanitizeToolOutput(text) {
  if (typeof text !== 'string' || !text) return ''
  return text.replace(SYSTEM_REMINDER_RE, '').trimEnd()
}

function toolValueText(toolName, args) {
  if (!args || typeof args !== 'object') return ''
  if (toolName === 'AskUserQuestion') {
    // Interactive card rendered below by showAskUserQuestionRequest already
    // shows the questions in a readable form — don't duplicate the raw JSON.
    return ''
  }
  if (args.command) return '$ ' + args.command
  if (args.file_path) return args.file_path
  if (args.pattern) return args.pattern
  const v = JSON.stringify(args)
  return v.length > 80 ? v.slice(0, 80) + '...' : v
}

// Lucide-style stroke icons keyed by tool name. 13px stroke, currentColor —
// each CC/Klaus tool gets its own visual identity so the user can scan a long
// tool list and tell what's happening at a glance. Match by exact name first,
// then by name pattern, fallback to a generic wrench.
function toolIconForName(toolName) {
  const a = 'class="tool-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
  const n = toolName || ''

  // Bash family — terminal prompt
  if (n === 'Bash' || n === 'KillBash' || n === 'BashOutput') {
    return `<svg ${a}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`
  }
  // Read / NotebookRead — file with text lines
  if (n === 'Read' || n === 'NotebookRead') {
    return `<svg ${a}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`
  }
  // Write — file plus
  if (n === 'Write') {
    return `<svg ${a}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`
  }
  // Edit / MultiEdit / NotebookEdit — pencil
  if (/Edit$/.test(n)) {
    return `<svg ${a}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`
  }
  // Glob — asterisk-pattern (8-ray star, evokes wildcard match)
  if (n === 'Glob') {
    return `<svg ${a}><line x1="12" y1="6" x2="12" y2="18"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="7.76" y1="7.76" x2="16.24" y2="16.24"/><line x1="7.76" y1="16.24" x2="16.24" y2="7.76"/></svg>`
  }
  // Grep / ToolSearch — magnifying glass
  if (n === 'Grep' || n === 'ToolSearch') {
    return `<svg ${a}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
  }
  // Web — globe
  if (n.startsWith('Web')) {
    return `<svg ${a}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`
  }
  // Agent / Task family — user circle
  if (n === 'Agent' || n.startsWith('Task')) {
    return `<svg ${a}><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>`
  }
  // TodoWrite — checklist
  if (n === 'TodoWrite') {
    return `<svg ${a}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`
  }
  // AskUserQuestion — help circle
  if (n === 'AskUserQuestion') {
    return `<svg ${a}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  }
  // PlanMode — clipboard with check
  if (/PlanMode$/.test(n)) {
    return `<svg ${a}><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><polyline points="9 14 11 16 15 12"/></svg>`
  }
  // Notebook generic — open book
  if (/Notebook/.test(n)) {
    return `<svg ${a}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`
  }
  // Cron / Schedule — clock
  if (n.startsWith('Cron') || n.startsWith('Schedule')) {
    return `<svg ${a}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
  }
  // PushNotification — bell
  if (n === 'PushNotification') {
    return `<svg ${a}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`
  }
  // Monitor / RemoteTrigger — activity pulse line
  if (n === 'Monitor' || n === 'RemoteTrigger') {
    return `<svg ${a}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`
  }
  // Worktree — git branch
  if (/Worktree$/.test(n)) {
    return `<svg ${a}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`
  }
  // MCP tools — plug
  if (n.startsWith('mcp__')) {
    return `<svg ${a}><path d="M9 2v6"/><path d="M15 2v6"/><path d="M12 17v5"/><path d="M5 8h14a2 2 0 0 1 2 2v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a2 2 0 0 1 2-2z"/></svg>`
  }
  // Fallback — generic wrench
  return `<svg ${a}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`
}
function toolChevronSvg() {
  return '<svg class="tool-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.5 3l3 3-3 3"/></svg>'
}
function toolCheckSvg() {
  return '<svg class="tool-check" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6.5 5 9 9.5 3.5"/></svg>'
}
function formatToolInput(args) {
  if (!args || typeof args !== 'object') return ''
  try { return JSON.stringify(args, null, 2) } catch { return String(args) }
}

function renderToolStatus(state) {
  if (state === 'running') {
    return `<span class="tool-status running"><span class="tool-dot"></span><span>${escapeHtml(tt('tool_running') || 'Running')}</span></span>`
  }
  if (state === 'error') {
    return `<span class="tool-status error">${escapeHtml(tt('tool_failed'))}</span>`
  }
  return `<span class="tool-status done">${toolCheckSvg()}</span>`
}

// Wire up a copy button: copies the textContent of the sibling .tool-detail-pre
// or .tool-detail-fields block (whichever is present in the same .tool-detail-block).
function bindCopyButton(btn) {
  btn.onclick = (ev) => {
    ev.stopPropagation()
    const block = btn.closest('.tool-detail-block')
    if (!block) return
    const src = block.querySelector('.tool-detail-pre, .tool-detail-fields')
    const text = src ? (src.dataset.copyText || src.textContent || '') : ''
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent
      btn.textContent = tt('copied') || 'Copied!'
      setTimeout(() => { btn.textContent = orig }, 1500)
    }).catch(() => { btn.textContent = tt('copy_failed') || 'Failed'; setTimeout(() => { btn.textContent = tt('copy') || 'Copy' }, 1500) })
  }
}

// Decide if Input args render as a structured key-value grid (专业、易扫读)
// or fall back to a JSON pre block. Grid is used when args is a plain object
// with at most 6 keys whose values are all primitives (string/number/boolean).
function shouldRenderInputAsFields(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false
  const keys = Object.keys(args).filter((k) => !k.startsWith('__'))
  if (keys.length === 0 || keys.length > 6) return false
  return keys.every((k) => {
    const v = args[k]
    return v === null || ['string', 'number', 'boolean'].includes(typeof v)
  })
}

function renderInputBlock(args) {
  const labelHtml = `<span class="tool-detail-bar-label">${escapeHtml(tt('tool_input') || 'Input')}</span>`
  const copyHtml = `<button class="tool-detail-bar-copy" type="button">${escapeHtml(tt('copy') || 'Copy')}</button>`
  if (shouldRenderInputAsFields(args)) {
    const keys = Object.keys(args).filter((k) => !k.startsWith('__'))
    const fieldsHtml = keys.map((k) => {
      const v = args[k] == null ? '' : String(args[k])
      const isLong = v.length > 60 || /\n/.test(v)
      return `<div class="tool-detail-field-key">${escapeHtml(k)}</div><div class="tool-detail-field-val${isLong ? ' long' : ''}">${escapeHtml(v)}</div>`
    }).join('')
    const metaText = `${keys.length} ${tt(keys.length === 1 ? 'tool_field' : 'tool_fields') || 'fields'}`
    const copyText = keys.map((k) => `${k}: ${args[k] == null ? '' : String(args[k])}`).join('\n')
    return `<div class="tool-detail-section"><div class="tool-detail-block">
      <div class="tool-detail-bar">${labelHtml}<span class="tool-detail-bar-meta">${escapeHtml(metaText)}</span>${copyHtml}</div>
      <div class="tool-detail-fields tool-detail-input" data-copy-text="${escapeHtml(copyText)}">${fieldsHtml}</div>
    </div></div>`
  }
  // Fallback: pretty-printed JSON. Used for AskUserQuestion-style nested args.
  const jsonText = formatToolInput(args)
  const metaText = jsonText ? `${jsonText.split('\n').length} ${tt('tool_lines') || 'lines'}` : ''
  return `<div class="tool-detail-section"><div class="tool-detail-block">
    <div class="tool-detail-bar">${labelHtml}<span class="tool-detail-bar-meta">${escapeHtml(metaText)}</span>${copyHtml}</div>
    <pre class="tool-detail-pre tool-detail-input">${escapeHtml(jsonText)}</pre>
  </div></div>`
}

// Build a tool card. Reused by live stream (tool_start) and history replay
// (appendAssistantFromBlocks). `state` controls the initial header status:
//   - 'running' (default): pulsing dot + "执行中"
//   - 'done':              ✓ check icon
//   - 'error':             "失败" pill (red)
function renderToolCard(toolName, toolCallId, args, state) {
  state = state || 'running'
  const cat = getToolCategory(toolName)
  const item = document.createElement('div')
  item.className = 'tool-item' + (cat ? ' ' + cat : '') + (state === 'running' ? '' : ' ' + state) + (foldsOpen ? ' open' : '')
  item.id = 'tool-' + toolCallId
  const valueText = toolValueText(toolName, args)
  item.innerHTML = `
    <div class="tool-item-header">
      ${toolIconForName(toolName)}
      <span class="tool-label">${escapeHtml(toolName)}</span>
      <span class="tool-value${cat === 'terminal' ? ' terminal-cmd' : ''}">${escapeHtml(valueText)}</span>
      ${renderToolStatus(state)}
      ${toolChevronSvg()}
    </div>
    <div class="tool-item-detail">${renderInputBlock(args)}</div>`
  item.querySelector('.tool-item-header').onclick = () => setAllFolds(!foldsOpen)
  item.querySelectorAll('.tool-detail-bar-copy').forEach(bindCopyButton)
  return item
}

function appendToolStart(toolName, toolCallId, args) {
  // Task panel surfaces TaskCreate/TaskUpdate canonically — skip the inline
  // tool card so we don't double-render. Subsequent tool_end/tool_input_delta/
  // progress events keyed off this toolCallId silently no-op (no DOM target).
  if (SUPPRESSED_TASK_TOOLS.has(toolName)) return
  let container = messagesEl.querySelector('.tool-container:last-child')
  if (!container || container.dataset.done === '1') {
    container = document.createElement('div')
    container.className = 'tool-container'
    messagesEl.appendChild(container)
  }
  const cat = getToolCategory(toolName)
  // Agent tool keeps its own nested container (sub-tool list inside).
  if (cat === 'agent') {
    createAgentContainer(toolName, toolCallId, args, container)
    return
  }
  container.appendChild(renderToolCard(toolName, toolCallId, args, 'running'))
  scrollToBottom()
}

// Partial stream 给 tool_use 创建卡片时 args 是空的（input_json_delta 碎片我们没消费），
// case 'assistant' 兜底会用完整 JSON 再发一次 tool_input_delta —— 这里把卡片的
// 显示参数 + Input 段整体重渲染（grid vs JSON 可能切换）。Output 段如果已经
// 存在则保留。
function updateToolArgs(toolCallId, jsonStr) {
  if (!toolCallId || !jsonStr) return
  const item = document.getElementById('tool-' + toolCallId)
  if (!item) return
  let args
  try { args = JSON.parse(jsonStr) } catch { return }
  const toolName = item.querySelector('.tool-label')?.textContent || ''
  const valueEl = item.querySelector('.tool-value')
  if (valueEl) valueEl.textContent = toolValueText(toolName, args)
  const detail = item.querySelector('.tool-item-detail')
  if (!detail) return
  const inputSection = detail.querySelector('.tool-detail-section:has(.tool-detail-input)') || detail.firstElementChild
  if (!inputSection) return
  const wrap = document.createElement('div')
  wrap.innerHTML = renderInputBlock(args)
  const newSection = wrap.firstElementChild
  if (!newSection) return
  inputSection.replaceWith(newSection)
  newSection.querySelectorAll('.tool-detail-bar-copy').forEach(bindCopyButton)
}

function createAgentContainer(toolName, toolCallId, args, parentContainer) {
  const wrap = document.createElement('div')
  wrap.className = 'agent-container'
  wrap.id = 'tool-' + toolCallId
  const label = args?.description || args?.prompt?.slice(0, 60) || toolName
  wrap.innerHTML = `<div class="agent-header"><span class="agent-toggle">&#9660;</span><span class="tool-label">${escapeHtml(toolName)}</span><span class="tool-value">${escapeHtml(label)}</span><span class="tool-dot"></span></div><div class="agent-children"></div>`
  wrap.querySelector('.agent-header').onclick = () => {
    const toggle = wrap.querySelector('.agent-toggle')
    const children = wrap.querySelector('.agent-children')
    toggle?.classList.toggle('collapsed')
    children?.classList.toggle('collapsed')
  }
  parentContainer.appendChild(wrap)
  scrollToBottom()
}

// 找到（或创建）工具卡片 detail 内的 Output 段，返回 <pre> 元素。Output 也
// 走 block + bar 结构：[输出] [N 行]   [复制] / pre
function ensureToolOutputPre(item) {
  const detail = item.querySelector('.tool-item-detail')
  if (!detail) return null
  let outPre = detail.querySelector('.tool-detail-output')
  if (outPre) return outPre
  const section = document.createElement('div')
  section.className = 'tool-detail-section'
  section.innerHTML = `<div class="tool-detail-block">
    <div class="tool-detail-bar">
      <span class="tool-detail-bar-label">${escapeHtml(tt('tool_output') || 'Output')}</span>
      <span class="tool-detail-bar-meta"></span>
      <button class="tool-detail-bar-copy" type="button">${escapeHtml(tt('copy') || 'Copy')}</button>
    </div>
    <pre class="tool-detail-pre tool-detail-output"></pre>
  </div>`
  detail.appendChild(section)
  section.querySelectorAll('.tool-detail-bar-copy').forEach(bindCopyButton)
  return section.querySelector('.tool-detail-output')
}

// 更新 Output 段的 meta info（行数）。
function updateOutputMeta(outPre) {
  if (!outPre) return
  const meta = outPre.parentElement?.querySelector('.tool-detail-bar-meta')
  if (!meta) return
  const text = outPre.textContent || ''
  const lines = text ? text.split('\n').length : 0
  meta.textContent = lines ? `${lines} ${tt('tool_lines') || 'lines'}` : ''
}

// Stream 的 progress 文本是工具运行时的中间产物（如长命令的 stdout 增量）。
// 没有最终输出之前先写到 detail 的 Output 区域，运行中卡片自动展开一次以便
// 用户看到进度；tool_end 时会用完整 content 替换。
function appendToolProgress(toolCallId, content) {
  const item = document.getElementById('tool-' + toolCallId)
  if (!item) return
  if (item.classList.contains('agent-container')) return // agent 不走这条路
  const outPre = ensureToolOutputPre(item)
  if (!outPre) return
  if (!item.classList.contains('open')) item.classList.add('open') // 首次有进度自动展开
  let combined = (outPre.textContent || '') + (content || '')
  if (combined.length > 4000) combined = '…' + combined.slice(-4000)
  outPre.textContent = sanitizeToolOutput(combined)
  updateOutputMeta(outPre)
  scrollToBottom()
}

function updateToolEnd(toolCallId, isError, content) {
  const el = document.getElementById('tool-' + toolCallId)
  if (!el) return
  // Agent 容器走旧逻辑：没有 Input/Output detail 区。
  if (el.classList.contains('agent-container')) {
    el.classList.add(isError ? 'error' : 'done')
    const dot = el.querySelector('.tool-dot')
    if (dot) dot.remove()
    if (!el.querySelector('.tool-secondary')) {
      const sec = document.createElement('span')
      sec.className = 'tool-secondary'
      sec.textContent = isError ? tt('tool_failed') : tt('tool_completed')
      const header = el.querySelector('.agent-header') || el
      header.appendChild(sec)
    }
    return
  }
  el.classList.add(isError ? 'error' : 'done')
  // Replace running pill with done ✓ / error pill via the shared renderer.
  const status = el.querySelector('.tool-status')
  if (status) {
    const wrap = document.createElement('div')
    wrap.innerHTML = renderToolStatus(isError ? 'error' : 'done')
    const next = wrap.firstElementChild
    if (next) status.replaceWith(next)
  }
  // 写最终输出。tool_end content 是权威值，覆盖 progress 期间的中间文本。
  if (typeof content !== 'string') return
  const outPre = ensureToolOutputPre(el)
  if (!outPre) return
  outPre.classList.toggle('tool-detail-error', !!isError)
  const cleaned = sanitizeToolOutput(content)
  outPre.textContent = cleaned || (tt('tool_no_output') || '(no output)')
  updateOutputMeta(outPre)
}

// ==================== File card ====================

const FILE_EXT_LABELS = { pdf:'PDF',json:'JSON',zip:'ZIP',gz:'GZ',txt:'TXT',csv:'CSV',md:'MD',html:'HTML',png:'PNG',jpg:'JPG',jpeg:'JPG',gif:'GIF',webp:'WEBP',svg:'SVG',mp3:'MP3',wav:'WAV',mp4:'MP4',py:'PY',ts:'TS',js:'JS',sh:'SH' }

function appendFileCard(name, url) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  const label = FILE_EXT_LABELS[ext] || ext.toUpperCase() || 'FILE'
  const group = document.createElement('div')
  group.className = 'msg-group assistant'
  group.innerHTML = `<div class="file-card"><div class="file-card-icon">${escapeHtml(label)}</div><div class="file-card-info"><div class="file-card-name">${escapeHtml(name)}</div><div class="file-card-hint">${tt('file_ready')}</div></div><a class="file-card-dl" href="${escapeHtml(url)}" download="${escapeHtml(name)}">${tt('download')}</a></div>`
  messagesEl.appendChild(group)
  scrollToBottom()
}

// ==================== Agent panel ====================

function renderAgentPanel() {
  if (!agentPanelEl) return
  let runningCount = 0
  agentPanel.agents.forEach(a => { if (a.status === 'running') runningCount++ })
  if (!agentPanel.team && agentPanel.agents.size === 0) { agentPanelEl.style.display = 'none'; return }
  agentPanelEl.style.display = ''
  const title = agentPanelEl.querySelector('#agent-panel-title')
  const count = agentPanelEl.querySelector('#agent-panel-count')
  const body = agentPanelEl.querySelector('#agent-panel-body')
  if (title) title.textContent = agentPanel.team ? agentPanel.team.name : tt('agents')
  if (count) {
    if (runningCount > 0) {
      count.textContent = runningCount + ' ' + tt('agent_running')
    } else {
      const size = agentPanel.agents.size
      count.textContent = size + (size === 1 ? tt('agent_count_one') : tt('agent_count_many'))
    }
  }
  if (!body) return
  body.innerHTML = ''
  agentPanel.agents.forEach((agent, id) => {
    const row = document.createElement('div')
    row.className = 'agent-row'
    const color = AGENT_COLOR_MAP[agent.color] || AGENT_COLOR_MAP.blue
    const statusText = agent.status === 'running'
      ? tt('agent_running_with_tools') + agent.toolUseCount + (agent.toolUseCount === 1 ? tt('agent_tool_call_one') : tt('agent_tool_call_many'))
      : agent.status
    row.innerHTML = `<span class="agent-dot${agent.status === 'running' ? ' running' : ''}" style="background:${color};border-color:${color}"></span><span class="agent-name">${escapeHtml(agent.name)}</span><span class="agent-status">${escapeHtml(statusText)}</span>`
    body.appendChild(row)
  })
}

// ==================== Task list (Monitor panel ▸ Tasks section) ====================
// Mirrors CC TaskListV2: surfaces TaskCreate/TaskUpdate state as a section
// inside the always-on right Monitor panel instead of as a raw-JSON tool card
// in the transcript. Engine pushes task_list events; renderer maintains a
// per-session cache and re-renders when the active session changes or its
// task list updates.

function getCurrentTasks() {
  return taskPanel.sessions.get(currentSessionId) || []
}

function renderTaskPanel() {
  const section = document.getElementById('monitor-section-tasks')
  const body = document.getElementById('monitor-tasks-body')
  const meta = document.getElementById('monitor-tasks-count')
  if (!section || !body) return
  const tasks = getCurrentTasks()
  // Empty list → hide the whole section so the Monitor panel doesn't show a
  // "Tasks" label dangling above empty space. Other sections (Outputs) stay
  // visible regardless.
  if (tasks.length === 0) {
    section.style.display = 'none'
    body.innerHTML = ''
    if (meta) meta.textContent = ''
    return
  }
  // Sort by numeric id ascending (CC byIdAsc).
  const sorted = [...tasks].sort((a, b) => {
    const aN = parseInt(a.id, 10), bN = parseInt(b.id, 10)
    if (!isNaN(aN) && !isNaN(bN)) return aN - bN
    return String(a.id).localeCompare(String(b.id))
  })
  section.style.display = ''

  const blockedSet = computeBlockedTaskIds(sorted)
  const counts = { pending: 0, in_progress: 0, completed: 0 }
  for (const t of sorted) counts[t.status]++
  if (meta) meta.textContent = formatTaskCounts(counts)

  body.innerHTML = ''
  for (const t of sorted) {
    const blocked = t.status === 'pending' && blockedSet.has(t.id)
    const row = document.createElement('div')
    row.className = 'task-row ' + t.status + (blocked ? ' blocked' : '')
    const subjectText = t.status === 'in_progress' && t.activeForm ? t.activeForm : t.subject
    const subject = (subjectText || '') + (blocked ? (tt('task_blocked_suffix') || ' (blocked)') : '')
    const ownerHtml = t.owner ? `<span class="task-owner">${escapeHtml(t.owner)}</span>` : ''
    const markHtml = t.status === 'completed'
      ? '<span class="task-mark"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 6.5 5 9 9.5 3.5"/></svg></span>'
      : '<span class="task-mark"></span>'
    row.innerHTML = `${markHtml}<span class="task-id">#${escapeHtml(t.id)}</span><span class="task-subject">${escapeHtml(subject)}</span>${ownerHtml}`
    body.appendChild(row)
  }
}

function computeBlockedTaskIds(tasks) {
  const unresolved = new Set(tasks.filter(t => t.status !== 'completed').map(t => t.id))
  const blocked = new Set()
  for (const t of tasks) {
    if (!t.blockedBy || t.blockedBy.length === 0) continue
    if (t.blockedBy.some(id => unresolved.has(id))) blocked.add(t.id)
  }
  return blocked
}

function formatTaskCounts(counts) {
  const parts = []
  if (counts.in_progress) parts.push(counts.in_progress + ' ' + (tt('tasks_count_in_progress') || 'in progress'))
  if (counts.pending) parts.push(counts.pending + ' ' + (tt('tasks_count_pending') || 'pending'))
  if (counts.completed) parts.push(counts.completed + ' ' + (tt('tasks_count_completed') || 'completed'))
  return parts.join(' · ')
}

async function refreshTasksForSession(sessionId) {
  if (!sessionId) return
  try {
    const res = await klausApi.tasks.list(sessionId)
    const tasks = (res && Array.isArray(res.tasks)) ? res.tasks : []
    taskPanel.sessions.set(sessionId, tasks)
  } catch (err) {
    console.warn('[tasks] refresh failed:', err)
    taskPanel.sessions.set(sessionId, [])
  }
  if (sessionId === currentSessionId) renderTaskPanel()
}

// ==================== Context window snapshot (Monitor panel ▸ Context) ====================
// Pulls CC engine's `analyzeContextUsage` over IPC and renders a token bar +
// category breakdown. The IPC walks the full message buffer + estimates tokens
// for every section (system/MCP/agents/skills/memory/messages), so it's not
// free — only fetch when there's a reason to think the count moved:
//   • on session switch (initial render)
//   • after a turn ends (`done` event)
//   • after a compact boundary (auto or manual)
//   • on explicit refresh button click
// All paths funnel into refreshContextStatsThrottled which debounces 250ms so
// rapid back-to-back triggers (compact_boundary + done arriving together)
// collapse into one IPC call.
const ctxPanel = {
  /** Per-session cache so a session re-open doesn't re-issue the IPC if the
   *  count hasn't moved. Cleared on `done` / `compact_boundary` for that
   *  session, then refilled by the throttled fetch. */
  sessions: new Map(),
  inflight: new Map(),
  pending: new Map(),
  loading: new Set(),
}

// Klaus desktop UI is a strict single-accent + grayscale system (see Tasks
// panel: every state uses --accent only, never a hue), so we collapse CC's
// per-category TUI hues into three semantic roles:
//   used     → real usage going through the API (System prompt, tools,
//              MCP, agents, memory, skills, messages). Accent fill.
//   reserved → autocompact / compact buffer; held back, not occupied.
//   inert    → free space (the unused window) and deferred tools (loaded
//              on demand, not currently consuming budget).
//
// IMPORTANT: judge role by name + isDeferred only. CC reuses color keys
// across roles (e.g. 'promptBorder' tags both System prompt [used] and
// Free space [inert]; 'inactive' tags System tools [used], Autocompact
// buffer [reserved], and deferred tools [inert]) — keying off color
// silently puts huge chunks of real usage into the "inert" bucket.
const CTX_RESERVED_NAMES = new Set(['Autocompact buffer', 'Compact buffer'])
const CTX_FREE_SPACE_NAME = 'Free space'

function ctxRoleFor(category) {
  if (category.name === CTX_FREE_SPACE_NAME) return 'inert'
  if (CTX_RESERVED_NAMES.has(category.name)) return 'reserved'
  if (category.isDeferred) return 'inert'
  return 'used'
}

function formatTokens(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'k'
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
}

// Lookup: Klaus-style i18n labels for the engine's English category names.
// Engine emits hard-coded English strings ("Skills", "Autocompact buffer",
// "Free space", "MCP tools", ...) regardless of locale, so we localize at
// the renderer boundary. Anything not in the table renders as-is.
function ctxLocalizeCategoryName(rawName) {
  const t = window.tt || ((k) => undefined)
  const map = {
    'System prompt': t('context_cat_system_prompt') || 'System prompt',
    'System tools': t('context_cat_system_tools') || 'System tools',
    'MCP tools': t('context_cat_mcp_tools') || 'MCP tools',
    'MCP tools (deferred)': t('context_cat_mcp_tools_deferred') || 'MCP tools (deferred)',
    'System tools (deferred)': t('context_cat_system_tools_deferred') || 'System tools (deferred)',
    'Custom agents': t('context_cat_agents') || 'Custom agents',
    'Memory files': t('context_cat_memory') || 'Memory files',
    'Skills': t('context_cat_skills') || 'Skills',
    'Messages': t('context_cat_messages') || 'Messages',
    'Autocompact buffer': t('context_cat_autocompact_buffer') || 'Autocompact buffer',
    'Compact buffer': t('context_cat_compact_buffer') || 'Compact buffer',
    'Free space': t('context_cat_free') || 'Free space',
  }
  return map[rawName] || rawName
}

function renderContextPanel() {
  const body = document.getElementById('monitor-context-body')
  const meta = document.getElementById('monitor-context-meta')
  if (!body) return
  const stats = ctxPanel.sessions.get(currentSessionId)
  if (ctxPanel.loading.has(currentSessionId) && !stats) {
    body.innerHTML = `<div class="ctx-empty">${escapeHtml(tt('context_loading') || 'Loading…')}</div>`
    if (meta) meta.textContent = ''
    return
  }
  if (!stats) {
    body.innerHTML = `<div class="ctx-empty">${escapeHtml(tt('context_empty') || 'No data')}</div>`
    if (meta) meta.textContent = ''
    return
  }

  // ── Threshold state (drives accent → warning → danger color shift) ──────
  const barTotal = stats.rawMaxTokens || 1
  const usedPct = Math.min(100, Math.max(0, (stats.tokens / barTotal) * 100))
  let stateClass = 'ok'
  if (stats.warning?.isAtBlockingLimit) stateClass = 'blocking'
  else if (stats.warning?.isAboveErrorThreshold) stateClass = 'error'
  else if (stats.warning?.isAboveWarningThreshold) stateClass = 'warning'

  // Bar widths must match the hero number's source of truth. The hero shows
  // stats.tokens, which is whichever of API-reported input_tokens or the
  // category-sum estimate analyzeContextUsage chose (it prefers the API
  // total when the last assistant message has usage — see analyzeContext.ts
  // L1175). Recomputing from categories here would diverge: the API total
  // includes the full prompt (cache + non-cache, multi-turn), while the
  // category breakdown is an estimate-by-component. Diverging means a 44%
  // hero with a ~15% bar fill, which reads as "the bar is broken / grey".
  const usedTokens = stats.tokens
  let reservedTokens = 0
  for (const c of stats.categories) {
    const role = ctxRoleFor(c)
    if (role === 'reserved') reservedTokens += c.tokens || 0
  }

  // ── Hero numbers ────────────────────────────────────────────────────────
  const usedDisplay = formatTokens(stats.tokens)
  const totalDisplay = formatTokens(stats.rawMaxTokens)
  const pctDisplay = usedPct < 0.1 ? '<0.1%' : `${usedPct.toFixed(usedPct < 10 ? 1 : 0)}%`

  // ── Stacked bar widths ──────────────────────────────────────────────────
  // Tiny usage (<0.4%) gets bumped to a 0.4% minimum width so users see a
  // sliver instead of a flatlined bar.
  const usedW = (usedTokens / barTotal) * 100
  const reservedW = (reservedTokens / barTotal) * 100
  const usedWClamped = usedTokens > 0 ? Math.max(usedW, 0.4) : 0

  // ── Headline (only when state ≠ ok) ─────────────────────────────────────
  const percentLeft = stats.warning?.percentLeft ?? 0
  let headline = ''
  if (stateClass !== 'ok') {
    headline = stats.isAutoCompactEnabled
      ? (tt('context_until_autocompact')?.replace('{percent}', percentLeft) || `${percentLeft}% until auto-compact`)
      : (tt('context_remaining')?.replace('{percent}', percentLeft) || `Context low (${percentLeft}% remaining)`)
  }

  // ── Compose ─────────────────────────────────────────────────────────────
  // Just the hero card. The whole point of the panel is the at-a-glance
  // "how full is the context window" — per-category lists were noise.
  body.innerHTML = `
    <div class="ctx-card ${stateClass}">
      <div class="ctx-hero">
        <div class="ctx-hero-numbers">
          <span class="ctx-hero-used">${escapeHtml(usedDisplay)}</span>
          <span class="ctx-hero-of">/ ${escapeHtml(totalDisplay)} ${escapeHtml(tt('context_tokens_unit') || 'tokens')}</span>
        </div>
        <span class="ctx-hero-pct">${escapeHtml(pctDisplay)}</span>
      </div>
      <div class="ctx-stack">
        <span class="ctx-stack-used" style="width:${usedWClamped}%"></span>
        ${reservedW > 0 ? `<span class="ctx-stack-reserved" style="width:${reservedW}%"></span>` : ''}
      </div>
      ${headline ? `<div class="ctx-card-hint">${escapeHtml(headline)}</div>` : ''}
    </div>
  `

  if (meta) meta.textContent = `${formatTokens(stats.tokens)} · ${pctDisplay}`
}

async function fetchContextStats(sessionId) {
  if (!sessionId) return
  if (ctxPanel.inflight.has(sessionId)) return ctxPanel.inflight.get(sessionId)
  ctxPanel.loading.add(sessionId)
  if (sessionId === currentSessionId) renderContextPanel()
  const promise = klausApi.engine.contextStats(sessionId)
    .then(stats => {
      if (stats) ctxPanel.sessions.set(sessionId, stats)
      return stats
    })
    .catch(err => { console.warn('[ctx] contextStats failed:', err); return null })
    .finally(() => {
      ctxPanel.inflight.delete(sessionId)
      ctxPanel.loading.delete(sessionId)
      if (sessionId === currentSessionId) renderContextPanel()
    })
  ctxPanel.inflight.set(sessionId, promise)
  return promise
}

function refreshContextStatsThrottled(sessionId, delay = 250) {
  if (!sessionId) return
  const existing = ctxPanel.pending.get(sessionId)
  if (existing) clearTimeout(existing)
  const handle = setTimeout(() => {
    ctxPanel.pending.delete(sessionId)
    fetchContextStats(sessionId)
  }, delay)
  ctxPanel.pending.set(sessionId, handle)
}

// ==================== Manual /compact (input-toolbar button) ====================
// Match CC's /compact UX: no confirm dialog, no custom toast — the moment
// the user clicks, the transcript shows a three-dot streaming indicator
// (same component the main thinking flow uses, so the visual grammar is
// consistent), and the send button flips into busy/stop mode. When the
// summary stream finishes, the indicator goes away and the transcript is
// reloaded to display the post-compact view (boundary → summary →
// attachments). CC's REPL achieves the same end state by replacing its
// messages state when /compact returns.
const btnCompact = document.getElementById('compact-btn')

// Lightweight progress indicator reusing .thinking-indicator styles. The
// stock thinkingUI singleton is reserved for actual model-thinking output;
// keeping a separate compact indicator means a mid-flight chat turn won't
// race with a compact triggered from the toolbar.
const compactProgress = {
  el: null,
  show() {
    this.hide()
    finalizeStream()
    const el = document.createElement('div')
    el.className = 'thinking-indicator'
    el.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div><span class="thinking-label">${escapeHtml(tt('compacting_in_progress') || 'Compacting conversation…')}</span>`
    messagesEl.appendChild(el)
    this.el = el
    scrollToBottom()
  },
  hide() {
    if (this.el) { this.el.remove(); this.el = null }
  },
}

// After a manual compact, the engine's session.messages has been replaced
// with [boundary, summary, attachments]. The renderer's DOM is still showing
// the *pre-compact* messages, which is what made the original implementation
// look like "nothing happened". CC's REPL handles this by replacing its
// messages state and letting the framework re-render the transcript. We
// don't have responsive bindings here, so we explicitly clear the transcript
// and reload from disk — getHistory now projects past the most recent
// compact_boundary, so it returns just the summary + attachments.
async function reloadTranscriptForCurrentSession() {
  if (!currentSessionId) return
  const id = currentSessionId
  // Drop the off-screen DOM cache for this session — those nodes were rendered
  // from the pre-compact message list and would resurrect on next switchSession.
  sessionDom.delete(id)
  messagesEl.innerHTML = ''
  resetStreamState()
  let history
  try {
    history = await klausApi.session.history(id)
  } catch (err) {
    console.warn('[compact] history reload failed:', err)
    return
  }
  if (currentSessionId !== id) return  // user switched away mid-await
  for (const msg of history) renderHistoryMessage(msg)
  pruneIntermediateAssistantActions()
  const hasContent = messagesEl.childNodes.length > 0
  messagesEl.style.display = hasContent ? 'block' : 'none'
  welcomeEl.style.display = hasContent ? 'none' : 'flex'
  scrollToBottom()
}

async function triggerCompact() {
  if (!currentSessionId) return
  if (busy) {
    // A turn is already streaming — bail silently rather than queueing.
    // CC's /compact path also short-circuits when the loop is busy.
    return
  }

  // Flip into busy state — same flag as a normal turn, so the send button
  // changes to its stop affordance and the input keeps disabled-on-empty.
  busy = true
  btnSend.classList.add('busy')
  btnSend.disabled = false  // stop button is always clickable
  if (btnCompact) btnCompact.disabled = true
  compactProgress.show()

  try {
    const result = await klausApi.engine.compact(currentSessionId)
    compactProgress.hide()
    if (result?.ok) {
      // compact_boundary event already triggered a reload; do it again
      // unconditionally to cover the edge case where the event was missed
      // (e.g. user navigated away mid-compact and the off-screen filter
      // dropped it). Idempotent — the second reload just re-renders the
      // same projected history.
      await reloadTranscriptForCurrentSession()
    } else {
      appendError((tt('compact_failed_prefix') || 'Compaction failed: ') + (result?.error || 'unknown error'))
    }
  } catch (err) {
    compactProgress.hide()
    appendError((tt('compact_failed_prefix') || 'Compaction failed: ') + (err?.message || String(err)))
  } finally {
    busy = false
    btnSend.classList.remove('busy')
    btnSend.disabled = !inputEl.value.trim()
    if (btnCompact) btnCompact.disabled = false
    inputEl.focus()
    refreshContextStatsThrottled(currentSessionId, 50)
  }
}

if (btnCompact) {
  btnCompact.addEventListener('click', () => { triggerCompact() })
}

// Manual refresh button on the Context section header.
document.getElementById('monitor-context-refresh')?.addEventListener('click', () => {
  if (currentSessionId) fetchContextStats(currentSessionId)
})

// ==================== Permission ====================

function showPermissionRequest(req) {
  // Route by sessionId. Permission asks from cron-run sessions running in the
  // background must NOT mount into the currently-viewed session — that would
  // attach an Approve/Deny button to the wrong conversation.
  if (req.sessionId && req.sessionId !== currentSessionId) {
    const list = pendingPermissionsBySession.get(req.sessionId) || []
    list.push(req)
    pendingPermissionsBySession.set(req.sessionId, list)
    // Light up the sidebar so the user knows a background task is waiting.
    // The unread mechanism is inverted (cronReadRuns is the *read* set; a run
    // shows a dot iff its sessionId is NOT in the set), so flipping back to
    // "unread" means deleting from the set + re-persisting.
    if (isCronRunSession(req.sessionId) && cronReadRuns.has(req.sessionId)) {
      cronReadRuns.delete(req.sessionId)
      try { localStorage.setItem('klaus_cron_read_runs', JSON.stringify([...cronReadRuns])) } catch {}
    }
    renderSessionList()
    return
  }
  if (req.toolName === 'AskUserQuestion') {
    showAskUserQuestionRequest(req)
    return
  }
  const card = document.createElement('div')
  card.className = 'permission-card'
  card.id = 'perm-' + req.requestId
  const inputPreview = req.toolInput ? JSON.stringify(req.toolInput, null, 2) : ''
  let suggestionsHtml = ''
  if (req.suggestions?.length) {
    suggestionsHtml = '<div class="permission-suggestions">' +
      req.suggestions.map((s, i) => `<label class="permission-suggestion"><input type="checkbox" data-sug-idx="${i}"> ${escapeHtml(s.label || tt('permission_always_allow'))}</label>`).join('') + '</div>'
  }
  card.innerHTML = `
    <div class="permission-header"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg><span class="permission-title">${escapeHtml(req.toolName)}</span></div>
    <div class="permission-message">${escapeHtml(req.message || tt('permission_default_msg'))}</div>
    ${inputPreview ? `<details class="permission-input-details"><summary>${escapeHtml(tt('permission_show_input'))}</summary><pre class="permission-input-preview">${escapeHtml(inputPreview).slice(0, 500)}</pre></details>` : ''}
    ${suggestionsHtml}
    <div class="permission-actions"><button class="permission-btn permission-btn-allow" onclick="handlePermission('${req.requestId}','allow')">${tt('allow')}</button><button class="permission-btn permission-btn-deny" onclick="handlePermission('${req.requestId}','deny')">${tt('deny')}</button></div>
    <div class="permission-timer"><span class="permission-timer-text">120s</span></div>`
  messagesEl.appendChild(card)
  scrollToBottom()
  // Countdown timer
  let remaining = 120
  const timerEl = card.querySelector('.permission-timer-text')
  const timer = setInterval(() => {
    remaining--
    if (timerEl) timerEl.textContent = remaining + 's'
    if (remaining <= 0) { clearInterval(timer); handlePermission(req.requestId, 'deny') }
  }, 1000)
  card.dataset.timer = timer
}

window.handlePermission = function(requestId, decision) {
  const card = document.getElementById('perm-' + requestId)
  if (card?.dataset.timer) clearInterval(parseInt(card.dataset.timer))
  let indices = []
  if (card && decision === 'allow') {
    card.querySelectorAll('input[data-sug-idx]:checked').forEach(cb => indices.push(parseInt(cb.dataset.sugIdx)))
  }
  klausApi.permission.respond(requestId, decision, indices.length > 0 ? indices : undefined)
  if (card) {
    card.querySelector('.permission-actions').innerHTML = `<div class="permission-result ${decision === 'allow' ? 'permission-allowed' : 'permission-denied'}">${decision === 'allow' ? (tt('allowed')) : (tt('denied'))}${indices.length ? tt('permission_rules_saved') : ''}</div>`
    card.querySelector('.permission-timer').remove()
    card.classList.add('permission-resolved')
  }
}

// ==================== AskUserQuestion ====================
//
// Multi-question flow modeled after CC's
// AskUserQuestionPermissionRequest: one question is shown at a time, a tab
// bar at the top tracks progress (checkbox per question + a final "submit"
// tab). Single-select click auto-advances to the next unanswered step;
// multi-select waits for explicit next. All answers submit together at the
// review step.
//
// Answer shape sent back via updatedInput.answers:
//   single-select → "Label" (or free text if Other)
//   multi-select  → "Label A, Label B"

function showAskUserQuestionRequest(req) {
  const input = req.toolInput || {}
  const questions = Array.isArray(input.questions) ? input.questions : []
  if (questions.length === 0) {
    klausApi.permission.respond(req.requestId, 'deny')
    return
  }
  const card = document.createElement('div')
  card.className = 'question-card'
  card.id = 'q-' + req.requestId

  const kindLabel = questions.some(q => q.multiSelect) ? tt('question_multi') : tt('question_single')
  const totalChip = questions.length > 1 ? ` · ${questions.length}` : ''
  const header = `
    <div class="question-chip">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6l-3 3V4a1 1 0 0 1 1-1z"/></svg>
      <span>${escapeHtml(tt('question_chip'))}</span>
      <span class="question-chip-sep">·</span>
      <span class="question-chip-kind">${escapeHtml(kindLabel)}${totalChip}</span>
    </div>`

  const nav = questions.length > 1 ? renderQuestionNav(questions) : ''
  const blocks = questions.map((q, qi) => renderQuestionBlock(q, qi)).join('')

  const footer = `
    <div class="question-footer">
      <div class="question-footer-left"></div>
      <div class="question-footer-right">
        <button class="question-btn question-btn-skip" data-q-action="skip">${escapeHtml(tt('question_skip'))}</button>
        <button class="question-btn question-btn-submit" data-q-action="primary" disabled>
          <span class="question-btn-label">${escapeHtml(tt('question_submit'))}</span>
          <span class="kbd">⏎</span>
        </button>
      </div>
    </div>`

  card.innerHTML = header + nav + blocks + footer
  // Place the card as a SIBLING right after the tool-container of this
  // tool_use — not inside it. The container has a left-border indent
  // (matching the thinking-content visual) which, if we nested, would make
  // the card look like it belongs inside the thinking box.
  const toolItem = req.toolCallId ? document.getElementById('tool-' + req.toolCallId) : null
  const toolContainer = toolItem?.closest('.tool-container')
  if (toolContainer?.parentElement) {
    toolContainer.parentElement.insertBefore(card, toolContainer.nextSibling)
  } else {
    messagesEl.appendChild(card)
  }
  scrollToBottom()

  wireQuestionCard(card, req, questions)
}

function renderQuestionNav(questions) {
  const tabs = questions.map((q, qi) => {
    const label = (q.header || `Q${qi + 1}`).toString()
    return `
      <button class="question-tab" data-q-tab="${qi}" type="button">
        <span class="question-tab-check" aria-hidden="true"></span>
        <span class="question-tab-label">${escapeHtml(label)}</span>
      </button>`
  }).join('')
  return `<div class="question-nav">${tabs}</div>`
}

function renderQuestionBlock(q, qi) {
  const multi = !!q.multiSelect
  const options = Array.isArray(q.options) ? q.options : []
  const optsHtml = options.map((opt, oi) => {
    const previewHtml = opt.preview
      ? `<div class="question-option-preview">${escapeHtml(String(opt.preview))}</div>`
      : ''
    return `
      <div class="question-option" data-q-idx="${qi}" data-opt-idx="${oi}" data-opt-label="${escapeHtml(opt.label || '')}">
        <div class="question-option-badge">${oi + 1}</div>
        <div class="question-option-body">
          <div class="question-option-label">${escapeHtml(opt.label || '')}</div>
          ${opt.description ? `<div class="question-option-desc">${escapeHtml(opt.description)}</div>` : ''}
          ${previewHtml}
        </div>
      </div>`
  }).join('')

  const otherIdx = options.length
  const otherBlock = `
    <div class="question-option question-option-other" data-q-idx="${qi}" data-opt-idx="${otherIdx}" data-opt-label="__other__">
      <div class="question-option-badge">${otherIdx + 1}</div>
      <div class="question-option-body">
        <div class="question-option-label">${escapeHtml(tt('question_other'))}</div>
      </div>
    </div>
    <div class="question-other-input" data-q-idx="${qi}" style="display:none">
      <textarea data-q-other-idx="${qi}" placeholder="${escapeHtml(tt('question_other_ph'))}"></textarea>
    </div>`

  const title = questions_withIndex(q, qi)
  return `
    <div class="question-block" data-q-idx="${qi}" data-multi="${multi ? '1' : '0'}" data-q-text="${escapeHtml(q.question || '')}">
      ${title}
      <div class="question-options">${optsHtml}${otherBlock}</div>
    </div>`
}

function questions_withIndex(q, qi) {
  return `<div class="question-title"><span class="question-title-index">${qi + 1}.</span><span>${escapeHtml(q.question || '')}</span></div>`
}

// Rebuild a resolved AskUserQuestion card from a persisted tool_use block on
// history load. getHistory parses the matching tool_result text and attaches
// it as input.__resolution; we reconstruct the state/questions that
// finalizeQuestionCard consumes so the DOM matches what the user saw live.
function rebuildAskUserQuestionCard(tb) {
  const input = tb?.input || {}
  const questions = Array.isArray(input.questions) ? input.questions : []
  if (questions.length === 0) return
  // No __resolution means the tool_use exists in transcript but no tool_result
  // has been written yet — the engine is still awaiting the user's answer.
  // Common for cron-run sessions: the assistant called AskUserQuestion and
  // is parked in onAsk while the user looks at a different chat. Skip the
  // historical (resolved) render path so switchSession's pendingPermissions
  // drain can mount the live, interactive card instead. Without this guard
  // we'd paint a "已跳过" terminal-state card on top of (or instead of) the
  // real one, leaving the user with no way to answer.
  if (!input.__resolution) return
  const resolution = input.__resolution
  const answersMap = resolution.status === 'answered' ? (resolution.answers || {}) : {}

  const card = document.createElement('div')
  card.className = 'question-card'

  const kindLabel = questions.some(q => q.multiSelect) ? tt('question_multi') : tt('question_single')
  const totalChip = questions.length > 1 ? ` · ${questions.length}` : ''
  const header = `
    <div class="question-chip">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6l-3 3V4a1 1 0 0 1 1-1z"/></svg>
      <span>${escapeHtml(tt('question_chip'))}</span>
      <span class="question-chip-sep">·</span>
      <span class="question-chip-kind">${escapeHtml(kindLabel)}${totalChip}</span>
    </div>`
  const blocks = questions.map((q, qi) => renderQuestionBlock(q, qi)).join('')
  card.innerHTML = header + blocks

  // Reconstruct per-question state from the parsed answer strings. Multi-
  // select answers are comma-joined (see engine's mapToolResultToToolResult
  // BlockParam), so split by ", " and match each part to an option label;
  // any unmatched fragment is treated as Other-freeform text.
  const state = questions.map(q => {
    const selected = new Set()
    const s = { selected, otherText: '', multi: !!q.multiSelect }
    const answerStr = answersMap[q.question]
    if (!answerStr) return s
    const parts = q.multiSelect ? answerStr.split(/,\s+/) : [answerStr]
    const otherIdx = q.options.length
    for (const part of parts) {
      const oi = q.options.findIndex(o => (o.label || '') === part)
      if (oi >= 0) selected.add(oi)
      else { selected.add(otherIdx); s.otherText = part }
    }
    return s
  })

  messagesEl.appendChild(card)
  const mode = resolution.status === 'answered' ? 'submitted' : 'skipped'
  finalizeQuestionCard(card, mode, answersMap, questions, state)
}

function wireQuestionCard(card, req, questions) {
  // Per-question state. Single-select questions pre-select option 0 so that
  // the model's "(Recommended)" first option can be accepted with a single
  // Enter press (matches CC's use-select-state.ts:138-144).
  const state = questions.map(q => {
    const selected = new Set()
    if (!q.multiSelect && Array.isArray(q.options) && q.options.length > 0) {
      selected.add(0)
    }
    return { selected, otherText: '', multi: !!q.multiSelect }
  })
  // currentIndex ranges 0..questions.length-1. On the final question the
  // primary button becomes "汇总提交" and submits directly — no separate
  // review screen (users can still jump back via the tab bar).
  const isMulti = questions.length > 1
  const lastIndex = questions.length - 1
  let currentIndex = 0

  const primaryBtn = card.querySelector('[data-q-action="primary"]')
  const primaryLabelEl = primaryBtn.querySelector('.question-btn-label')
  const skipBtn = card.querySelector('[data-q-action="skip"]')

  // Paint initial selection highlight for pre-selected options.
  state.forEach((s, qi) => {
    s.selected.forEach(oi => {
      card.querySelector(`.question-option[data-q-idx="${qi}"][data-opt-idx="${oi}"]`)
        ?.classList.add('is-selected')
    })
  })

  const questionComplete = qi => {
    const s = state[qi]
    if (s.selected.size === 0) return false
    const otherIdx = questions[qi].options.length
    if (s.selected.has(otherIdx) && !s.otherText.trim()) return false
    return true
  }

  const render = () => {
    // Show only the current question block.
    card.querySelectorAll('.question-block').forEach(block => {
      const qi = Number(block.dataset.qIdx)
      block.style.display = qi === currentIndex ? '' : 'none'
    })
    // Tab state: answered checkbox + current highlight.
    card.querySelectorAll('.question-tab').forEach(tab => {
      const idx = Number(tab.dataset.qTab)
      tab.classList.toggle('is-current', idx === currentIndex)
      tab.classList.toggle('is-answered', questionComplete(idx))
    })
    // Primary button: on the last question it becomes the submit action
    // (label = 汇总提交 for multi-question, 继续 for single-question), and
    // requires every question to be complete. Otherwise it's "下一题" and
    // only needs the current question complete.
    if (currentIndex === lastIndex) {
      primaryLabelEl.textContent = tt(isMulti ? 'question_review' : 'question_submit')
      primaryBtn.disabled = !questions.every((_, qi) => questionComplete(qi))
    } else {
      primaryLabelEl.textContent = tt('question_next')
      primaryBtn.disabled = !questionComplete(currentIndex)
    }
    scrollToBottom()
  }

  const repaintCurrentOptions = qi => {
    const s = state[qi]
    card.querySelectorAll(`.question-option[data-q-idx="${qi}"]`).forEach(node => {
      const ni = Number(node.dataset.optIdx)
      node.classList.toggle('is-selected', s.selected.has(ni))
    })
    const otherIdx = questions[qi].options.length
    const otherBox = card.querySelector(`.question-other-input[data-q-idx="${qi}"]`)
    if (otherBox) {
      const show = s.selected.has(otherIdx)
      otherBox.style.display = show ? '' : 'none'
      if (show) {
        const ta = otherBox.querySelector('textarea')
        if (ta && document.activeElement !== ta) setTimeout(() => ta.focus(), 0)
      }
    }
  }

  card.querySelectorAll('.question-option').forEach(el => {
    el.addEventListener('click', () => {
      const qi = Number(el.dataset.qIdx)
      const oi = Number(el.dataset.optIdx)
      const s = state[qi]
      if (s.multi) {
        if (s.selected.has(oi)) s.selected.delete(oi)
        else s.selected.add(oi)
      } else {
        s.selected.clear()
        s.selected.add(oi)
      }
      repaintCurrentOptions(qi)
      // Auto-advance: single-select click on a non-"Other" option moves to
      // the next question — but only if we're not already on the last one
      // (on the last question the primary button is "汇总提交" and clicking
      // an option just updates the selection; the user then hits submit).
      const otherIdx = questions[qi].options.length
      const isOther = oi === otherIdx
      if (!s.multi && !isOther && currentIndex < lastIndex) {
        currentIndex += 1
      }
      render()
    })
  })

  card.querySelectorAll('textarea[data-q-other-idx]').forEach(ta => {
    ta.addEventListener('input', () => {
      const qi = Number(ta.dataset.qOtherIdx)
      state[qi].otherText = ta.value
      render()
    })
  })

  card.querySelectorAll('.question-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentIndex = Number(tab.dataset.qTab)
      render()
    })
  })

  const advanceOrSubmit = () => {
    if (primaryBtn.disabled) return
    if (currentIndex === lastIndex) {
      submit()
      return
    }
    currentIndex += 1
    render()
  }

  const submit = () => {
    const answers = {}
    const annotations = {}
    questions.forEach((q, qi) => {
      const s = state[qi]
      if (!questionComplete(qi)) return
      const opts = q.options
      const otherIdx = opts.length
      const parts = []
      let selectedOption = null
      Array.from(s.selected).sort((a,b) => a-b).forEach(oi => {
        if (oi === otherIdx) parts.push(s.otherText.trim())
        else {
          parts.push(opts[oi].label)
          if (!selectedOption) selectedOption = opts[oi]
        }
      })
      answers[q.question] = parts.join(', ')
      if (!s.multi && selectedOption && selectedOption.preview) {
        annotations[q.question] = { preview: String(selectedOption.preview) }
      }
    })
    const updatedInput = {
      ...req.toolInput,
      answers,
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    }
    klausApi.permission.respond(req.requestId, 'allow', undefined, updatedInput)
    finalizeQuestionCard(card, 'submitted', answers, questions, state)
  }

  const skip = () => {
    // Esc / 跳过 cancels the whole form (matches CC's onCancel at
    // QuestionView.tsx:146-148). Partial answers are discarded.
    klausApi.permission.respond(req.requestId, 'deny')
    finalizeQuestionCard(card, 'skipped', null, questions, state)
  }

  primaryBtn.addEventListener('click', advanceOrSubmit)
  skipBtn.addEventListener('click', skip)

  // Enter = primary action (next / submit). Esc = skip. Only active when
  // this card is the latest unresolved one, and never when the user is
  // typing in a textarea (letting them add newlines to the Other input).
  const onKey = (e) => {
    if (card.classList.contains('question-resolved')) return
    const all = document.querySelectorAll('.question-card:not(.question-resolved)')
    if (all.length && all[all.length - 1] !== card) return
    // 输入法合成中，回车是在选候选词，不是在提交
    if (e.isComposing || e.keyCode === 229) return
    const active = document.activeElement
    if (e.key === 'Enter' && !e.shiftKey) {
      if (active && active.tagName === 'TEXTAREA') {
        if (!card.contains(active)) return
        return
      }
      if (!primaryBtn.disabled) { e.preventDefault(); advanceOrSubmit() }
    } else if (e.key === 'Escape') {
      // Don't swallow Escape if user is in an unrelated textarea.
      if (active && active.tagName === 'TEXTAREA' && !card.contains(active)) return
      e.preventDefault()
      skip()
    }
  }
  document.addEventListener('keydown', onKey, true)
  card._unbindKey = () => document.removeEventListener('keydown', onKey, true)

  render()
}

function finalizeQuestionCard(card, mode, _answers, questions, state) {
  // CC behaviour (AskUserQuestionTool.tsx:83-107): once the user submits, the
  // interactive card collapses into a read-only "Q → A" record so the chat
  // transcript preserves context even if the user scrolls back later. We
  // restrict the DOM to the original question blocks with only the selected
  // options kept — no new CSS is introduced.
  card.classList.add('question-resolved', `question-resolved-${mode}`)
  if (card._unbindKey) card._unbindKey()

  // Tear down interaction affordances.
  card.querySelector('.question-footer')?.remove()
  card.querySelector('.question-nav')?.remove()
  card.querySelectorAll('.question-other-input').forEach(el => el.remove())
  // Question blocks were show/hidden via style.display; unhide them all so the
  // full Q→A record is visible in history.
  card.querySelectorAll('.question-block').forEach(block => {
    block.style.display = ''
  })

  if (mode === 'skipped') {
    card.querySelectorAll('.question-block').forEach(block => {
      block.querySelector('.question-options')?.remove()
      const skipped = document.createElement('div')
      skipped.className = 'question-result question-result-skipped'
      skipped.textContent = tt('question_skipped')
      block.appendChild(skipped)
    })
    return
  }

  card.querySelectorAll('.question-block').forEach(block => {
    const qi = Number(block.dataset.qIdx)
    const s = state?.[qi]
    const q = questions?.[qi]
    if (!s || !q) return
    const otherIdx = q.options.length
    block.querySelectorAll('.question-option').forEach(optEl => {
      const oi = Number(optEl.dataset.optIdx)
      if (!s.selected.has(oi)) {
        optEl.remove()
        return
      }
      if (oi === otherIdx) {
        const labelEl = optEl.querySelector('.question-option-label')
        if (labelEl) labelEl.textContent = s.otherText.trim() || labelEl.textContent
        optEl.classList.remove('question-option-other')
      }
    })
  })
}

// ==================== Events ====================

// Plays a short beep when the agent finishes or needs input while the
// user is away. Uses Web Audio so we don't ship an asset file.
function playNotifySound(kind) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = kind === 'input' ? 660 : 880
    const now = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
    osc.start(now)
    osc.stop(now + 0.34)
    osc.onended = () => { try { ctx.close() } catch {} }
  } catch {}
}
klausApi.on.notifySound?.((kind) => playNotifySound(kind))

// Every chat — UI-originated and channel-originated alike — forwards its
// engine events through this single IPC. Filter by currentSessionId so only
// the active tab animates. When a `done` arrives for some other session
// (channel just finished replying in the background), refresh the sidebar
// so its title/mtime updates are visible.
klausApi.on.chatEvent((event) => {
  // DEBUG: 临时 log — 定位 "一次回复渲染成两段" 问题。确认后删除。
  console.log('[chat:event]', event.type, event)
  // Task panel updates must be cached even for off-screen sessions so that
  // when the user switches in we can render the latest list from cache before
  // the IPC refetch resolves.
  if (event.type === 'task_list' && event.sessionId) {
    const tasks = Array.isArray(event.tasks) ? event.tasks : []
    taskPanel.sessions.set(event.sessionId, tasks)
    if (event.sessionId === currentSessionId) renderTaskPanel()
    return
  }

  if (event.sessionId && event.sessionId !== currentSessionId) {
    if (event.type === 'done') {
      updateSessionInList()
      // Cron scheduler just finished a run in the background. We refresh
      // runs for EVERY known task (not just expanded ones) so the task-
      // level unread dot can appear even while that task's run list is
      // collapsed — otherwise the user doesn't see anything changed in the
      // sidebar after a scheduled task fires.
      if (isCronRunSession(event.sessionId)) refreshCronRunsForAllTasks()
    } else if (event.type === 'permission_cancelled') {
      // Engine withdrew a pending ask while we weren't looking at that
      // session — drop it from the queued list so we don't pop a stale
      // approve/deny card the next time the user opens that session.
      const list = pendingPermissionsBySession.get(event.sessionId)
      if (list) {
        const filtered = list.filter(r => r.requestId !== event.requestId)
        if (filtered.length === 0) pendingPermissionsBySession.delete(event.sessionId)
        else pendingPermissionsBySession.set(event.sessionId, filtered)
      }
    }
    return
  }

  switch (event.type) {
    case 'user_message': {
      // Channel-originated user turn (wechat/feishu/…). UI-originated chats
      // skip this (engine only emits it when caller passes emitUserMessage=true).
      const content = event.message?.message?.content
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.filter(b => b && b.type === 'text').map(b => b.text || '').join('')
          : ''
      if (text) {
        welcomeEl.style.display = 'none'
        messagesEl.style.display = 'block'
        appendUserMsg(text)
      }
      break
    }
    case 'text_delta': appendStreamText(event.text); break
    case 'thinking_delta': thinkingUI.append(event.thinking); break
    case 'tool_start': appendToolStart(event.toolName, event.toolCallId, event.args); break
    case 'tool_end':
      updateToolEnd(event.toolCallId, event.isError, event.content)
      // Tool results push messages onto session.messages — refresh the
      // monitor so the bar climbs as the turn does work, not just at the end.
      // Heavy throttle (1.5s) so back-to-back parallel tool returns don't
      // hammer analyzeContextUsage on the main side.
      refreshContextStatsThrottled(event.sessionId, 1500)
      break
    case 'artifact': upsertArtifactItem(event); break
    case 'tool_input_delta': updateToolArgs(event.toolCallId, event.delta); break
    case 'progress': appendToolProgress(event.toolCallId, event.content); break
    case 'stream_mode':
      if (event.mode === 'requesting') thinkingUI.show() // 幂等，已有就是 no-op
      else if (event.mode === 'responding') thinkingUI.finalize()
      else if (event.mode === 'tool-use') { thinkingUI.finalize(); finalizeStream() }
      break
    case 'context_collapse_stats': {
      const el = document.getElementById('collapse-stats')
      if (el) { el.style.display = ''; el.textContent = `${event.collapsedSpans}${tt('context_collapsed')}${event.stagedSpans}${tt('context_staged')}` }
      break
    }
    case 'api_error': appendError(event.error); break
    case 'api_retry': appendError(`${tt('retrying_prefix')}${event.attempt}/${event.maxRetries})...`); break
    case 'auth_required': appendAuthRequired(event.reason, event.mode); break
    // Agent events
    case 'team_created': agentPanel.team = { name: event.teamName }; renderAgentPanel(); break
    case 'teammate_spawned': agentPanel.agents.set(event.agentId, { name: event.name, color: event.color || 'blue', status: 'idle', toolUseCount: 0 }); renderAgentPanel(); break
    case 'agent_progress': { const ag = agentPanel.agents.get(event.agentId); if (ag) { ag.status = 'running'; ag.toolUseCount = event.toolUseCount }; renderAgentPanel(); break }
    case 'agent_done': { const ag2 = agentPanel.agents.get(event.agentId); if (ag2) ag2.status = event.status || 'completed'; renderAgentPanel(); setTimeout(() => { agentPanel.agents.delete(event.agentId); renderAgentPanel() }, 5000); break }
    // File
    case 'file': if (event.name && event.url) appendFileCard(event.name, event.url); break
    // MCP OAuth
    case 'mcp_auth_url': if (event.url) { window.open(event.url, '_blank'); appendSystemMsg(tt('mcp_auth_opened_prefix') + (event.serverName || tt('mcp_auth_opened_fallback'))) }; break
    // Pending permission cancelled by engine (e.g., user hit Stop mid-ask).
    // Tear down the card so the interrupt visibly takes effect.
    case 'permission_cancelled': {
      const askCard = document.getElementById('q-' + event.requestId)
      if (askCard) {
        finalizeQuestionCard(askCard, 'skipped', null, [], [])
      } else {
        // Generic permission card (Bash/Glob/etc.). Tear it down + stop the
        // 120s countdown timer so it doesn't auto-deny a request that's
        // already been resolved server-side.
        const permCard = document.getElementById('perm-' + event.requestId)
        if (permCard) {
          if (permCard.dataset.timer) clearInterval(parseInt(permCard.dataset.timer))
          permCard.classList.add('permission-resolved')
          const actions = permCard.querySelector('.permission-actions')
          if (actions) actions.innerHTML = `<div class="permission-result permission-denied">${tt('cancelled') || 'Cancelled'}</div>`
          permCard.querySelector('.permission-timer')?.remove()
        }
      }
      break
    }
    case 'compaction_start':
      // Auto-compact path (e.g. token-budget triggered): show the streaming
      // indicator. Manual compact via the toolbar button has already shown
      // it locally before the IPC fires; compactProgress.show() is
      // idempotent so the duplicate is a no-op.
      compactProgress.show()
      break
    case 'compact_boundary':
      // Compaction succeeded. Reload the transcript so the user sees the
      // post-compact view (engine replaced session.messages with
      // [boundary, summary, attachments]; getHistory projects past the
      // boundary). Context panel refreshed too.
      compactProgress.hide()
      reloadTranscriptForCurrentSession()
      refreshContextStatsThrottled(event.sessionId, 50)
      break
    case 'compaction_end':
      compactProgress.hide()
      refreshContextStatsThrottled(event.sessionId, 50)
      break
    case 'compaction_error':
      compactProgress.hide()
      appendError((tt('compact_failed_prefix') || 'Compaction failed: ') + (event.error || 'unknown'))
      break
    case 'done':
      thinkingUI.finalize(); finalizeStream()
      // 本轮最后一段 assistant 才该带时间+复制按钮(中间段被 tool_use 切开过)。
      attachCopyToTurnTail()
      // Just-sent user bubbles missed the uuid in appendUserMsg; the host has
      // now flushed their JSONL line, so backfill uuids + delete/rewind buttons.
      refreshLiveUserUuids(event.sessionId)
      // Refresh the context monitor — the turn that just ended changed the
      // message buffer; throttled so back-to-back done events (rare but
      // possible across cron/external channels) collapse into one IPC.
      refreshContextStatsThrottled(event.sessionId)
      busy = false
      btnSend.classList.remove('busy')
      btnSend.disabled = !inputEl.value.trim()
      inputEl.focus()
      updateSessionInList()
      // If the session that just finished is a cron run, refresh runs for
      // every task so the task-level unread dot can update — same reason
      // as the off-screen "done" branch above.
      if (isCronRunSession(event.sessionId)) refreshCronRunsForAllTasks()
      break
  }
})

klausApi.on.permissionRequest(showPermissionRequest)

klausApi.on.engineStatus((s) => {
  statusEl.className = ''
  statusEl.textContent = ''
  if (s.status === 'error') {
    statusEl.textContent = tt('error')
    statusEl.className = 'error'
  }
})

function appendError(msg) {
  const group = document.createElement('div')
  group.className = 'msg-group assistant'
  group.innerHTML = `<div class="msg error">${escapeHtml(msg)}</div>`
  messagesEl.appendChild(group)
  scrollToBottom()
}

function appendSystemMsg(msg) {
  const group = document.createElement('div')
  group.className = 'msg-group assistant'
  group.innerHTML = `<div class="msg assistant" style="color:var(--fg-tertiary);font-size:13px">${escapeHtml(msg)}</div>`
  messagesEl.appendChild(group)
  scrollToBottom()
}

function appendAuthRequired(reason, mode) {
  const group = document.createElement('div')
  group.className = 'msg-group assistant'
  const isSubscription = mode === 'subscription'
  const icon = isSubscription
    ? `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" style="flex-shrink:0"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
    : `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" style="flex-shrink:0"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`
  const title = isSubscription ? tt('auth_card_sub_title') : tt('auth_card_custom_title')
  const hint = isSubscription ? tt('auth_card_sub_hint') : tt('auth_card_custom_hint')
  const primaryLabel = isSubscription ? tt('auth_primary_sub') : tt('auth_primary_custom')
  const secondaryLabel = isSubscription ? tt('auth_secondary_sub') : tt('auth_secondary_custom')

  group.innerHTML = `
    <div class="msg assistant auth-card" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:16px;max-width:520px">
      <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:12px">
        <div style="color:var(--accent, #3b82f6);margin-top:2px">${icon}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:15px;margin-bottom:4px">${escapeHtml(title)}</div>
          <div style="font-size:13px;color:var(--fg-tertiary);line-height:1.5">${escapeHtml(hint)}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn-sm btn-primary" id="auth-primary-btn" style="padding:7px 14px;font-size:13px;font-weight:500">${escapeHtml(primaryLabel)}</button>
        <button class="btn-sm" id="auth-switch-btn" style="padding:7px 14px;font-size:13px;background:transparent;color:var(--fg-tertiary);border:1px solid var(--border)">${escapeHtml(secondaryLabel)}</button>
      </div>
      <div id="auth-action-status" style="margin-top:10px;font-size:12px;color:var(--fg-tertiary)"></div>
    </div>`
  messagesEl.appendChild(group)

  const primaryBtn = group.querySelector('#auth-primary-btn')
  const switchBtn = group.querySelector('#auth-switch-btn')
  const statusEl = group.querySelector('#auth-action-status')

  primaryBtn?.addEventListener('click', async () => {
    if (isSubscription) {
      // 直接触发 OAuth 登录流程
      primaryBtn.disabled = true
      primaryBtn.textContent = tt('auth_opening_browser')
      if (statusEl) statusEl.textContent = tt('auth_wait_browser')
      try {
        const res = await window.klaus.auth.login()
        if (res?.ok) {
          primaryBtn.textContent = tt('auth_success')
          if (statusEl) statusEl.textContent = tt('auth_please_resend')
        } else {
          primaryBtn.disabled = false
          primaryBtn.textContent = tt('auth_retry_login')
          if (statusEl) statusEl.textContent = tt('auth_login_failed_prefix') + (res?.error || tt('auth_unknown_error'))
        }
      } catch (err) {
        primaryBtn.disabled = false
        primaryBtn.textContent = tt('auth_retry_login')
        if (statusEl) statusEl.textContent = tt('auth_login_failed_prefix') + (err?.message || String(err))
      }
    } else {
      // 跳转到模型设置页配置自定义模型
      if (!settingsVisibleIfAny()) {
        if (typeof window.toggleSettings === 'function') window.toggleSettings('models')
      } else {
        if (typeof window.loadSettingsTab === 'function') window.loadSettingsTab('models')
      }
    }
  })

  switchBtn?.addEventListener('click', async () => {
    // 一键切到另一种模式
    const newMode = isSubscription ? 'custom' : 'subscription'
    try {
      await window.klaus.settings.kv.set('auth_mode', newMode)
      window.dispatchEvent(new Event('klaus:auth-mode-changed'))
      if (statusEl) statusEl.textContent = newMode === 'subscription' ? tt('auth_mode_switched_sub') : tt('auth_mode_switched_custom')
      primaryBtn.disabled = true
    } catch (err) {
      if (statusEl) statusEl.textContent = tt('auth_switch_failed_prefix') + (err?.message || String(err))
    }
  })

  scrollToBottom()
}

function settingsVisibleIfAny() {
  return document.getElementById('settings-view')?.classList.contains('active')
}

async function updateSessionInList() { sessions = await klausApi.session.list(); renderSessionList() }

// ==================== Utils ====================

function scrollToBottom() { requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight }) }
function escapeHtml(str) { return str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '' }
function autoResize() { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px' }
function updateSendBtn() {
  // busy 态按钮显示为 stop，始终可点（用于中断）；非 busy 时根据输入框是否有内容
  if (busy) { btnSend.disabled = false; return }
  btnSend.disabled = !inputEl.value.trim()
}

// ==================== Input events ====================

inputEl.addEventListener('keydown', (e) => {
  // IME 合成中（中/日/韩输入法候选词选择）按回车不应触发任何快捷行为。
  // isComposing 在 Chromium 上并不总是可靠（按回车确认候选时常已变 false），
  // 同时用 keyCode === 229 兜底，这是 W3C/业界通用做法。
  if (e.isComposing || e.keyCode === 229) return
  // Slash menu navigation
  if (!slashMenu.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') { e.preventDefault(); navigateSlashMenu(1); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); navigateSlashMenu(-1); return }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault()
      const items = slashMenu.querySelectorAll('.slash-menu-item')
      if (items[slashActiveIdx]) items[slashActiveIdx].click()
      return
    }
    if (e.key === 'Escape') { hideSlashMenu(); return }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
})

inputEl.addEventListener('input', () => {
  autoResize(); updateSendBtn(); handleSlashMenu()
  if (currentSessionId) setDraft(currentSessionId, inputEl.value)
})
btnSend.addEventListener('click', () => {
  if (busy) {
    // 中断当前响应
    if (currentSessionId) klausApi.chat.interrupt(currentSessionId).catch(() => {})
  } else {
    send()
  }
})
btnNewChat.addEventListener('click', () => {
  // Coming from cron/settings view: close the overlay before starting a new chat
  if (typeof window.hideCronView === 'function') window.hideCronView()
  if (document.getElementById('settings-view')?.classList.contains('active')) toggleSettings()
  newChat()
})

document.getElementById('btn-cron')?.addEventListener('click', () => {
  // Close settings if open, then toggle cron view
  if (document.getElementById('settings-view')?.classList.contains('active')) toggleSettings()
  if (typeof window.showCronView === 'function') window.showCronView()
})

// Sidebar toggle
document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed
  document.getElementById('sidebar')?.classList.toggle('collapsed', sidebarCollapsed)
  localStorage.setItem('klaus_sidebar_collapsed', sidebarCollapsed ? '1' : '0')
})

// User menu
function closeUserMenu() {
  userMenuOpen = false
  document.getElementById('user-menu')?.classList.remove('open')
  document.getElementById('user-menu-lang')?.classList.remove('open')
}

function initLangSubmenu() {
  const submenu = document.getElementById('user-menu-lang')
  if (!submenu) return
  const checkSvg = '<svg class="menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'
  submenu.innerHTML = `
    <button class="user-menu-item${currentLang === 'en' ? ' active' : ''}" data-lang="en"><span>English</span>${currentLang === 'en' ? checkSvg : ''}</button>
    <button class="user-menu-item${currentLang === 'zh' ? ' active' : ''}" data-lang="zh"><span>中文</span>${currentLang === 'zh' ? checkSvg : ''}</button>
  `
  submenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lang]')
    if (btn) {
      const lang = btn.dataset.lang
      setLanguage(lang)
      klausApi?.settings?.kv?.set?.('language', lang).catch(() => {})
      updateLangSubmenuActive(lang)
    }
  })
}

function updateLangSubmenuActive(lang) {
  const submenu = document.getElementById('user-menu-lang')
  if (submenu) {
    const checkSvg = '<svg class="menu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'
    submenu.querySelectorAll('[data-lang]').forEach(btn => {
      const isActive = btn.dataset.lang === lang
      btn.classList.toggle('active', isActive)
      const check = btn.querySelector('.menu-check')
      if (isActive && !check) btn.innerHTML += checkSvg
      else if (!isActive && check) check.remove()
    })
  }
}

document.getElementById('sidebar-user')?.addEventListener('click', (e) => {
  e.stopPropagation()
  if (userMenuOpen) {
    closeUserMenu()
  } else {
    userMenuOpen = true
    document.getElementById('user-menu')?.classList.add('open')
  }
})
document.addEventListener('click', closeUserMenu)
initLangSubmenu()
document.getElementById('menu-settings')?.addEventListener('click', () => {
  closeUserMenu()
  toggleSettings()
})
document.getElementById('menu-language')?.addEventListener('click', (e) => {
  e.stopPropagation()
  const langSubmenu = document.getElementById('user-menu-lang')
  if (!langSubmenu) return
  if (langSubmenu.classList.contains('open')) {
    langSubmenu.classList.remove('open')
  } else {
    const menuBtn = e.currentTarget
    const rect = menuBtn.getBoundingClientRect()
    langSubmenu.style.left = (rect.right + 8) + 'px'
    langSubmenu.style.top = rect.top + 'px'
    langSubmenu.classList.add('open')
  }
})
document.getElementById('menu-help')?.addEventListener('click', () => {
  closeUserMenu()
  window.open('https://github.com/anthropics/claude-code/issues', '_blank')
})
document.getElementById('menu-logout')?.addEventListener('click', async () => {
  closeUserMenu()
  try { await klausApi.klausAuth?.logout?.() } catch {}
  // Reset local profile cache so the login screen doesn't show stale info
  try {
    await klausApi.settings.kv.set('display_name', '')
    await klausApi.settings.kv.set('avatar_data_url', '')
    await klausApi.settings.kv.set('email', '')
  } catch {}
  showLoginScreen()
})

// Settings back
document.getElementById('settings-back')?.addEventListener('click', () => toggleSettings())
document.querySelectorAll('.settings-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    loadSettingsTab(btn.dataset.stab)
  })
})

// Agent panel toggle
document.getElementById('agent-panel-header')?.addEventListener('click', () => agentPanelEl?.classList.toggle('collapsed'))
document.getElementById('agent-panel-close')?.addEventListener('click', (e) => { e.stopPropagation(); if (agentPanelEl) agentPanelEl.style.display = 'none' })

// File attach
btnAttach.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) addFiles([...fileInput.files])
  fileInput.value = ''
})

function addFiles(files) {
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) { appendError(tt('file_too_large') + f.name); continue }
    const entry = { file: f, objectUrl: null, uploadPath: null, uploading: true }
    if (f.type.startsWith('image/')) entry.objectUrl = URL.createObjectURL(f)
    pendingFiles.push(entry)
    // Upload via IPC — saves to ~/.klaus/uploads/
    uploadFileEntry(entry)
  }
  renderPreviews()
  updateSendBtn()
}

async function uploadFileEntry(entry) {
  try {
    // Read file as ArrayBuffer and send to main process
    const buffer = await entry.file.arrayBuffer()
    const result = await klausApi.chat.uploadFile(entry.file.name, entry.file.type, buffer)
    entry.uploadPath = result.path
  } catch (err) {
    appendError(tt('upload_failed_short') + entry.file.name)
    pendingFiles = pendingFiles.filter(e => e !== entry)
  }
  entry.uploading = false
  renderPreviews()
  updateSendBtn()
}

function renderPreviews() {
  const previewsEl = document.getElementById('previews')
  if (!previewsEl) return
  previewsEl.innerHTML = ''
  previewsEl.classList.toggle('has-files', pendingFiles.length > 0)
  for (const entry of pendingFiles) {
    const item = document.createElement('div')
    item.className = 'preview-item'
    if (entry.objectUrl) {
      item.innerHTML = `<img src="${entry.objectUrl}"><button class="remove">&times;</button>`
    } else {
      item.innerHTML = `<div class="file-info">${entry.uploading ? escapeHtml(tt('uploading_label')) : ''}${escapeHtml(entry.file.name)}</div><button class="remove">&times;</button>`
    }
    item.querySelector('.remove').onclick = () => {
      pendingFiles = pendingFiles.filter(e => e !== entry)
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl)
      renderPreviews(); updateSendBtn()
    }
    previewsEl.appendChild(item)
  }
}

// Drag-drop
document.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay.classList.add('active') })
document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) dropOverlay.classList.remove('active') })
document.addEventListener('drop', (e) => {
  e.preventDefault(); dropOverlay.classList.remove('active')
  if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files])
})

// Image paste
inputEl.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const f = item.getAsFile()
      if (f) addFiles([f])
      break
    }
  }
})

// Tray events
klausApi.on.trayNewChat?.(() => newChat())
klausApi.on.trayOpenSettings?.(() => { if (!document.getElementById('settings-view').classList.contains('active')) toggleSettings() })

// External channel activity (wechat/feishu/…). Engine stream events don't
// reach this renderer; the main process fires one notification per persisted
// user/assistant message. Mirrors Web 端 web-ui-chat-js.ts `channel_message`
// handler: always refresh sidebar, and if the current session IS the touched
// one, append the new message live so the user doesn't need to switch sessions.

// ==================== Klaus user login (PKCE + klaus:// callback) ====================

const loginScreen = document.getElementById('login-screen')
const loginBtn = document.getElementById('login-btn')
const loginBtnLabel = document.getElementById('login-btn-label')
const loginErrorEl = document.getElementById('login-error')
const loginLangBtn = document.getElementById('login-lang-btn')
const loginLangMenu = document.getElementById('login-lang-menu')
const loginLangLabel = document.getElementById('login-lang-label')

function showLoginScreen() {
  if (!loginScreen) return
  if (typeof window.applyI18n === 'function') window.applyI18n()
  syncLoginLangLabel()
  loginScreen.style.display = 'flex'
  document.getElementById('app').style.visibility = 'hidden'
}

function hideLoginScreen() {
  if (!loginScreen) return
  loginScreen.style.display = 'none'
  document.getElementById('app').style.visibility = ''
}

function setLoginMessage(msg) {
  if (!loginErrorEl) return
  loginErrorEl.classList.remove('show')
  if (!msg) { loginErrorEl.textContent = ''; return }
  loginErrorEl.textContent = msg
  loginErrorEl.classList.add('show')
}

function syncLoginLangLabel() {
  if (!loginLangLabel) return
  const lang = document.documentElement.lang || 'en'
  loginLangLabel.textContent = lang === 'zh' ? '中文' : 'English'
}

loginBtn?.addEventListener('click', async () => {
  loginBtn.disabled = true
  if (loginBtnLabel) loginBtnLabel.textContent = tt('login_opening')
  setLoginMessage('')
  try {
    const res = await klausApi.klausAuth.login()
    if (res?.ok) {
      hideLoginScreen()
      await init()
    } else {
      loginBtn.disabled = false
      if (loginBtnLabel) loginBtnLabel.textContent = tt('login_retry')
      setLoginMessage(tt('login_failed_prefix') + (res?.error || ''))
    }
  } catch (err) {
    loginBtn.disabled = false
    if (loginBtnLabel) loginBtnLabel.textContent = tt('login_retry')
    setLoginMessage(tt('login_failed_prefix') + (err?.message || String(err)))
  }
})

loginLangBtn?.addEventListener('click', (e) => {
  e.stopPropagation()
  loginLangMenu?.classList.toggle('hidden')
})
document.addEventListener('click', () => loginLangMenu?.classList.add('hidden'))
loginLangMenu?.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    e.stopPropagation()
    const lang = btn.dataset.lang
    if (!lang) return
    try {
      if (typeof window.setLanguage === 'function') window.setLanguage(lang)
      document.documentElement.lang = lang
      await klausApi.settings.kv.set('language', lang)
    } catch {}
    syncLoginLangLabel()
    loginLangMenu?.classList.add('hidden')
  })
})

// 把云端 user (displayName/email/avatarUrl) 写进本地 KV，供 bootstrapProfile 读。
// boot 时从 klausAuth:status 拿；登录成功 / 个人资料更新后由 klausAuth:updated 事件再调一次，
// 这样侧栏和设置页都能立刻反映最新值。
async function seedIdentityKv(user) {
  if (!user) return
  try {
    if (user.displayName) await klausApi.settings.kv.set('display_name', user.displayName)
    await klausApi.settings.kv.set('email', user.email || '')
    if (user.avatarUrl) {
      const url = user.avatarUrl.startsWith('http')
        ? user.avatarUrl
        : 'https://klaus-ai.site' + user.avatarUrl
      await klausApi.settings.kv.set('avatar_data_url', url)
    } else {
      await klausApi.settings.kv.set('avatar_data_url', '')
    }
  } catch {}
}
window.seedIdentityKv = seedIdentityKv

// 登录完成 / 服务端资料更新时 main 会广播 klausAuth:updated
klausApi.on?.klausAuthUpdated?.(async ({ user }) => {
  if (user) {
    await seedIdentityKv(user)
    if (typeof window.bootstrapProfile === 'function') await window.bootstrapProfile()
  }
})

// --- Boot ---
async function boot() {
  try {
    if (typeof window.loadPreferences === 'function') await window.loadPreferences()
  } catch {}
  if (typeof window.applyI18n === 'function') window.applyI18n()
  try {
    const savedLang = await klausApi.settings.kv.get('language').catch(() => null)
    if (savedLang) document.documentElement.lang = savedLang
  } catch {}

  let loggedIn = false
  try {
    const status = await klausApi.klausAuth?.status?.()
    loggedIn = !!status?.loggedIn
    if (loggedIn && status?.user) {
      await seedIdentityKv(status.user)
    }
  } catch (err) {
    console.warn('klausAuth status failed:', err)
  }

  if (!loggedIn) {
    showLoginScreen()
    return
  }
  hideLoginScreen()
  await init()
}

// ===== Artifacts panel =====
const artifactsPanel = document.getElementById('artifacts-panel')
const artifactsList = document.getElementById('artifacts-list')
const artifactsFilesLabel = document.getElementById('artifacts-files-label')
const artifactsWorkspaceRow = document.getElementById('artifacts-workspace-row')
const artifactsToggleBtn = document.getElementById('artifacts-panel-toggle')
const artifactsToggleBtnInner = document.getElementById('artifacts-panel-toggle-inner')
const artifactState = new Map()

artifactsWorkspaceRow?.addEventListener('click', () => {
  if (!currentSessionId) return
  klausApi.artifacts.openWorkspace(currentSessionId).catch(() => {})
})

// Default to collapsed; user opens it from the header toggle when needed.
if (artifactsPanel && localStorage.getItem('klaus_artifacts_collapsed') !== '0') {
  artifactsPanel.classList.add('collapsed')
}
function syncArtifactsToggleVisibility() {
  if (!artifactsPanel) return
  const collapsed = artifactsPanel.classList.contains('collapsed')
  if (artifactsToggleBtn) artifactsToggleBtn.style.display = collapsed ? '' : 'none'
  if (artifactsToggleBtnInner) artifactsToggleBtnInner.style.display = collapsed ? 'none' : ''
}
function toggleArtifactsPanel() {
  if (!artifactsPanel) return
  const on = !artifactsPanel.classList.contains('collapsed')
  artifactsPanel.classList.toggle('collapsed', on)
  localStorage.setItem('klaus_artifacts_collapsed', on ? '1' : '0')
  syncArtifactsToggleVisibility()
}
artifactsToggleBtn?.addEventListener('click', toggleArtifactsPanel)
artifactsToggleBtnInner?.addEventListener('click', toggleArtifactsPanel)
syncArtifactsToggleVisibility()

function fileIconSvg(name) {
  const lower = (name || '').toLowerCase()
  if (/\.(md|markdown)$/.test(lower)) {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 1.5H3.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V5.5z"/><polyline points="9.5,1.5 9.5,5.5 13.5,5.5"/><line x1="5" y1="9" x2="11" y2="9"/><line x1="5" y1="11.5" x2="11" y2="11.5"/></svg>'
  }
  if (/\.(json|ya?ml|toml)$/.test(lower)) {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2H4.5a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1 1 1 0 0 1 1 1v3a1 1 0 0 0 1 1H5"/><path d="M11 14h.5a1 1 0 0 0 1-1v-3a1 1 0 0 1 1-1 1 1 0 0 1-1-1V5a1 1 0 0 0-1-1H11"/></svg>'
  }
  if (/\.(sh|bash|zsh|fish|bat|ps1)$/.test(lower)) {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,11 7,7 3,3"/><line x1="8" y1="13" x2="13" y2="13"/></svg>'
  }
  if (/\.(py|js|ts|jsx|tsx|go|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt)$/.test(lower)) {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="11,12 14.5,8 11,4"/><polyline points="5,4 1.5,8 5,12"/></svg>'
  }
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 1.5H3.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V5.5z"/><polyline points="9.5,1.5 9.5,5.5 13.5,5.5"/></svg>'
}

function makeArtifactItem(item) {
  const li = document.createElement('li')
  li.className = 'artifact-item'
  li.title = item.filePath
  li.innerHTML = '<span class="artifact-item-icon">' + fileIconSvg(item.fileName) + '</span><span class="artifact-item-name">' + escapeHtml(item.fileName || item.filePath) + '</span>'
  li.addEventListener('click', () => openArtifactPreview(item.filePath, item.fileName))
  return li
}

function refreshArtifactFilesLabel() {
  if (!artifactsFilesLabel) return
  artifactsFilesLabel.style.display = artifactState.size > 0 ? '' : 'none'
}

function clearArtifactList() {
  artifactState.clear()
  if (artifactsList) artifactsList.innerHTML = ''
  refreshArtifactFilesLabel()
}

function upsertArtifactItem(item) {
  if (!artifactsList || !item || !item.filePath) return
  if (item.sessionId && item.sessionId !== currentSessionId) return
  const existing = artifactState.get(item.filePath)
  if (existing && existing.parentNode === artifactsList) artifactsList.removeChild(existing)
  const li = makeArtifactItem(item)
  if (artifactsList.firstChild) artifactsList.insertBefore(li, artifactsList.firstChild)
  else artifactsList.appendChild(li)
  artifactState.set(item.filePath, li)
  refreshArtifactFilesLabel()
}

function renderArtifactList(items) {
  if (!artifactsList) return
  artifactState.clear()
  artifactsList.innerHTML = ''
  for (const item of items) {
    const li = makeArtifactItem(item)
    artifactsList.appendChild(li)
    artifactState.set(item.filePath, li)
  }
  refreshArtifactFilesLabel()
}

async function loadArtifacts(sessionId) {
  if (!sessionId) { clearArtifactList(); return }
  try {
    const data = await klausApi.artifacts.list(sessionId)
    renderArtifactList(data?.artifacts || [])
  } catch {
    clearArtifactList()
  }
}

function openArtifactPreview(filePath) {
  if (!filePath || !currentSessionId) return
  klausApi.artifacts.openWindow(currentSessionId, filePath).catch(() => {})
}

boot()
