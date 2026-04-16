// Klaus Desktop — Settings Panel
// Tabs: Models, Prompts, MCP, Preferences

const settingsApi = window.klaus.settings

let settingsVisible = false
let currentSettingsTab = 'models'

function toggleSettings() {
  settingsVisible = !settingsVisible
  const panel = document.getElementById('settings-panel')
  const main = document.getElementById('main')
  if (settingsVisible) {
    panel.style.display = 'flex'
    main.querySelector('#messages').style.display = 'none'
    main.querySelector('#welcome').style.display = 'none'
    main.querySelector('#input-area').style.display = 'none'
    loadSettingsTab(currentSettingsTab)
  } else {
    panel.style.display = 'none'
    main.querySelector('#messages').style.display = currentSessionId ? 'flex' : 'none'
    main.querySelector('#welcome').style.display = currentSessionId ? 'none' : 'flex'
    main.querySelector('#input-area').style.display = 'flex'
  }
}

function loadSettingsTab(tab) {
  currentSettingsTab = tab
  // Update tab buttons
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab)
  })
  const content = document.getElementById('settings-content')
  switch (tab) {
    case 'models': loadModelsTab(content); break
    case 'prompts': loadPromptsTab(content); break
    case 'mcp': loadMcpTab(content); break
    case 'preferences': loadPreferencesTab(content); break
  }
}

