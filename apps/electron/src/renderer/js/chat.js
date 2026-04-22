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
    el.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div><span class="thinking-label">${tt('thinking_label')}</span>`
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
      done.className = 'thinking-done'
      done.innerHTML = `<div class="thinking-toggle"><span>${tt('thought_for') || 'Thought for '}${elapsed}s</span><svg class="thinking-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l3 3 3-3"/></svg></div><div class="thinking-detail">${escapeHtml(content)}</div>`
      done.querySelector('.thinking-toggle').onclick = () => done.classList.toggle('open')
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
let slashSkillsCache = null
let slashActiveIdx = -1
let agentPanel = { team: null, agents: new Map() }

const AGENT_COLOR_MAP = { blue: '#3b82f6', green: '#16a34a', purple: '#9333ea', orange: '#ea580c', red: '#dc2626', yellow: '#eab308' }
let pendingFiles = []  // { file, objectUrl, uploadId, uploading }
let sessionDom = new Map()  // sessionId → DocumentFragment cache
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
let cronGroupExpanded = localStorage.getItem('klaus_cron_group_expanded') !== '0'
const cronTaskExpanded = (() => {
  try { return new Set(JSON.parse(localStorage.getItem('klaus_cron_tasks_expanded') || '[]')) }
  catch { return new Set() }
})()
function persistCronExpanded() {
  try {
    localStorage.setItem('klaus_cron_group_expanded', cronGroupExpanded ? '1' : '0')
    localStorage.setItem('klaus_cron_tasks_expanded', JSON.stringify([...cronTaskExpanded]))
  } catch {}
}
function isCronRunSession(id) { return typeof id === 'string' && id.startsWith('cron-run-') }

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
// run isn't in the expanded-task cache (user opened a run whose task was
// never expanded — we'd have to fetch, but that's rare).
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
// without pulling the user out of the cron management page. We only expand
// the task + refresh its runs; the user decides whether to click in and
// watch. (Auto-switching meant staring at a blank chat while the engine
// spun up, which was worse than just leaving a pulsing dot in the sidebar.)
window.surfaceCronRunInSidebar = async (taskId) => {
  if (taskId) {
    cronTaskExpanded.add(taskId)
    try { localStorage.setItem('klaus_cron_tasks_expanded', JSON.stringify([...cronTaskExpanded])) } catch {}
  }
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
    for (const tid of [...cronTaskExpanded]) if (!keep.has(tid)) cronTaskExpanded.delete(tid)
    // Preload runs for tasks the user has expanded so the first expand
    // doesn't flicker empty-then-populated.
    await Promise.all([...cronTaskExpanded].map(async (tid) => {
      try {
        const runs = (await klausApi.settings.cron.runs({ taskId: tid, limit: 100 })) || []
        cronRunsByTask.set(tid, runs)
      } catch { cronRunsByTask.set(tid, []) }
    }))
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
  if (typeof window.toggleSettings === 'function' && !settingsVisibleIfAny()) window.toggleSettings()
  if (typeof window.loadSettingsTab === 'function') window.loadSettingsTab('models')
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
  // Pinned "定时任务" group at the top. Renders nothing when no cron tasks.
  renderCronSidebarGroup()
  // Regular flat sessions, excluding cron-run sessions (they live under
  // their task in the pinned group above).
  for (const s of sessions) {
    if (isCronRunSession(s.id)) continue
    const div = document.createElement('div')
    div.className = 'session-item' + (s.id === currentSessionId ? ' active' : '')
    const displayTitle = s.title && s.title !== 'New Chat' ? s.title : tt('new_chat')
    const ch = detectChannelPrefix(s.id)
    const badgeHtml = ch ? `<span class="s-channel-badge">${escapeHtml(tt('settings_ch_' + ch))}</span>` : ''
    const hasDraft = (sessionDrafts.get(s.id) || '').trim().length > 0
    const showDraft = hasDraft && !sessionHasMessages(s)
    const draftHtml = showDraft ? `<span class="s-draft-badge">${escapeHtml(tt('draft_badge'))}</span>` : ''
    div.innerHTML = `${badgeHtml}<div class="s-title">${escapeHtml(displayTitle)}</div>${draftHtml}<button class="s-del" title="${escapeHtml(tt('delete_title'))}">&times;</button>`
    div.onclick = () => switchSession(s.id)
    div.querySelector('.s-del').onclick = (e) => { e.stopPropagation(); deleteSession(s.id) }
    sessionListEl.appendChild(div)
  }
}

// Pinned "定时任务" group at top of the sidebar. Two-level collapse:
// outer group header → list of tasks; each task header → list of runs.
// Click a run to open its dedicated chat thread via switchSession().
// Always renders — even with zero tasks — so the folder is a stable entry
// point for users to go create one.
function renderCronSidebarGroup() {
  const group = document.createElement('div')
  group.className = 'cron-sb-group' + (cronGroupExpanded ? ' open' : '')

  const head = document.createElement('div')
  head.className = 'cron-sb-head'
  head.innerHTML = `
    <svg class="cron-sb-caret" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4.5,3 7.5,6 4.5,9"/></svg>
    <svg class="cron-sb-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><polyline points="8,4 8,8 10.5,9.5"/></svg>
    <span class="cron-sb-title">${escapeHtml(tt('cron'))}</span>`
  head.onclick = () => {
    cronGroupExpanded = !cronGroupExpanded
    persistCronExpanded()
    renderSessionList()
  }
  group.appendChild(head)

  if (cronGroupExpanded) {
    const body = document.createElement('div')
    body.className = 'cron-sb-body'
    if (!cronTasks || cronTasks.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'cron-sb-task-empty'
      empty.textContent = tt('cron_no_tasks') || tt('cron_runs_empty')
      body.appendChild(empty)
    } else {
      for (const task of cronTasks) {
        body.appendChild(renderCronSidebarTask(task))
      }
    }
    group.appendChild(body)
  }
  sessionListEl.appendChild(group)
}

function renderCronSidebarTask(task) {
  const expanded = cronTaskExpanded.has(task.id)
  const wrap = document.createElement('div')
  wrap.className = 'cron-sb-task' + (expanded ? ' open' : '')

  const head = document.createElement('div')
  head.className = 'cron-sb-task-head'
  const title = task.name || task.id
  head.innerHTML = `
    <svg class="cron-sb-caret" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4.5,3 7.5,6 4.5,9"/></svg>
    <span class="cron-sb-task-title">${escapeHtml(title)}</span>`
  head.onclick = async () => {
    if (cronTaskExpanded.has(task.id)) {
      cronTaskExpanded.delete(task.id)
      persistCronExpanded()
      renderSessionList()
    } else {
      cronTaskExpanded.add(task.id)
      persistCronExpanded()
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
  const dot = run.status === 'failed' ? 'failed' : run.status === 'running' ? 'running' : 'success'
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
  el.innerHTML = `<span class="cron-sb-run-dot ${dot}"></span><span class="cron-sb-run-label">${escapeHtml(label)}</span>${channelBadge}`
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
  renderSessionList()
  renderCronChannelBanner(id)
  messagesEl.innerHTML = ''
  resetStreamState()

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
    for (const msg of history) {
      if (msg.role === 'user') appendUserMsg(msg.text)
      else if (Array.isArray(msg.contentBlocks)) appendAssistantFromBlocks(msg.contentBlocks)
      else appendFinalAssistantMsg(msg.text)
    }
  }

  // 空 session → 显示 welcome（带 chips）；有消息 → 隐藏
  const hasContent = messagesEl.childNodes.length > 0
  messagesEl.style.display = hasContent ? 'block' : 'none'
  welcomeEl.style.display = hasContent ? 'none' : 'flex'
  scrollToBottom()
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
  await klausApi.session.delete(id)
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

function appendUserMsg(text) {
  const group = document.createElement('div')
  group.className = 'msg-group user'
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
  messagesEl.appendChild(group)
  scrollToBottom()
}

function appendFinalAssistantMsg(text) {
  const group = document.createElement('div')
  group.className = 'msg-group assistant'
  const msgEl = document.createElement('div')
  msgEl.className = 'msg assistant'
  msgEl.innerHTML = renderMarkdown(text)
  group.innerHTML = `<div class="msg-label">${tt('bot_name')}</div>`
  group.appendChild(msgEl)
  postProcessMsg(msgEl)
  messagesEl.appendChild(group)
}

// Restore an assistant turn from its original engine content block array.
// Mirrors the live-stream rendering (thinking fold + tool cards + text), so
// Cmd+R reload looks identical to what the user saw during streaming. Block
// shapes match CC: { type: 'thinking', thinking } / { type: 'text', text } /
// { type: 'tool_use', name, id, input } / { type: 'tool_result', ... }.
function appendAssistantFromBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return
  // Collect thinking & text separately so we can render one fold + one bubble
  // per turn, matching the live UI.
  let thinkingText = ''
  let mainText = ''
  const toolBlocks = []
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'thinking' || b.type === 'redacted_thinking') {
      thinkingText += (b.thinking ?? b.data ?? '')
    } else if (b.type === 'text' && typeof b.text === 'string') {
      mainText += b.text
    } else if (b.type === 'tool_use') {
      toolBlocks.push(b)
    }
  }
  // Thinking fold (no duration from disk — show just the content)
  if (thinkingText.trim()) {
    const done = document.createElement('div')
    done.className = 'thinking-done'
    done.innerHTML = `<div class="thinking-toggle"><span>${tt('thought_for') || 'Thought for '}…</span><svg class="thinking-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l3 3 3-3"/></svg></div><div class="thinking-detail">${escapeHtml(thinkingText)}</div>`
    done.querySelector('.thinking-toggle').onclick = () => done.classList.toggle('open')
    messagesEl.appendChild(done)
  }
  // Tool cards (simplified, matches live tool-start/end visual). Any
  // AskUserQuestion blocks rebuild their resolved interactive card below.
  const askBlocks = []
  const plainToolBlocks = []
  for (const tb of toolBlocks) {
    if (tb?.name === 'AskUserQuestion') askBlocks.push(tb)
    else plainToolBlocks.push(tb)
  }
  if (plainToolBlocks.length > 0) {
    const container = document.createElement('div')
    container.className = 'tool-container'
    for (const tb of plainToolBlocks) {
      const cat = getToolCategory(tb.name || '')
      const item = document.createElement('div')
      item.className = 'tool-item done' + (cat ? ' ' + cat : '')
      let valueText = ''
      const args = tb.input
      if (args && typeof args === 'object') {
        if (args.command) valueText = '$ ' + args.command
        else if (args.file_path) valueText = args.file_path
        else if (args.pattern) valueText = args.pattern
        else { const v = JSON.stringify(args); valueText = v.length > 80 ? v.slice(0, 80) + '…' : v }
      }
      item.innerHTML = `<span class="tool-label">${escapeHtml(tb.name || '')}</span><span class="tool-value${cat === 'terminal' ? ' terminal-cmd' : ''}">${escapeHtml(valueText)}</span><span class="tool-secondary">${escapeHtml(tt('tool_completed'))}</span>`
      container.appendChild(item)
    }
    messagesEl.appendChild(container)
  }
  for (const tb of askBlocks) {
    rebuildAskUserQuestionCard(tb)
  }
  // Main text bubble
  if (mainText.trim()) appendFinalAssistantMsg(mainText)
}

function ensureAssistantGroup() {
  if (!currentMsgGroup) {
    currentMsgGroup = document.createElement('div')
    currentMsgGroup.className = 'msg-group assistant'
    currentMsgGroup.innerHTML = `<div class="msg-label">${tt('bot_name')}</div>`
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
  streamBuffer += text
  const group = ensureAssistantGroup()
  let msgEl = group.querySelector('.msg.assistant')
  if (!msgEl) {
    msgEl = document.createElement('div')
    msgEl.className = 'msg assistant streaming'
    group.appendChild(msgEl)
  }
  msgEl.innerHTML = renderMarkdown(streamBuffer)
  msgEl.classList.add('streaming')
  scrollToBottom()
}

function finalizeStream() {
  if (!currentMsgGroup) return
  const msgEl = currentMsgGroup.querySelector('.msg.assistant.streaming')
  if (msgEl) {
    msgEl.classList.remove('streaming')
    postProcessMsg(msgEl)
  }
  // 对齐 cc 的 content-block 模型：每段 text block 到此收口。
  // 下一段 text_delta 必须新建 msg-group，不能回填旧组——否则 tool_use 之后的第二段正文
  // 会覆盖到第一段上面的旧气泡里，顺序和光标都会错位。
  currentMsgGroup = null
  streamBuffer = ''
}

// ==================== Tool rendering ====================

function getToolCategory(name) {
  if (/bash/i.test(name)) return 'terminal'
  if (/file|read|write|edit|glob|notebook/i.test(name)) return 'file'
  if (/grep|search|web/i.test(name)) return 'search'
  if (/agent/i.test(name)) return 'agent'
  return ''
}

function appendToolStart(toolName, toolCallId, args) {
  let container = messagesEl.querySelector('.tool-container:last-child')
  if (!container || container.dataset.done === '1') {
    container = document.createElement('div')
    container.className = 'tool-container'
    messagesEl.appendChild(container)
  }
  const cat = getToolCategory(toolName)

  // Agent tool → create agent container
  if (cat === 'agent') {
    createAgentContainer(toolName, toolCallId, args, container)
    return
  }

  const item = document.createElement('div')
  item.className = 'tool-item' + (cat ? ' ' + cat : '')
  item.id = 'tool-' + toolCallId

  let valueText = ''
  if (args && typeof args === 'object') {
    if (toolName === 'AskUserQuestion') {
      // Interactive card rendered below by showAskUserQuestionRequest already
      // shows the questions in a readable form — don't duplicate the raw JSON.
      valueText = ''
    } else if (args.command) valueText = '$ ' + args.command
    else if (args.file_path) valueText = args.file_path
    else if (args.pattern) valueText = args.pattern
    else { const v = JSON.stringify(args); valueText = v.length > 80 ? v.slice(0, 80) + '...' : v }
  }

  item.innerHTML = `<span class="tool-label">${escapeHtml(toolName)}</span><span class="tool-value${cat === 'terminal' ? ' terminal-cmd' : ''}">${escapeHtml(valueText)}</span><span class="tool-dot"></span>`
  container.appendChild(item)
  scrollToBottom()
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

function appendToolProgress(toolCallId, content) {
  const item = document.getElementById('tool-' + toolCallId)
  if (!item) return
  let progEl = item.querySelector('.tool-progress')
  if (!progEl) {
    progEl = document.createElement('div')
    progEl.className = 'tool-progress'
    item.appendChild(progEl)
  }
  let existing = progEl.textContent || ''
  let combined = existing + (content || '')
  if (combined.length > 500) combined = combined.slice(-500)
  progEl.textContent = combined
  scrollToBottom()
}

function updateToolEnd(toolCallId, isError) {
  const el = document.getElementById('tool-' + toolCallId)
  if (!el) return
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
}

// ==================== File card ====================

const FILE_EXT_LABELS = { pdf:'PDF',json:'JSON',zip:'ZIP',gz:'GZ',txt:'TXT',csv:'CSV',md:'MD',html:'HTML',png:'PNG',jpg:'JPG',jpeg:'JPG',gif:'GIF',webp:'WEBP',svg:'SVG',mp3:'MP3',wav:'WAV',mp4:'MP4',py:'PY',ts:'TS',js:'JS',sh:'SH' }

function appendFileCard(name, url) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  const label = FILE_EXT_LABELS[ext] || ext.toUpperCase() || 'FILE'
  const group = document.createElement('div')
  group.className = 'msg-group assistant'
  group.innerHTML = `<div class="msg-label">${tt('bot_name')}</div><div class="file-card"><div class="file-card-icon">${escapeHtml(label)}</div><div class="file-card-info"><div class="file-card-name">${escapeHtml(name)}</div><div class="file-card-hint">${tt('file_ready')}</div></div><a class="file-card-dl" href="${escapeHtml(url)}" download="${escapeHtml(name)}">${tt('download')}</a></div>`
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

// ==================== Permission ====================

function showPermissionRequest(req) {
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
    <div class="permission-header"><svg viewBox="0 0 16 16" width="16" height="16" fill="#eab308"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg><span class="permission-title">${escapeHtml(req.toolName)}</span></div>
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
  const resolution = input.__resolution || {}
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
  if (event.sessionId && event.sessionId !== currentSessionId) {
    if (event.type === 'done') {
      updateSessionInList()
      // Cron scheduler just finished a run in the background — pull fresh
      // runs for every expanded task so the new execution appears. (The
      // sessionId encoding doesn't uniquely identify the taskId because
      // taskIds may themselves contain hyphens.)
      if (isCronRunSession(event.sessionId)) {
        for (const tid of cronTaskExpanded) refreshCronRunsForTask(tid)
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
    case 'tool_end': updateToolEnd(event.toolCallId, event.isError); break
    case 'tool_input_delta': break // tool input streaming (optional)
    case 'progress': appendToolProgress(event.toolCallId, event.content); break
    case 'stream_mode':
      if (event.mode === 'requesting') thinkingUI.show() // 幂等，已有就是 no-op
      else if (event.mode === 'responding') thinkingUI.finalize()
      else if (event.mode === 'tool-use') finalizeStream()
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
      const card = document.getElementById('q-' + event.requestId)
      if (card) finalizeQuestionCard(card, 'skipped', null, [], [])
      break
    }
    case 'done':
      thinkingUI.finalize(); finalizeStream()
      busy = false
      btnSend.classList.remove('busy')
      btnSend.disabled = !inputEl.value.trim()
      inputEl.focus()
      updateSessionInList()
      // If the session that just finished is a cron run, flip its sidebar
      // status dot from running→success/failed. The "other session" branch
      // above handles this too, but that branch doesn't fire when the user
      // is actively viewing the run (currentSessionId matches).
      if (isCronRunSession(event.sessionId)) {
        for (const tid of cronTaskExpanded) refreshCronRunsForTask(tid)
      }
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
      if (typeof window.toggleSettings === 'function' && !settingsVisibleIfAny()) window.toggleSettings()
      if (typeof window.loadSettingsTab === 'function') window.loadSettingsTab('models')
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

boot()
