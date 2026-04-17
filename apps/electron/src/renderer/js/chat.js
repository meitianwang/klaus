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
    this.startTime = Date.now()
    const el = document.createElement('div')
    el.className = 'thinking-indicator'
    el.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div><span class="thinking-label">Thinking</span>`
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
let sidebarCollapsed = localStorage.getItem('klaus_sidebar_collapsed') === '1'
let userMenuOpen = false

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
  renderSessionList()
  updateWelcomeGreeting()
  refreshAuthPill()
  if (sessions.length > 0) await switchSession(sessions[0].id)
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
        pill.innerHTML = `<span class="dot"></span><span class="mode-label">Claude 订阅</span><span class="mode-detail">· ${escapeHtml(status.account || '已登录')}</span>`
      } else {
        pill.className = 'auth-mode-pill warning'
        pill.innerHTML = `<span class="dot"></span><span class="mode-label">Claude 订阅</span><span class="mode-detail">· 未登录</span>`
      }
    } else {
      const models = await klausApi.settings.models.list()
      const def = models.find(m => m.isDefault) || models[0]
      if (def) {
        pill.className = 'auth-mode-pill'
        pill.innerHTML = `<span class="dot"></span><span class="mode-label">自定义</span><span class="mode-detail">· ${escapeHtml(def.name || def.model)}</span>`
      } else {
        pill.className = 'auth-mode-pill warning'
        pill.innerHTML = `<span class="dot"></span><span class="mode-label">自定义</span><span class="mode-detail">· 未配置</span>`
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

function renderSessionList() {
  sessionListEl.innerHTML = ''
  for (const s of sessions) {
    const div = document.createElement('div')
    div.className = 'session-item' + (s.id === currentSessionId ? ' active' : '')
    div.innerHTML = `<div class="s-title">${escapeHtml(s.title || 'New Chat')}</div><button class="s-del" title="Delete">&times;</button>`
    div.querySelector('.s-title').onclick = () => switchSession(s.id)
    div.querySelector('.s-del').onclick = (e) => { e.stopPropagation(); deleteSession(s.id) }
    sessionListEl.appendChild(div)
  }
}

async function switchSession(id) {
  // Save current session's DOM
  if (currentSessionId && messagesEl.childNodes.length) {
    const frag = document.createDocumentFragment()
    while (messagesEl.firstChild) frag.appendChild(messagesEl.firstChild)
    sessionDom.set(currentSessionId, frag)
  }

  currentSessionId = id
  renderSessionList()
  messagesEl.style.display = 'block'
  welcomeEl.style.display = 'none'
  messagesEl.innerHTML = ''
  resetStreamState()

  // Restore from DOM cache if available
  const cached = sessionDom.get(id)
  if (cached) {
    messagesEl.appendChild(cached)
    sessionDom.delete(id)
  } else {
    const history = await klausApi.session.history(id)
    for (const msg of history) {
      if (msg.role === 'user') appendUserMsg(msg.text)
      else appendFinalAssistantMsg(msg.text)
    }
  }
  scrollToBottom()
}

async function newChat() {
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
  if (currentSessionId === id) {
    if (sessions.length > 0) await switchSession(sessions[0].id)
    else { currentSessionId = null; messagesEl.style.display = 'none'; welcomeEl.style.display = 'flex' }
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
  appendUserMsg(displayText)
  resetStreamState()
  thinkingUI.show() // 立即显示"三个点在转"，覆盖 requesting 到 thinking 开始之间的空白期
  await klausApi.chat.send(currentSessionId, finalText, media.length > 0 ? media : undefined)
}

window.sendQuickPrompt = (topic) => { inputEl.value = topic + ': '; inputEl.focus() }

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
    { name: 'new', description: 'Start a new chat' },
    { name: 'clear', description: 'Clear current session' },
    { name: 'help', description: 'Show available commands' },
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
    if (args.command) valueText = '$ ' + args.command
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
    sec.textContent = isError ? 'failed' : 'completed'
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
  group.innerHTML = `<div class="msg-label">${tt('bot_name')}</div><div class="file-card"><div class="file-card-icon">${escapeHtml(label)}</div><div class="file-card-info"><div class="file-card-name">${escapeHtml(name)}</div><div class="file-card-hint">File ready</div></div><a class="file-card-dl" href="${escapeHtml(url)}" download="${escapeHtml(name)}">${tt('download')}</a></div>`
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
  if (title) title.textContent = agentPanel.team ? agentPanel.team.name : (tt('agents') || 'Agents')
  if (count) count.textContent = runningCount > 0 ? runningCount + ' running' : agentPanel.agents.size + ' agent(s)'
  if (!body) return
  body.innerHTML = ''
  agentPanel.agents.forEach((agent, id) => {
    const row = document.createElement('div')
    row.className = 'agent-row'
    const color = AGENT_COLOR_MAP[agent.color] || AGENT_COLOR_MAP.blue
    row.innerHTML = `<span class="agent-dot${agent.status === 'running' ? ' running' : ''}" style="background:${color};border-color:${color}"></span><span class="agent-name">${escapeHtml(agent.name)}</span><span class="agent-status">${agent.status === 'running' ? 'running · ' + agent.toolUseCount + ' tool call' + (agent.toolUseCount === 1 ? '' : 's') : agent.status}</span>`
    body.appendChild(row)
  })
}

// ==================== Permission ====================

function showPermissionRequest(req) {
  const card = document.createElement('div')
  card.className = 'permission-card'
  card.id = 'perm-' + req.requestId
  const inputPreview = req.toolInput ? JSON.stringify(req.toolInput, null, 2) : ''
  let suggestionsHtml = ''
  if (req.suggestions?.length) {
    suggestionsHtml = '<div class="permission-suggestions">' +
      req.suggestions.map((s, i) => `<label class="permission-suggestion"><input type="checkbox" data-sug-idx="${i}"> ${escapeHtml(s.label || 'Always allow')}</label>`).join('') + '</div>'
  }
  card.innerHTML = `
    <div class="permission-header"><svg viewBox="0 0 16 16" width="16" height="16" fill="#eab308"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg><span class="permission-title">${escapeHtml(req.toolName)}</span></div>
    <div class="permission-message">${escapeHtml(req.message || 'This tool requires your approval.')}</div>
    ${inputPreview ? `<details class="permission-input-details"><summary>Show input</summary><pre class="permission-input-preview">${escapeHtml(inputPreview).slice(0, 500)}</pre></details>` : ''}
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
    card.querySelector('.permission-actions').innerHTML = `<div class="permission-result ${decision === 'allow' ? 'permission-allowed' : 'permission-denied'}">${decision === 'allow' ? (tt('allowed')) : (tt('denied'))}${indices.length ? ' (rules saved)' : ''}</div>`
    card.querySelector('.permission-timer').remove()
    card.classList.add('permission-resolved')
  }
}

