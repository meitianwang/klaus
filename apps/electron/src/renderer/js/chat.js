// Klaus Desktop — Chat UI (fully aligned with Web端)

const klaus = window.klaus

// --- State ---
let currentSessionId = null
let sessions = []
let busy = false
let streamBuffer = ''
let currentMsgGroup = null
let currentThinkingEl = null
let thinkingStartTime = 0
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

  sessions = await klaus.session.list()
  renderSessionList()
  updateWelcomeGreeting()
  if (sessions.length > 0) await switchSession(sessions[0].id)
}

function updateWelcomeGreeting() {
  const h = new Date().getHours()
  const el = document.getElementById('welcome-greeting')
  if (el) el.textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
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
    const history = await klaus.session.history(id)
    for (const msg of history) {
      if (msg.role === 'user') appendUserMsg(msg.text)
      else appendFinalAssistantMsg(msg.text)
    }
  }
  scrollToBottom()
}

async function newChat() {
  const info = await klaus.session.new()
  sessions.unshift(info)
  await switchSession(info.id)
  renderSessionList()
  inputEl.focus()
}

async function deleteSession(id) {
  await klaus.session.delete(id)
  sessions = sessions.filter(s => s.id !== id)
  sessionDom.delete(id)
  if (currentSessionId === id) {
    if (sessions.length > 0) await switchSession(sessions[0].id)
    else { currentSessionId = null; messagesEl.style.display = 'none'; welcomeEl.style.display = 'flex' }
  }
  renderSessionList()
}

function resetStreamState() {
  streamBuffer = ''; currentMsgGroup = null; currentThinkingEl = null; thinkingStartTime = 0
  agentPanel = { team: null, agents: new Map() }
  if (agentPanelEl) agentPanelEl.style.display = 'none'
}

// ==================== Send ====================

async function send() {
  const text = inputEl.value.trim()
  if (!text && pendingFiles.length === 0) return
  if (busy) return
  if (!currentSessionId) await newChat()
  busy = true; btnSend.disabled = true
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
  await klaus.chat.send(currentSessionId, finalText, media.length > 0 ? media : undefined)
}

window.sendQuickPrompt = (topic) => { inputEl.value = topic + ': '; inputEl.focus() }

// ==================== Slash command menu ====================

async function fetchSkills() {
  if (slashSkillsCache) return slashSkillsCache
  try {
    const skills = await klaus.skills.list()
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
  group.innerHTML = '<div class="msg-label">Klaus</div>'
  group.appendChild(msgEl)
  postProcessMsg(msgEl)
  messagesEl.appendChild(group)
}

function ensureAssistantGroup() {
  if (!currentMsgGroup) {
    currentMsgGroup = document.createElement('div')
    currentMsgGroup.className = 'msg-group assistant'
    currentMsgGroup.innerHTML = '<div class="msg-label">Klaus</div>'
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
    btn.textContent = 'Copy'
    btn.onclick = () => {
      navigator.clipboard.writeText(block.textContent).then(() => {
        btn.textContent = 'Copied!'
        setTimeout(() => { btn.textContent = 'Copy' }, 2000)
      }).catch(() => { btn.textContent = 'Failed'; setTimeout(() => { btn.textContent = 'Copy' }, 2000) })
    }
    wrapper.appendChild(btn)
  })
}

