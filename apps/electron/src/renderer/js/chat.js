// Klaus Desktop — Chat UI
// Communicates with main process via window.klaus (preload bridge)

const klaus = window.klaus

// --- State ---
let currentSessionId = null
let sessions = [] // { id, title, createdAt, updatedAt }
let busy = false
let streamBuffer = ''
let currentAssistantEl = null
let currentThinkingEl = null
let currentToolId = null

// --- DOM refs ---
const messagesEl = document.getElementById('messages')
const welcomeEl = document.getElementById('welcome')
const inputEl = document.getElementById('input')
const btnSend = document.getElementById('btn-send')
const btnNewChat = document.getElementById('btn-new-chat')
const sessionListEl = document.getElementById('session-list')
const engineStatusEl = document.getElementById('engine-status')

// --- Markdown rendering ---
// Use marked.js if available, otherwise basic fallback
let renderMarkdown
if (typeof marked !== 'undefined') {
  marked.setOptions({ breaks: true, gfm: true })
  renderMarkdown = (text) => marked.parse(text)
} else {
  renderMarkdown = (text) => {
    // Basic markdown: code blocks, inline code, bold, italic, links
    let html = escapeHtml(text)
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="${lang}">${code}</code></pre>`)
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Line breaks
    html = html.replace(/\n/g, '<br>')
    return html
  }
}

// --- Init ---
async function init() {
  sessions = await klaus.session.list()
  renderSessionList()

  if (sessions.length > 0) {
    await switchSession(sessions[0].id)
  }
}

// --- Session management ---
function renderSessionList() {
  sessionListEl.innerHTML = ''

  // Group by date
  const today = new Date()
  const todayStr = today.toDateString()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toDateString()

  const groups = { today: [], yesterday: [], earlier: [] }

  for (const s of sessions) {
    const d = new Date(s.updatedAt || s.createdAt).toDateString()
    if (d === todayStr) groups.today.push(s)
    else if (d === yesterdayStr) groups.yesterday.push(s)
    else groups.earlier.push(s)
  }

  const addGroup = (label, items) => {
    if (items.length === 0) return
    const header = document.createElement('div')
    header.className = 'session-group-header'
    header.textContent = label
    header.style.cssText = 'padding:6px 12px;font-size:11px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.5px'
    sessionListEl.appendChild(header)

    for (const s of items) {
      const div = document.createElement('div')
      div.className = 'session-item' + (s.id === currentSessionId ? ' active' : '')
      div.textContent = s.title || 'New Chat'

      // Right-click to delete
      div.oncontextmenu = (e) => {
        e.preventDefault()
        if (confirm('Delete this conversation?')) {
          deleteSession(s.id)
        }
      }
      div.onclick = () => switchSession(s.id)
      sessionListEl.appendChild(div)
    }
  }

  addGroup('Today', groups.today)
  addGroup('Yesterday', groups.yesterday)
  addGroup('Earlier', groups.earlier)
}

async function switchSession(id) {
  currentSessionId = id
  renderSessionList()
  messagesEl.style.display = 'flex'
  messagesEl.style.flexDirection = 'column'
  welcomeEl.style.display = 'none'
  messagesEl.innerHTML = ''
  streamBuffer = ''
  currentAssistantEl = null
  currentThinkingEl = null

  // Load history
  const history = await klaus.session.history(id)
  for (const msg of history) {
    if (msg.role === 'user') {
      appendUserMsg(msg.text)
    } else {
      appendAssistantMsg(msg.text)
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
  if (currentSessionId === id) {
    if (sessions.length > 0) {
      await switchSession(sessions[0].id)
    } else {
      currentSessionId = null
      messagesEl.style.display = 'none'
      welcomeEl.style.display = 'flex'
    }
  }
  renderSessionList()
}

// --- Sending messages ---
async function send() {
  const text = inputEl.value.trim()
  if (!text || busy) return

  // Auto-create session if none
  if (!currentSessionId) {
    await newChat()
  }

  busy = true
  btnSend.disabled = true
  inputEl.value = ''
  autoResize()

  appendUserMsg(text)

  currentAssistantEl = null
  currentThinkingEl = null
  currentToolId = null
  streamBuffer = ''

  await klaus.chat.send(currentSessionId, text)
}

// --- Message rendering ---
function appendUserMsg(text) {
  const div = document.createElement('div')
  div.className = 'msg msg-user'
  div.textContent = text
  messagesEl.appendChild(div)
  scrollToBottom()
}

function appendAssistantMsg(text) {
  const div = document.createElement('div')
  div.className = 'msg msg-assistant'
  div.innerHTML = renderMarkdown(text)
  messagesEl.appendChild(div)
  scrollToBottom()
}

function ensureAssistantEl() {
  if (!currentAssistantEl) {
    currentAssistantEl = document.createElement('div')
    currentAssistantEl.className = 'msg msg-assistant'
    messagesEl.appendChild(currentAssistantEl)
  }
  return currentAssistantEl
}

function appendThinking(text) {
  if (!currentThinkingEl) {
    const details = document.createElement('details')
    details.className = 'msg-thinking'
    details.innerHTML = '<summary>Thinking...</summary><div class="thinking-content"></div>'
    ensureAssistantEl()
    currentAssistantEl.appendChild(details)
    currentThinkingEl = details.querySelector('.thinking-content')
  }
  currentThinkingEl.textContent += text
  scrollToBottom()
}

function appendText(text) {
  streamBuffer += text
  const el = ensureAssistantEl()

  // Remove previous streaming text
  el.querySelector('.response-text')?.remove()

  const textDiv = document.createElement('div')
  textDiv.className = 'response-text'
  textDiv.innerHTML = renderMarkdown(streamBuffer)
  el.appendChild(textDiv)
  scrollToBottom()
}

function appendToolStart(toolName, toolCallId, args) {
  currentToolId = toolCallId
  const div = document.createElement('div')
  div.className = 'msg-tool'
  div.id = 'tool-' + toolCallId

  let argsPreview = ''
  if (args && typeof args === 'object') {
    const entries = Object.entries(args)
    if (entries.length > 0) {
      argsPreview = entries.map(([k, v]) => {
        const val = typeof v === 'string' ? v : JSON.stringify(v)
        return `${escapeHtml(k)}: ${escapeHtml(val.length > 100 ? val.slice(0, 100) + '...' : val)}`
      }).join('\n')
    }
  }

  div.innerHTML = `
    <div class="tool-header">
      <span class="tool-name">${escapeHtml(toolName)}</span>
      <span class="tool-status"><span class="streaming-dot"></span></span>
    </div>
    ${argsPreview ? `<details class="tool-args-details"><summary>Arguments</summary><pre class="tool-args">${argsPreview}</pre></details>` : ''}
    <div class="tool-result" style="display:none"></div>`

  ensureAssistantEl()
  currentAssistantEl.appendChild(div)
  scrollToBottom()
}

function appendToolInput(toolCallId, delta) {
  const el = document.getElementById('tool-' + toolCallId)
  if (!el) return
  const argsEl = el.querySelector('.tool-args')
  if (argsEl) {
    argsEl.textContent += delta
  }
}

function updateToolEnd(toolCallId, isError) {
  const el = document.getElementById('tool-' + toolCallId)
  if (!el) return
  const statusEl = el.querySelector('.tool-status')
  if (statusEl) {
    statusEl.innerHTML = isError
      ? '<span style="color:#DC2626">Failed</span>'
      : '<span style="color:#16A34A">Done</span>'
  }
}

// --- Permission dialog ---
function showPermissionRequest(req) {
  const card = document.createElement('div')
  card.className = 'permission-card'
  card.id = 'perm-' + req.requestId

  const toolInputPreview = req.toolInput
    ? escapeHtml(JSON.stringify(req.toolInput, null, 2)).slice(0, 500)
    : ''

  let suggestionsHtml = ''
  if (req.suggestions && req.suggestions.length > 0) {
    suggestionsHtml = '<div class="perm-suggestions">' +
      req.suggestions.map((s, i) =>
        `<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-top:4px">
          <input type="checkbox" data-idx="${i}" class="perm-suggestion-cb">
          ${escapeHtml(s.label || 'Always allow')}
        </label>`
      ).join('') + '</div>'
  }

  card.innerHTML = `
    <div class="perm-title">Allow <strong>${escapeHtml(req.toolName)}</strong>?</div>
    <div style="font-size:13px;color:var(--text-secondary);margin:4px 0">${escapeHtml(req.message || '')}</div>
    ${toolInputPreview ? `<details style="margin:4px 0"><summary style="font-size:12px;color:var(--text-tertiary);cursor:pointer">Details</summary><pre style="font-size:11px;max-height:150px;overflow:auto;margin-top:4px">${toolInputPreview}</pre></details>` : ''}
    ${suggestionsHtml}
    <div class="perm-actions">
      <button class="btn-allow" onclick="handlePermission('${req.requestId}', 'allow')">Allow</button>
      <button class="btn-deny" onclick="handlePermission('${req.requestId}', 'deny')">Deny</button>
    </div>`

  messagesEl.appendChild(card)
  scrollToBottom()
}

window.handlePermission = function(requestId, decision) {
  const card = document.getElementById('perm-' + requestId)
  let acceptedIndices = []
  if (card && decision === 'allow') {
    card.querySelectorAll('.perm-suggestion-cb:checked').forEach(cb => {
      acceptedIndices.push(parseInt(cb.dataset.idx))
    })
  }

  klaus.permission.respond(requestId, decision, acceptedIndices.length > 0 ? acceptedIndices : undefined)

  if (card) {
    card.querySelector('.perm-actions').innerHTML =
      `<span style="font-size:12px;color:var(--text-tertiary)">${decision === 'allow' ? 'Allowed' : 'Denied'}</span>`
  }
}

// --- Event handlers ---
klaus.on.chatEvent((event) => {
  if (event.sessionId && event.sessionId !== currentSessionId) return

  switch (event.type) {
    case 'text_delta':
      appendText(event.text)
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
    case 'tool_input_delta':
      appendToolInput(event.toolCallId, event.delta)
      break
    case 'stream_mode':
      if (event.mode === 'requesting') {
        streamBuffer = ''
        currentAssistantEl = null
        currentThinkingEl = null
      } else if (event.mode === 'responding') {
        // Close thinking block if open
        if (currentThinkingEl) {
          currentThinkingEl = null
        }
      }
      break
    case 'api_error':
      appendError(event.error)
      break
    case 'api_retry':
      appendError(`Retrying (${event.attempt}/${event.maxRetries})...`)
      break
    case 'done':
      busy = false
      btnSend.disabled = !inputEl.value.trim()
      inputEl.focus()
      updateSessionInList()
      break
  }
})

klaus.on.permissionRequest((req) => {
  showPermissionRequest(req)
})

klaus.on.engineStatus((status) => {
  if (status.status === 'ready') {
    engineStatusEl.textContent = 'Ready'
    engineStatusEl.style.color = 'var(--text-tertiary)'
  } else if (status.status === 'error') {
    engineStatusEl.textContent = 'Error: ' + (status.error || 'unknown')
    engineStatusEl.style.color = '#DC2626'
  } else {
    engineStatusEl.textContent = 'Initializing...'
  }
})

function appendError(msg) {
  const div = document.createElement('div')
  div.className = 'msg msg-assistant'
  div.innerHTML = `<span style="color:#DC2626">${escapeHtml(msg)}</span>`
  messagesEl.appendChild(div)
  scrollToBottom()
}

async function updateSessionInList() {
  const updated = await klaus.session.list()
  sessions = updated
  renderSessionList()
}

// --- Utils ---
function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight
  })
}

function escapeHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function autoResize() {
  inputEl.style.height = 'auto'
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px'
}

// --- Key bindings ---
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
})

inputEl.addEventListener('input', () => {
  autoResize()
  btnSend.disabled = !inputEl.value.trim() || busy
})

btnSend.addEventListener('click', send)
btnNewChat.addEventListener('click', newChat)

// Settings button
document.getElementById('btn-settings')?.addEventListener('click', () => {
  toggleSettings()
})

// Tray events
klaus.on.trayNewChat?.(() => newChat())
klaus.on.trayOpenSettings?.(() => { if (!settingsVisible) toggleSettings() })

// File drag-drop
document.addEventListener('dragover', (e) => { e.preventDefault() })
document.addEventListener('drop', (e) => {
  e.preventDefault()
  if (!e.dataTransfer?.files?.length) return
  const files = [...e.dataTransfer.files]
  // TODO: upload files via IPC and attach to next message
  const names = files.map(f => f.name).join(', ')
  inputEl.value += `[Files: ${names}]`
  autoResize()
  btnSend.disabled = false
})

// Image paste
inputEl.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) {
        inputEl.value += `[Pasted image: ${file.name || 'clipboard.png'}]`
        autoResize()
        btnSend.disabled = false
      }
      break
    }
  }
})

// --- Boot ---
init()