// ==================== Events ====================

klausApi.on.chatEvent((event) => {
  if (event.sessionId && event.sessionId !== currentSessionId) return

  switch (event.type) {
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
      if (el) { el.style.display = ''; el.textContent = `${event.collapsedSpans} collapsed · ${event.stagedSpans} staged` }
      break
    }
    case 'api_error': appendError(event.error); break
    case 'api_retry': appendError(`Retrying (${event.attempt}/${event.maxRetries})...`); break
    case 'auth_required': appendAuthRequired(event.reason, event.mode); break
    // Agent events
    case 'team_created': agentPanel.team = { name: event.teamName }; renderAgentPanel(); break
    case 'teammate_spawned': agentPanel.agents.set(event.agentId, { name: event.name, color: event.color || 'blue', status: 'idle', toolUseCount: 0 }); renderAgentPanel(); break
    case 'agent_progress': { const ag = agentPanel.agents.get(event.agentId); if (ag) { ag.status = 'running'; ag.toolUseCount = event.toolUseCount }; renderAgentPanel(); break }
    case 'agent_done': { const ag2 = agentPanel.agents.get(event.agentId); if (ag2) ag2.status = event.status || 'completed'; renderAgentPanel(); setTimeout(() => { agentPanel.agents.delete(event.agentId); renderAgentPanel() }, 5000); break }
    // File
    case 'file': if (event.name && event.url) appendFileCard(event.name, event.url); break
    // MCP OAuth
    case 'mcp_auth_url': if (event.url) { window.open(event.url, '_blank'); appendSystemMsg('MCP authorization opened in browser for ' + (event.serverName || 'server')) }; break
    case 'done':
      thinkingUI.finalize(); finalizeStream()
      busy = false
      btnSend.classList.remove('busy')
      btnSend.disabled = !inputEl.value.trim()
      inputEl.focus()
      updateSessionInList(); break
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
  const title = isSubscription ? '请先登录 Claude 订阅' : '请先配置自定义模型'
  const hint = isSubscription
    ? '使用你的 Claude Pro / Max 订阅聊天，点击下方登录按钮会打开浏览器完成授权。'
    : '自定义模式需要先在设置中添加一个含 API Key 的模型。'
  const primaryLabel = isSubscription ? '登录 Claude 账号' : '去配置模型'
  const secondaryLabel = isSubscription ? '或切换到自定义模型' : '或切换到 Claude 订阅'

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
      primaryBtn.textContent = '正在打开浏览器…'
      if (statusEl) statusEl.textContent = '请在浏览器中完成授权，完成后这里会自动继续'
      try {
        const res = await window.klaus.auth.login()
        if (res?.ok) {
          primaryBtn.textContent = '✓ 登录成功'
          if (statusEl) statusEl.textContent = '已登录，请重新发送你的消息'
        } else {
          primaryBtn.disabled = false
          primaryBtn.textContent = '重试登录'
          if (statusEl) statusEl.textContent = '登录失败：' + (res?.error || '未知错误')
        }
      } catch (err) {
        primaryBtn.disabled = false
        primaryBtn.textContent = '重试登录'
        if (statusEl) statusEl.textContent = '登录失败：' + (err?.message || String(err))
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
      if (statusEl) statusEl.textContent = `已切换到${newMode === 'subscription' ? 'Claude 订阅' : '自定义模型'}模式，请重新发送你的消息`
      primaryBtn.disabled = true
    } catch (err) {
      if (statusEl) statusEl.textContent = '切换失败：' + (err?.message || String(err))
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

inputEl.addEventListener('input', () => { autoResize(); updateSendBtn(); handleSlashMenu() })
btnSend.addEventListener('click', () => {
  if (busy) {
    // 中断当前响应
    if (currentSessionId) klausApi.chat.interrupt(currentSessionId).catch(() => {})
  } else {
    send()
  }
})
btnNewChat.addEventListener('click', newChat)

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
document.getElementById('menu-logout')?.addEventListener('click', () => {
  closeUserMenu()
  window.close()
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
    if (f.size > 10 * 1024 * 1024) { appendError('File too large (max 10MB): ' + f.name); continue }
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
    appendError('Upload failed: ' + entry.file.name)
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
      item.innerHTML = `<div class="file-info">${entry.uploading ? 'uploading... ' : ''}${escapeHtml(entry.file.name)}</div><button class="remove">&times;</button>`
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

// --- Boot ---
init()
