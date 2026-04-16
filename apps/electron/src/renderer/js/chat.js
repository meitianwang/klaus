// Klaus Desktop — Chat UI (aligned with Web端 design)

const klaus = window.klaus

// --- State ---
let currentSessionId = null
let sessions = []
let busy = false
let streamBuffer = ''
let currentMsgGroup = null
let currentThinkingEl = null
let thinkingStartTime = 0

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

// --- Markdown ---
let renderMarkdown
if (typeof marked !== 'undefined') {
  marked.setOptions({ breaks: true, gfm: true })
  renderMarkdown = (text) => marked.parse(text)
} else {
  renderMarkdown = (text) => {
    let html = escapeHtml(text)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="${lang}">${code}</code></pre>`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
    html = html.replace(/\n/g, '<br>')
    return html
  }
}

// --- Init ---
async function init() {
  sessions = await klaus.session.list()
  renderSessionList()
  updateWelcomeGreeting()
  if (sessions.length > 0) {
    await switchSession(sessions[0].id)
  }
}

function updateWelcomeGreeting() {
  const h = new Date().getHours()
  const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  const el = document.getElementById('welcome-greeting')
  if (el) el.textContent = greeting
}

// --- Sessions ---
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
  currentSessionId = id
  renderSessionList()
  messagesEl.style.display = 'block'
  welcomeEl.style.display = 'none'
  messagesEl.innerHTML = ''
  streamBuffer = ''
  currentMsgGroup = null
  currentThinkingEl = null

  const history = await klaus.session.history(id)
  for (const msg of history) {
    if (msg.role === 'user') appendUserMsg(msg.text)
    else appendFinalAssistantMsg(msg.text)
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
  if (currentSessionId === id) {
    if (sessions.length > 0) await switchSession(sessions[0].id)
    else { currentSessionId = null; messagesEl.style.display = 'none'; welcomeEl.style.display = 'flex' }
  }
  renderSessionList()
}

// --- Send ---
async function send() {
  const text = inputEl.value.trim()
  if (!text || busy) return
  if (!currentSessionId) await newChat()

  busy = true
  btnSend.disabled = true
  inputEl.value = ''
  autoResize()

  appendUserMsg(text)
  streamBuffer = ''
  currentMsgGroup = null
  currentThinkingEl = null

  await klaus.chat.send(currentSessionId, text)
}

window.sendQuickPrompt = async function(topic) {
  inputEl.value = topic + ': '
  inputEl.focus()
}

// --- Message rendering (aligned with Web端) ---
function appendUserMsg(text) {
  const group = document.createElement('div')
  group.className = 'msg-group user'
  group.innerHTML = `<div class="msg user">${escapeHtml(text)}</div>`
  messagesEl.appendChild(group)
  scrollToBottom()
}

function appendFinalAssistantMsg(text) {
  const group = document.createElement('div')
  group.className = 'msg-group assistant'
  group.innerHTML = `<div class="msg-label">Klaus</div><div class="msg assistant">${renderMarkdown(text)}</div>`
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

function showThinkingIndicator() {
  thinkingStartTime = Date.now()
  currentThinkingEl = document.createElement('div')
  currentThinkingEl.className = 'thinking-indicator'
  currentThinkingEl.innerHTML = `
    <div class="thinking-dots"><span></span><span></span><span></span></div>
    <span class="thinking-label">Thinking</span>`
  const thinkingContent = document.createElement('div')
  thinkingContent.className = 'thinking-content'
  currentThinkingEl.appendChild(thinkingContent)
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

  // Replace indicator with collapsible done block
  const done = document.createElement('div')
  done.className = 'thinking-done'
  done.innerHTML = `
    <div class="thinking-toggle">
      <span>Thought for ${elapsed}s</span>
      <svg class="thinking-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5l3 3 3-3"/></svg>
    </div>
    <div class="thinking-detail">${escapeHtml(content)}</div>`
  done.querySelector('.thinking-toggle').onclick = () => done.classList.toggle('open')
  currentThinkingEl.replaceWith(done)
  currentThinkingEl = null
}

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
  const group = currentMsgGroup
  if (group) {
    const msgEl = group.querySelector('.msg.assistant.streaming')
    if (msgEl) msgEl.classList.remove('streaming')
  }
}

// --- Tool rendering ---
function getToolCategory(name) {
  if (/bash/i.test(name)) return 'terminal'
  if (/file|read|write|edit|glob|notebook/i.test(name)) return 'file'
  if (/grep|search|web/i.test(name)) return 'search'
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

  item.innerHTML = `
    <span class="tool-label">${escapeHtml(toolName)}</span>
    <span class="tool-value${cat === 'terminal' ? ' terminal-cmd' : ''}">${escapeHtml(valueText)}</span>
    <span class="tool-dot"></span>`
  container.appendChild(item)
  scrollToBottom()
}

function updateToolEnd(toolCallId, isError) {
  const el = document.getElementById('tool-' + toolCallId)
  if (!el) return
  el.classList.add(isError ? 'error' : 'done')
  const dot = el.querySelector('.tool-dot')
  if (dot) dot.remove()
  const secondary = document.createElement('span')
  secondary.className = 'tool-secondary'
  secondary.textContent = isError ? 'failed' : 'completed'
  el.appendChild(secondary)
}

// --- Permission ---
function showPermissionRequest(req) {
  const card = document.createElement('div')
  card.className = 'permission-card'
  card.id = 'perm-' + req.requestId

  const inputPreview = req.toolInput ? JSON.stringify(req.toolInput, null, 2) : ''
  let suggestionsHtml = ''
  if (req.suggestions?.length) {
    suggestionsHtml = '<div class="permission-suggestions">' +
      req.suggestions.map((s, i) =>
        `<label class="permission-suggestion"><input type="checkbox" data-sug-idx="${i}"> ${escapeHtml(s.label || 'Always allow')}</label>`
      ).join('') + '</div>'
  }

  card.innerHTML = `
    <div class="permission-header">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>
      <span class="permission-title">${escapeHtml(req.toolName)}</span>
    </div>
    <div class="permission-message">${escapeHtml(req.message || 'This tool requires your approval.')}</div>
    ${inputPreview ? `<details class="permission-input-details"><summary>Show input</summary><pre class="permission-input-preview">${escapeHtml(inputPreview).slice(0, 500)}</pre></details>` : ''}
    ${suggestionsHtml}
    <div class="permission-actions">
      <button class="permission-btn permission-btn-allow" onclick="handlePermission('${req.requestId}', 'allow')">Allow</button>
      <button class="permission-btn permission-btn-deny" onclick="handlePermission('${req.requestId}', 'deny')">Deny</button>
    </div>`
  messagesEl.appendChild(card)
  scrollToBottom()
}

window.handlePermission = function(requestId, decision) {
  const card = document.getElementById('perm-' + requestId)
  let indices = []
  if (card && decision === 'allow') {
    card.querySelectorAll('input[data-sug-idx]:checked').forEach(cb => indices.push(parseInt(cb.dataset.sugIdx)))
  }
  klaus.permission.respond(requestId, decision, indices.length > 0 ? indices : undefined)
  if (card) {
    card.querySelector('.permission-actions').innerHTML =
      `<div class="permission-result ${decision === 'allow' ? 'permission-allowed' : 'permission-denied'}">${decision === 'allow' ? 'Allowed' : 'Denied'}</div>`
    card.classList.add('permission-resolved')
  }
}

// --- Events ---
klaus.on.chatEvent((event) => {
  if (event.sessionId && event.sessionId !== currentSessionId) return

  switch (event.type) {
    case 'text_delta':
      appendStreamText(event.text)
      break
    case 'thinking_delta':
      appendThinking(event.thinking)
      break
    case 'tool_start':
      appendToolStart(event.toolName, event.toolCallId, event.args)
      break
    case 'tool_end':
      updateToolEnd(event.toolCallId, event.isError)
      break
    case 'stream_mode':
      if (event.mode === 'requesting') {
        streamBuffer = ''
        currentMsgGroup = null
        currentThinkingEl = null
      } else if (event.mode === 'responding') {
        finalizeThinking()
      } else if (event.mode === 'tool-use') {
        finalizeStream()
      }
      break
    case 'api_error':
      appendError(event.error)
      break
    case 'api_retry':
      appendError(`Retrying (${event.attempt}/${event.maxRetries})...`)
      break
    case 'done':
      finalizeThinking()
      finalizeStream()
      busy = false
      btnSend.disabled = !inputEl.value.trim()
      inputEl.focus()
      updateSessionInList()
      break
  }
})

klaus.on.permissionRequest(showPermissionRequest)

klaus.on.engineStatus((s) => {
  statusEl.className = ''
  if (s.status === 'ready') { statusEl.textContent = 'Connected'; statusEl.className = ''; }
  else if (s.status === 'error') { statusEl.textContent = 'Error'; statusEl.className = 'error'; }
  else { statusEl.textContent = 'Initializing...'; statusEl.className = 'init'; }
})

function appendError(msg) {
  const group = document.createElement('div')
  group.className = 'msg-group assistant'
  group.innerHTML = `<div class="msg error">${escapeHtml(msg)}</div>`
  messagesEl.appendChild(group)
  scrollToBottom()
}

async function updateSessionInList() {
  sessions = await klaus.session.list()
  renderSessionList()
}

// --- Utils ---
function scrollToBottom() { requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight }) }
function escapeHtml(str) { return str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '' }
function autoResize() { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px' }

// --- Input events ---
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })
inputEl.addEventListener('input', () => { autoResize(); btnSend.disabled = !inputEl.value.trim() || busy })
btnSend.addEventListener('click', send)
btnNewChat.addEventListener('click', newChat)

// Settings
document.getElementById('sidebar-user')?.addEventListener('click', () => toggleSettings())
document.getElementById('settings-back')?.addEventListener('click', () => toggleSettings())

// Settings nav
document.querySelectorAll('.settings-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    loadSettingsTab(btn.dataset.stab)
  })
})

// File attach
btnAttach.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) {
    inputEl.value += `[Files: ${[...fileInput.files].map(f => f.name).join(', ')}]`
    autoResize(); btnSend.disabled = false
  }
})

// Drag-drop
document.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay.classList.add('active') })
document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) dropOverlay.classList.remove('active') })
document.addEventListener('drop', (e) => {
  e.preventDefault(); dropOverlay.classList.remove('active')
  if (e.dataTransfer?.files?.length) {
    inputEl.value += `[Files: ${[...e.dataTransfer.files].map(f => f.name).join(', ')}]`
    autoResize(); btnSend.disabled = false
  }
})

// Image paste
inputEl.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      inputEl.value += '[Pasted image]'
      autoResize(); btnSend.disabled = false; break
    }
  }
})

// Tray events
klaus.on.trayNewChat?.(() => newChat())
klaus.on.trayOpenSettings?.(() => { if (!document.getElementById('settings-view').classList.contains('active')) toggleSettings() })

// --- Boot ---
init()