// --- Models Tab ---
async function loadModelsTab(container) {
  const models = await settingsApi.models.list()
  container.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-header">
        <h3>Models</h3>
        <button class="btn-sm" onclick="showAddModelForm()">+ Add Model</button>
      </div>
      <div id="models-list">
        ${models.length === 0 ? '<p class="empty-text">No models configured</p>' : ''}
        ${models.map(m => `
          <div class="settings-card ${m.isDefault ? 'card-default' : ''}" data-model-id="${esc(m.id)}">
            <div class="card-header">
              <strong>${esc(m.name)}</strong>
              ${m.isDefault ? '<span class="badge">Default</span>' : ''}
              ${m.role ? `<span class="badge badge-role">${esc(m.role)}</span>` : ''}
            </div>
            <div class="card-meta">
              ${esc(m.provider || 'anthropic')} / ${esc(m.model)}
              &middot; ${m.maxContextTokens.toLocaleString()} tokens
              &middot; thinking: ${esc(m.thinking)}
            </div>
            <div class="card-actions">
              ${!m.isDefault ? `<button class="btn-xs" onclick="setDefaultModel('${esc(m.id)}')">Set Default</button>` : ''}
              <button class="btn-xs btn-danger" onclick="deleteModel('${esc(m.id)}')">Delete</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div id="model-form" style="display:none"></div>
    </div>`
}

function showAddModelForm() {
  const form = document.getElementById('model-form')
  form.style.display = 'block'
  form.innerHTML = `
    <div class="settings-card card-form">
      <h4>Add Model</h4>
      <div class="form-row">
        <label>Name</label>
        <input id="mf-name" placeholder="My Claude Model">
      </div>
      <div class="form-row">
        <label>Model ID</label>
        <input id="mf-model" placeholder="claude-sonnet-4-20250514">
      </div>
      <div class="form-row">
        <label>API Key</label>
        <input id="mf-apikey" type="password" placeholder="sk-ant-...">
      </div>
      <div class="form-row">
        <label>Provider</label>
        <select id="mf-provider">
          <option value="anthropic">Anthropic</option>
          <option value="bedrock">AWS Bedrock</option>
          <option value="vertex">Google Vertex</option>
        </select>
      </div>
      <div class="form-row">
        <label>Base URL (optional)</label>
        <input id="mf-baseurl" placeholder="https://api.anthropic.com">
      </div>
      <div class="form-row">
        <label>Max Context Tokens</label>
        <input id="mf-tokens" type="number" value="200000">
      </div>
      <div class="form-row">
        <label>Thinking</label>
        <select id="mf-thinking">
          <option value="off">Off</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn-sm btn-primary" onclick="saveModel()">Save</button>
        <button class="btn-sm" onclick="document.getElementById('model-form').style.display='none'">Cancel</button>
      </div>
    </div>`
}

async function saveModel() {
  const now = Date.now()
  const model = {
    id: crypto.randomUUID(),
    name: document.getElementById('mf-name').value || 'Untitled',
    provider: document.getElementById('mf-provider').value,
    model: document.getElementById('mf-model').value || 'claude-sonnet-4-20250514',
    apiKey: document.getElementById('mf-apikey').value || undefined,
    baseUrl: document.getElementById('mf-baseurl').value || undefined,
    maxContextTokens: parseInt(document.getElementById('mf-tokens').value) || 200000,
    thinking: document.getElementById('mf-thinking').value,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  }
  await settingsApi.models.upsert(model)
  loadSettingsTab('models')
}

window.setDefaultModel = async function(id) {
  await settingsApi.models.setDefault(id)
  loadSettingsTab('models')
}

window.deleteModel = async function(id) {
  if (confirm('Delete this model?')) {
    await settingsApi.models.delete(id)
    loadSettingsTab('models')
  }
}

window.showAddModelForm = showAddModelForm
window.saveModel = saveModel

// --- Prompts Tab ---
async function loadPromptsTab(container) {
  const prompts = await settingsApi.prompts.list()
  container.innerHTML = `
    <div class="settings-section">
      <h3>System Prompt Sections</h3>
      <p class="hint-text">Customize sections of the system prompt. Leave empty to use engine defaults.</p>
      <div id="prompts-list">
        ${prompts.map(p => `
          <div class="settings-card">
            <div class="card-header"><strong>${esc(p.name)}</strong> <span class="card-id">${esc(p.id)}</span></div>
            <textarea class="prompt-editor" data-prompt-id="${esc(p.id)}"
              placeholder="(using engine default)"
              rows="4">${esc(p.content)}</textarea>
            <button class="btn-xs" onclick="savePrompt('${esc(p.id)}', '${esc(p.name)}', this)">Save</button>
          </div>
        `).join('')}
      </div>
    </div>`
}

window.savePrompt = async function(id, name, btn) {
  const textarea = btn.parentElement.querySelector('.prompt-editor')
  const now = Date.now()
  await settingsApi.prompts.upsert({
    id, name, content: textarea.value,
    isDefault: false, createdAt: now, updatedAt: now,
  })
  btn.textContent = 'Saved!'
  setTimeout(() => { btn.textContent = 'Save' }, 1500)
}

// --- MCP Tab ---
async function loadMcpTab(container) {
  container.innerHTML = `
    <div class="settings-section">
      <h3>MCP Servers</h3>
      <p class="hint-text">MCP servers are configured in ~/.klaus/.mcp.json</p>
      <button class="btn-sm" onclick="reconnectMcp()">Reconnect All</button>
      <div id="mcp-status" style="margin-top:12px;color:var(--text-secondary);font-size:13px">Loading...</div>
    </div>`
  // TODO: show connected servers from mcp:status IPC
  document.getElementById('mcp-status').textContent = 'Use the config file to manage MCP servers.'
}

window.reconnectMcp = async function() {
  document.getElementById('mcp-status').textContent = 'Reconnecting...'
  await window.klaus.mcp.reconnect()
  document.getElementById('mcp-status').textContent = 'Reconnected.'
}

// --- Preferences Tab ---
async function loadPreferencesTab(container) {
  const lang = await settingsApi.kv.get('language') || 'en'
  const theme = await settingsApi.kv.get('theme') || 'light'
  const permMode = await settingsApi.kv.get('permission_mode') || 'default'

  container.innerHTML = `
    <div class="settings-section">
      <h3>Preferences</h3>
      <div class="form-row">
        <label>Language</label>
        <select id="pref-lang" onchange="savePref('language', this.value)">
          <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
          <option value="zh" ${lang === 'zh' ? 'selected' : ''}>中文</option>
        </select>
      </div>
      <div class="form-row">
        <label>Theme</label>
        <select id="pref-theme" onchange="savePref('theme', this.value); applyTheme(this.value)">
          <option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option>
          <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option>
        </select>
      </div>
      <div class="form-row">
        <label>Permission Mode</label>
        <select id="pref-perm" onchange="savePref('permission_mode', this.value)">
          <option value="default" ${permMode === 'default' ? 'selected' : ''}>Default (Ask)</option>
          <option value="auto" ${permMode === 'auto' ? 'selected' : ''}>Auto</option>
          <option value="bypassPermissions" ${permMode === 'bypassPermissions' ? 'selected' : ''}>Bypass All</option>
        </select>
      </div>
    </div>`
}

window.savePref = async function(key, value) {
  await settingsApi.kv.set(key, value)
}

// --- Utils ---
function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Expose for chat.js
window.toggleSettings = toggleSettings