// --- Thinking ---
function showThinkingIndicator() {
  thinkingStartTime = Date.now()
  currentThinkingEl = document.createElement('div')
  currentThinkingEl.className = 'thinking-indicator'
  currentThinkingEl.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div><span class="thinking-label">Thinking</span>`
  const content = document.createElement('div')
  content.className = 'thinking-content'
  currentThinkingEl.appendChild(content)
  messagesEl.appendChild(currentThinkingEl)
  scrollToBottom()
}

function appendThinking(text) {
  if (!currentThinkingEl) showThinkingIndicator()
  const content = currentThinkingEl.querySelector('.thinking-content')
  if (content) content.textContent += text
  scrollToBottom()
}

function finalizeThinking() {
  if (!currentThinkingEl) return
  const content = currentThinkingEl.querySelector('.thinking-content')?.textContent || ''
  const elapsed = Math.round((Date.now() - thinkingStartTime) / 1000)
  const done = document.createElement('div')
  done.className = 'thinking-done'
  done.innerHTML = `<div class="thinking-toggle"><span>Thought for ${elapsed}s</span><svg class="thinking-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l3 3 3-3"/></svg></div><div class="thinking-detail">${escapeHtml(content)}</div>`
  done.querySelector('.thinking-toggle').onclick = () => done.classList.toggle('open')
  currentThinkingEl.replaceWith(done)
  currentThinkingEl = null
}

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
  group.innerHTML = `<div class="msg-label">Klaus</div><div class="file-card"><div class="file-card-icon">${escapeHtml(label)}</div><div class="file-card-info"><div class="file-card-name">${escapeHtml(name)}</div><div class="file-card-hint">File ready</div></div><a class="file-card-dl" href="${escapeHtml(url)}" download="${escapeHtml(name)}">Download</a></div>`
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
  if (title) title.textContent = agentPanel.team ? agentPanel.team.name : 'Agents'
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
    <div class="permission-actions"><button class="permission-btn permission-btn-allow" onclick="handlePermission('${req.requestId}','allow')">Allow</button><button class="permission-btn permission-btn-deny" onclick="handlePermission('${req.requestId}','deny')">Deny</button></div>
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
  klaus.permission.respond(requestId, decision, indices.length > 0 ? indices : undefined)
  if (card) {
    card.querySelector('.permission-actions').innerHTML = `<div class="permission-result ${decision === 'allow' ? 'permission-allowed' : 'permission-denied'}">${decision === 'allow' ? 'Allowed' : 'Denied'}${indices.length ? ' (rules saved)' : ''}</div>`
    card.querySelector('.permission-timer').remove()
    card.classList.add('permission-resolved')
  }
}

// ==================== Events ====================

klaus.on.chatEvent((event) => {
  if (event.sessionId && event.sessionId !== currentSessionId) return

  switch (event.type) {
    case 'text_delta': appendStreamText(event.text); break
    case 'thinking_delta': appendThinking(event.thinking); break
    case 'tool_start': appendToolStart(event.toolName, event.toolCallId, event.args); break
    case 'tool_end': updateToolEnd(event.toolCallId, event.isError); break
    case 'tool_input_delta': break // tool input streaming (optional)
    case 'progress': appendToolProgress(event.toolCallId, event.content); break
    case 'stream_mode':
      if (event.mode === 'requesting') resetStreamState()
      else if (event.mode === 'responding') finalizeThinking()
      else if (event.mode === 'tool-use') finalizeStream()
      break
    case 'context_collapse_stats': {
      const el = document.getElementById('collapse-stats')
      if (el) { el.style.display = ''; el.textContent = `${event.collapsedSpans} collapsed · ${event.stagedSpans} staged` }
      break
    }
    case 'api_error': appendError(event.error); break
    case 'api_retry': appendError(`Retrying (${event.attempt}/${event.maxRetries})...`); break
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
      finalizeThinking(); finalizeStream()
      busy = false; btnSend.disabled = !inputEl.value.trim(); inputEl.focus()
      updateSessionInList(); break
  }
})

klaus.on.permissionRequest(showPermissionRequest)

klaus.on.engineStatus((s) => {
  statusEl.className = ''
  if (s.status === 'ready') { statusEl.textContent = 'Connected' }
  else if (s.status === 'error') { statusEl.textContent = 'Error'; statusEl.className = 'error' }
  else { statusEl.textContent = 'Initializing...'; statusEl.className = 'init' }
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

async function updateSessionInList() { sessions = await klaus.session.list(); renderSessionList() }

// ==================== Utils ====================

function scrollToBottom() { requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight }) }
function escapeHtml(str) { return str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '' }
function autoResize() { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px' }
function updateSendBtn() { btnSend.disabled = !inputEl.value.trim() || busy }

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
btnSend.addEventListener('click', send)
btnNewChat.addEventListener('click', newChat)

// Sidebar toggle
document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed
  document.getElementById('sidebar')?.classList.toggle('collapsed', sidebarCollapsed)
  localStorage.setItem('klaus_sidebar_collapsed', sidebarCollapsed ? '1' : '0')
})

// User menu
document.getElementById('sidebar-user')?.addEventListener('click', (e) => {
  e.stopPropagation()
  userMenuOpen = !userMenuOpen
  document.getElementById('user-menu')?.classList.toggle('open', userMenuOpen)
})
document.addEventListener('click', () => {
  if (userMenuOpen) { userMenuOpen = false; document.getElementById('user-menu')?.classList.remove('open') }
})
document.getElementById('menu-settings')?.addEventListener('click', () => {
  userMenuOpen = false; document.getElementById('user-menu')?.classList.remove('open')
  toggleSettings()
})
document.getElementById('menu-help')?.addEventListener('click', () => {
  userMenuOpen = false; document.getElementById('user-menu')?.classList.remove('open')
  window.open('https://github.com/anthropics/claude-code/issues', '_blank')
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
    const result = await klaus.chat.uploadFile(entry.file.name, entry.file.type, buffer)
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
klaus.on.trayNewChat?.(() => newChat())
klaus.on.trayOpenSettings?.(() => { if (!document.getElementById('settings-view').classList.contains('active')) toggleSettings() })

// --- Boot ---
init()
