// Klaus Desktop — Settings Panel (fully aligned with Web端)
// Tabs: Models, Prompts, Channels, Skills, MCP, Tasks, Preferences

const settingsApi = window.klaus.settings
let settingsVisible = false
let currentSettingsTab = 'profile'
let skillsView = 'installed' // installed | builtin | market | enabled | disabled

function toggleSettings() {
  settingsVisible = !settingsVisible
  const view = document.getElementById('settings-view')
  if (settingsVisible) { view.classList.add('active'); loadSettingsTab(currentSettingsTab) }
  else { view.classList.remove('active') }
}

function loadSettingsTab(tab) {
  currentSettingsTab = tab
  document.querySelectorAll('.settings-nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.stab === tab))
  const content = document.getElementById('settings-content')
  switch (tab) {
    case 'profile': loadProfileTab(content); break
    case 'models': loadModelsTab(content); break
    case 'prompts': loadPromptsTab(content); break
    case 'channels': loadChannelsTab(content); break
    case 'skills': loadSkillsTab(content); break
    case 'mcp': loadMcpTab(content); break
    case 'cron': loadCronTab(content); break
    case 'preferences': loadPreferencesTab(content); break
  }
}

// ==================== Profile ====================
async function loadProfileTab(container) {
  const displayName = await settingsApi.kv.get('display_name') || 'User'
  const email = await settingsApi.kv.get('email') || 'user@local'

  container.innerHTML = `<div class="settings-section">
    <div class="settings-profile-header" style="display:flex;gap:16px;margin-bottom:20px;align-items:center">
      <div class="sidebar-avatar" style="width:56px;height:56px;font-size:22px;cursor:pointer;position:relative" id="profile-avatar-wrap">
        ${displayName.charAt(0).toUpperCase()}
        <input type="file" id="profile-avatar-input" accept="image/*" hidden>
      </div>
      <div>
        <div style="font-size:16px;font-weight:600;color:var(--fg)" id="profile-name-display">${esc(displayName)}</div>
        <div style="font-size:13px;color:var(--fg-tertiary)">${esc(email)}</div>
      </div>
    </div>
    <div class="settings-field">
      <label class="settings-field-label">Display name</label>
      <input class="settings-field-input" type="text" id="profile-name-input" value="${esc(displayName)}">
    </div>
    <button class="settings-btn-save" id="profile-save-btn">Save</button>
    <span id="profile-save-status" style="margin-left:8px;font-size:12px;color:var(--fg-tertiary)"></span>
  </div>`

  document.getElementById('profile-avatar-wrap')?.addEventListener('click', () => {
    document.getElementById('profile-avatar-input')?.click()
  })
  document.getElementById('profile-save-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('profile-name-input')?.value?.trim()
    if (name) {
      await settingsApi.kv.set('display_name', name)
      document.getElementById('profile-name-display').textContent = name
      document.getElementById('profile-save-status').textContent = 'Saved!'
      setTimeout(() => document.getElementById('profile-save-status').textContent = '', 2000)
      // Update sidebar
      const sidebarName = document.querySelector('.sidebar-username')
      if (sidebarName) sidebarName.textContent = name
      const avatar = document.querySelector('.sidebar-avatar')
      if (avatar) avatar.textContent = name.charAt(0).toUpperCase()
    }
  })
}

// ==================== Models ====================
async function loadModelsTab(container) {
  const models = await settingsApi.models.list()
  container.innerHTML = `<div class="settings-section"><div class="settings-section-header"><h3>Models</h3><button class="btn-sm" onclick="showAddModelForm()">+ Add Model</button></div><div id="models-list">${models.length === 0 ? '<p class="empty-text">No models configured</p>' : models.map(m => `
    <div class="settings-card ${m.isDefault ? 'card-default' : ''}">
      <div class="card-header"><strong>${esc(m.name)}</strong>${m.isDefault ? '<span class="badge">Default</span>' : ''}${m.role ? `<span class="s-badge s-badge-blue">${esc(m.role)}</span>` : ''}</div>
      <div class="card-meta">${esc(m.provider || 'anthropic')} / ${esc(m.model)} &middot; ${m.maxContextTokens.toLocaleString()} tokens &middot; thinking: ${esc(m.thinking)}</div>
      <div class="card-actions">${!m.isDefault ? `<button class="btn-xs" onclick="setDefaultModel('${esc(m.id)}')">Set Default</button>` : ''}<button class="btn-xs btn-danger" onclick="deleteModel('${esc(m.id)}')">Delete</button></div>
    </div>`).join('')}</div><div id="model-form" style="display:none"></div></div>`
}
window.showAddModelForm = function() {
  const form = document.getElementById('model-form'); form.style.display = 'block'
  form.innerHTML = `<div class="settings-card"><h4 style="margin-bottom:12px">Add Model</h4>
    <div class="form-row"><label>Name</label><input id="mf-name" placeholder="My Claude Model"></div>
    <div class="form-row"><label>Model ID</label><input id="mf-model" placeholder="claude-sonnet-4-20250514"></div>
    <div class="form-row"><label>API Key</label><input id="mf-apikey" type="password" placeholder="sk-ant-..."></div>
    <div class="form-row"><label>Provider</label><select id="mf-provider"><option value="anthropic">Anthropic</option><option value="bedrock">AWS Bedrock</option><option value="vertex">Google Vertex</option></select></div>
    <div class="form-row"><label>Base URL (optional)</label><input id="mf-baseurl"></div>
    <div class="form-row"><label>Max Context Tokens</label><input id="mf-tokens" type="number" value="200000"></div>
    <div class="form-row"><label>Thinking</label><select id="mf-thinking"><option value="off">Off</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
    <div class="form-actions"><button class="btn-sm btn-primary" onclick="saveModel()">Save</button><button class="btn-sm" onclick="document.getElementById('model-form').style.display='none'">Cancel</button></div></div>`
}
window.saveModel = async function() {
  const now = Date.now()
  await settingsApi.models.upsert({ id: crypto.randomUUID(), name: gv('mf-name') || 'Untitled', provider: gv('mf-provider'), model: gv('mf-model') || 'claude-sonnet-4-20250514', apiKey: gv('mf-apikey') || undefined, baseUrl: gv('mf-baseurl') || undefined, maxContextTokens: parseInt(gv('mf-tokens')) || 200000, thinking: gv('mf-thinking'), isDefault: false, createdAt: now, updatedAt: now })
  loadSettingsTab('models')
}
window.setDefaultModel = async (id) => { await settingsApi.models.setDefault(id); loadSettingsTab('models') }
window.deleteModel = async (id) => { if (confirm('Delete this model?')) { await settingsApi.models.delete(id); loadSettingsTab('models') } }

// ==================== Prompts ====================
async function loadPromptsTab(container) {
  const prompts = await settingsApi.prompts.list()
  container.innerHTML = `<div class="settings-section"><h3>System Prompt Sections</h3><p class="hint-text">Customize sections of the system prompt. Leave empty to use engine defaults.</p><div>${prompts.map(p => `
    <div class="settings-card"><div class="card-header"><strong>${esc(p.name)}</strong><span style="font-size:11px;color:var(--fg-quaternary)">${esc(p.id)}</span></div>
    <textarea class="prompt-editor" data-prompt-id="${esc(p.id)}" placeholder="(using engine default)" rows="4">${esc(p.content)}</textarea>
    <button class="btn-xs" onclick="savePrompt('${esc(p.id)}','${esc(p.name)}',this)">Save</button></div>`).join('')}</div></div>`
}
window.savePrompt = async function(id, name, btn) {
  const textarea = btn.parentElement.querySelector('.prompt-editor')
  await settingsApi.prompts.upsert({ id, name, content: textarea.value, isDefault: false, createdAt: Date.now(), updatedAt: Date.now() })
  btn.textContent = 'Saved!'; setTimeout(() => btn.textContent = 'Save', 1500)
}

// ==================== Channels ====================
async function loadChannelsTab(container) {
  const channels = await window.klaus.channels.list()
  const chDefs = [
    { id: 'feishu', name: 'Feishu', icon: '💬', inputs: [['app_id','App ID'],['app_secret','App Secret']] },
    { id: 'dingtalk', name: 'DingTalk', icon: '💬', inputs: [['client_id','Client ID'],['client_secret','Client Secret']] },
    { id: 'wechat', name: 'WeChat', icon: '💬', inputs: [] },
    { id: 'wecom', name: 'WeCom', icon: '💬', inputs: [['bot_id','Bot ID'],['secret','Secret']] },
    { id: 'qq', name: 'QQ', icon: '💬', inputs: [['app_id','App ID'],['client_secret','Client Secret']] },
    { id: 'telegram', name: 'Telegram', icon: '✈️', inputs: [['bot_token','Bot Token']] },
  ]
  container.innerHTML = `<div class="settings-section"><h3>IM Channels</h3><p class="hint-text">Connect messaging platforms to Klaus.</p>
    <div style="margin-bottom:12px;font-size:12px;color:var(--fg-tertiary)">
      <details><summary style="cursor:pointer;font-weight:500">Feishu Permissions JSON (click to copy)</summary>
        <pre id="feishu-perms-json" style="background:var(--bg-surface);padding:8px;border-radius:4px;font-size:11px;cursor:pointer;margin-top:4px" onclick="navigator.clipboard.writeText(this.textContent).then(()=>showToast('Copied!'))">[{"name":"im:message","desc":"Read messages"},{"name":"im:message:send_as_bot","desc":"Send messages as bot"},{"name":"im:chat","desc":"Access chat info"}]</pre>
      </details>
    </div>
    <div class="ch-grid">${chDefs.map(ch => {
    const state = channels.find(c => c.id === ch.id)
    const connected = state?.connected
    return `<div class="ch-card"><div class="ch-card-header"><span style="font-size:20px">${ch.icon}</span><span class="ch-card-name">${ch.name}</span><span class="ch-card-status">${connected ? '<span class="s-badge s-badge-green">Connected</span>' : '<span class="s-badge s-badge-gray">Off</span>'}</span></div>
    <div class="ch-card-body">${connected
      ? `<button class="btn-xs btn-danger" onclick="disconnectChannel('${ch.id}')">Disconnect</button>`
      : ch.inputs.map(([key, label]) => `<div class="ch-form-field"><label>${label}</label><input id="ch-${ch.id}-${key}" placeholder="${label}" value="${esc(state?.credentials?.[key] || '')}"></div>`).join('') + (ch.inputs.length ? `<button class="btn-xs" onclick="connectChannel('${ch.id}')">Connect</button>` : '<p class="s-muted" style="font-size:12px">QR code login — coming soon</p>')
    }</div></div>`
  }).join('')}</div></div>`
}
window.connectChannel = async function(id) {
  const fieldMap = { feishu: ['app_id','app_secret'], dingtalk: ['client_id','client_secret'], wecom: ['bot_id','secret'], qq: ['app_id','client_secret'], telegram: ['bot_token'] }
  const fields = fieldMap[id] || []
  const config = {}
  for (const key of fields) config[key] = document.getElementById('ch-' + id + '-' + key)?.value?.trim() || ''
  const result = await window.klaus.channels.connect(id, config)
  if (result.ok) { showToast('Connected!'); loadSettingsTab('channels') }
  else showToast(result.error || 'Connection failed')
}
window.disconnectChannel = async function(id) {
  if (!confirm('Disconnect this channel?')) return
  window.klaus.channels.disconnect(id)
  showToast('Disconnected'); loadSettingsTab('channels')
}

// ==================== Skills (5 views + search + install) ====================
async function loadSkillsTab(container) {
  const [installed, market] = await Promise.all([window.klaus.skills.list(), window.klaus.skills.market()])

  const builtin = installed.filter(s => s.source === 'builtin')
  const userInstalled = installed.filter(s => s.source !== 'builtin')
  const views = { installed: userInstalled, builtin, market, enabled: installed.filter(s => s.userEnabled), disabled: installed.filter(s => !s.userEnabled) }
  const current = views[skillsView] || views.installed

  container.innerHTML = `<div class="settings-section"><div class="settings-section-header"><h3>${tt('skills')}</h3><button class="btn-sm" id="sk-upload-btn">${tt('settings_skills_upload') || 'Upload Skill'}</button></div>
    <!-- Upload modal -->
    <div id="sk-upload-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;align-items:center;justify-content:center">
      <div style="background:var(--bg);border-radius:var(--radius-md);padding:24px;max-width:400px;width:100%">
        <h4 style="margin-bottom:12px">${tt('settings_skills_upload') || 'Upload Skill'}</h4>
        <div id="sk-dropzone" style="border:2px dashed var(--border);border-radius:var(--radius-sm);padding:32px;text-align:center;cursor:pointer;color:var(--fg-tertiary);font-size:14px;transition:border-color var(--transition)">
          Drop a ZIP or SKILL.md here, or click to browse
          <input type="file" id="sk-file-input" hidden accept=".zip,.md">
        </div>
        <div id="sk-upload-status" style="display:none;margin-top:8px;font-size:13px;color:var(--fg-secondary)"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn-sm" onclick="document.getElementById('sk-upload-modal').style.display='none'">${tt('cancel')}</button></div>
      </div>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap">
      ${['installed','builtin','market','enabled','disabled'].map(v => `<button class="btn-sm ${skillsView === v ? 'btn-primary' : ''}" onclick="switchSkillsView('${v}')">${tt(v) || v.charAt(0).toUpperCase() + v.slice(1)}</button>`).join('')}
    </div>
    <div style="margin-bottom:12px"><input class="s-form-input" id="sk-search" placeholder="Search skills..." style="width:100%" oninput="filterSkills()"></div>
    <div class="sk-grid" id="sk-grid">${renderSkillCards(current, skillsView)}</div></div>`

  bindSkillEvents()

  // Upload modal
  document.getElementById('sk-upload-btn')?.addEventListener('click', () => {
    document.getElementById('sk-upload-modal').style.display = 'flex'
    document.getElementById('sk-upload-status').style.display = 'none'
  })
  const skDropzone = document.getElementById('sk-dropzone')
  const skFileInput = document.getElementById('sk-file-input')
  skDropzone?.addEventListener('click', () => skFileInput?.click())
  skDropzone?.addEventListener('dragover', (e) => { e.preventDefault(); skDropzone.style.borderColor = 'var(--fg-tertiary)' })
  skDropzone?.addEventListener('dragleave', () => { skDropzone.style.borderColor = '' })
  skDropzone?.addEventListener('drop', (e) => { e.preventDefault(); skDropzone.style.borderColor = ''; if (e.dataTransfer?.files?.length) uploadSkillFile(e.dataTransfer.files[0]) })
  skFileInput?.addEventListener('change', () => { if (skFileInput.files?.length) uploadSkillFile(skFileInput.files[0]); skFileInput.value = '' })
}

function renderSkillCards(skills, view) {
  if (skills.length === 0) return '<p class="empty-text">No skills found</p>'
  return skills.map(s => {
    const isMarket = view === 'market'
    const toggle = !isMarket ? `<label class="sk-toggle"><input type="checkbox" class="sk-toggle-input" data-skill="${esc(s.dirName || s.name)}" ${s.userEnabled ? 'checked' : ''}><span class="sk-slider"></span></label>` : ''
    const installBtn = isMarket ? `<button class="btn-xs ${s.installed ? '' : 'btn-primary'}" data-install="${esc(s.dirName || s.name)}" ${s.installed ? 'disabled' : ''}>${s.installed ? 'Installed' : 'Install'}</button>` : ''
    const uninstallBtn = !isMarket && s.source === 'installed' ? `<button class="btn-xs btn-danger" data-uninstall="${esc(s.dirName || s.name)}">Uninstall</button>` : ''
    const srcBadge = `<span class="s-badge s-badge-gray">${esc(s.source)}</span>`
    return `<div class="sk-card" data-name="${esc(s.name)}"><div class="sk-card-head"><div class="sk-card-info"><div class="sk-card-emoji">🧩</div><div class="sk-card-name">${esc(s.name)}</div></div>${toggle}</div>
      <div class="sk-card-desc">${esc(s.description || '')}</div>
      <div class="sk-card-actions">${installBtn}${uninstallBtn}</div>
      <div class="sk-card-badges">${srcBadge}</div></div>`
  }).join('')
}

function bindSkillEvents() {
  document.querySelectorAll('.sk-toggle-input').forEach(el => {
    el.addEventListener('change', async () => {
      await window.klaus.skills.toggle(el.dataset.skill, el.checked)
      showToast(el.checked ? 'Skill enabled' : 'Skill disabled')
    })
  })
  document.querySelectorAll('[data-install]').forEach(el => {
    el.addEventListener('click', async () => {
      el.disabled = true; el.textContent = 'Installing...'
      const result = await window.klaus.skills.install(el.dataset.install)
      if (result.ok) { showToast('Installed: ' + result.name); loadSettingsTab('skills') }
      else { showToast('Error: ' + (result.error || 'unknown')); el.disabled = false; el.textContent = 'Install' }
    })
  })
  document.querySelectorAll('[data-uninstall]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('Uninstall skill: ' + el.dataset.uninstall + '?')) return
      await window.klaus.skills.uninstall(el.dataset.uninstall)
      showToast('Uninstalled'); loadSettingsTab('skills')
    })
  })
}

async function uploadSkillFile(file) {
  const statusEl = document.getElementById('sk-upload-status')
  statusEl.style.display = ''; statusEl.textContent = 'Uploading...'
  try {
    const buffer = await file.arrayBuffer()
    const result = await window.klaus.skills.upload(file.name, buffer)
    if (result.ok) {
      statusEl.textContent = 'Installed: ' + result.name
      loadSettingsTab('skills')
    } else {
      statusEl.textContent = 'Error: ' + (result.error || 'unknown')
    }
  } catch (err) {
    statusEl.textContent = 'Error: ' + (err.message || err)
  }
}

window.switchSkillsView = function(view) { skillsView = view; loadSettingsTab('skills') }
window.filterSkills = function() {
  const q = document.getElementById('sk-search')?.value?.toLowerCase() || ''
  document.querySelectorAll('.sk-card').forEach(card => {
    const name = card.dataset.name?.toLowerCase() || ''
    card.style.display = !q || name.includes(q) ? '' : 'none'
  })
}

// ==================== MCP (full management) ====================
async function loadMcpTab(container) {
  const [servers, status] = await Promise.all([window.klaus.mcp.list(), window.klaus.mcp.status()])
  const statusMap = new Map(status.map(s => [s.name, s]))

  container.innerHTML = `<div class="settings-section"><div class="settings-section-header"><h3>MCP Servers</h3>
      <div style="display:flex;gap:6px"><button class="btn-sm" id="mcp-add-manual">+ Add Server</button><button class="btn-sm" id="mcp-add-json">Import JSON</button><button class="btn-sm" onclick="window.klaus.mcp.reconnect().then(()=>{showToast('Reconnected');loadSettingsTab('mcp')})">Reconnect</button></div></div>

    <!-- Manual form (hidden) -->
    <div id="mcp-manual-form" style="display:none"><div class="settings-card">
      <div class="form-row"><label>Name</label><input id="mcpf-name" placeholder="server-name" class="s-form-input" style="width:100%"></div>
      <div class="form-row"><label>Type</label><select id="mcpf-type" class="s-form-input" style="width:100%"><option value="stdio">stdio</option><option value="sse">SSE</option><option value="http">HTTP</option></select></div>
      <div id="mcpf-command-wrap"><div class="form-row"><label>Command</label><input id="mcpf-command" placeholder='npx -y @modelcontextprotocol/server-everything' class="s-form-input" style="width:100%"></div></div>
      <div id="mcpf-url-wrap" style="display:none"><div class="form-row"><label>URL</label><input id="mcpf-url" placeholder="https://..." class="s-form-input" style="width:100%"></div></div>
      <div class="form-row"><label>Timeout (seconds, optional)</label><input id="mcpf-timeout" type="number" class="s-form-input" style="width:100%"></div>
      <div class="form-row"><label>Environment Variables</label><div id="mcpf-env-rows"></div>
        <div style="display:flex;gap:6px;margin-top:4px"><button class="btn-xs" id="mcpf-add-env">+ Add</button><button class="btn-xs" id="mcpf-paste-env">Paste</button></div></div>
      <div class="form-actions"><button class="btn-sm btn-primary" id="mcpf-save">Save</button><button class="btn-sm" id="mcpf-cancel">Cancel</button></div></div></div>

    <!-- JSON import form (hidden) -->
    <div id="mcp-json-form" style="display:none"><div class="settings-card">
      <div class="form-row"><label>Paste .mcp.json content</label><textarea id="mcpf-json" rows="8" class="prompt-editor" placeholder='{ "mcpServers": { "name": { "command": "..." } } }'></textarea></div>
      <div class="form-actions"><button class="btn-sm btn-primary" id="mcpf-json-import">Import</button><button class="btn-sm" id="mcpf-json-cancel">Cancel</button></div></div></div>

    <!-- Server list -->
    <div id="mcp-list">${servers.length === 0 ? '<p class="empty-text">No MCP servers configured</p>' : `<div class="sk-grid">${servers.map(s => {
      const st = statusMap.get(s.name)
      const cfg = s.config || {}
      const type = cfg.type || 'stdio'
      let detail = ''
      if (type === 'stdio') { detail = (cfg.command || '') + (cfg.args ? ' ' + cfg.args.join(' ') : '') }
      else { detail = cfg.url || '' }
      return `<div class="sk-card"><div class="sk-card-head"><div class="sk-card-info"><div class="sk-card-emoji">🔌</div><div class="sk-card-name">${esc(s.name)}</div></div>
        <label class="sk-toggle"><input type="checkbox" class="mcp-toggle-input" data-mcp="${esc(s.name)}" ${s.enabled ? 'checked' : ''}><span class="sk-slider"></span></label></div>
        <div class="sk-card-desc">${esc(detail)}</div>
        <div class="sk-card-actions"><button class="btn-xs btn-danger" data-delmcp="${esc(s.name)}">Uninstall</button></div>
        <div class="sk-card-badges"><span class="s-badge s-badge-gray">${esc(type.toUpperCase())}</span>${st ? `<span class="s-badge ${st.status === 'connected' ? 's-badge-green' : 's-badge-red'}">${st.toolCount} tools</span>` : ''}</div></div>`
    }).join('')}</div>`}</div></div>`

  // Event bindings
  document.getElementById('mcp-add-manual')?.addEventListener('click', () => {
    document.getElementById('mcp-manual-form').style.display = 'block'
    document.getElementById('mcp-list').style.display = 'none'
  })
  document.getElementById('mcp-add-json')?.addEventListener('click', () => {
    document.getElementById('mcp-json-form').style.display = 'block'
    document.getElementById('mcp-list').style.display = 'none'
  })
  document.getElementById('mcpf-cancel')?.addEventListener('click', () => {
    document.getElementById('mcp-manual-form').style.display = 'none'
    document.getElementById('mcp-list').style.display = ''
  })
  document.getElementById('mcpf-json-cancel')?.addEventListener('click', () => {
    document.getElementById('mcp-json-form').style.display = 'none'
    document.getElementById('mcp-list').style.display = ''
  })
  document.getElementById('mcpf-type')?.addEventListener('change', function() {
    document.getElementById('mcpf-command-wrap').style.display = this.value === 'stdio' ? '' : 'none'
    document.getElementById('mcpf-url-wrap').style.display = this.value === 'stdio' ? 'none' : ''
  })
  document.getElementById('mcpf-add-env')?.addEventListener('click', () => addMcpEnvRow('', ''))
  document.getElementById('mcpf-paste-env')?.addEventListener('click', () => {
    navigator.clipboard.readText().then(text => {
      text.trim().split('\n').forEach(line => {
        const eq = line.indexOf('=')
        if (eq > 0) addMcpEnvRow(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
      })
    }).catch(() => {})
  })
  document.getElementById('mcpf-save')?.addEventListener('click', async () => {
    const name = gv('mcpf-name')
    if (!name) { showToast('Name is required'); return }
    const type = gv('mcpf-type')
    const payload = { name }
    if (type === 'stdio') {
      const cmdStr = gv('mcpf-command')
      if (!cmdStr) { showToast('Command is required'); return }
      const parts = cmdStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [cmdStr]
      payload.command = parts[0].replace(/^"|"$/g, '')
      if (parts.length > 1) payload.args = parts.slice(1).map(p => p.replace(/^"|"$/g, ''))
    } else {
      const url = gv('mcpf-url')
      if (!url) { showToast('URL is required'); return }
      payload.type = type; payload.url = url
    }
    const env = getMcpEnvVars()
    if (env) payload.env = env
    const timeout = parseInt(gv('mcpf-timeout'))
    if (timeout > 0) payload.timeout = timeout
    const result = await window.klaus.mcp.create(payload)
    if (result.ok) { showToast('Server added'); loadSettingsTab('mcp') }
    else showToast(result.error || 'Failed')
  })
  document.getElementById('mcpf-json-import')?.addEventListener('click', async () => {
    const json = document.getElementById('mcpf-json')?.value?.trim()
    if (!json) return
    const result = await window.klaus.mcp.importJson(json)
    if (result.imported?.length) showToast('Imported: ' + result.imported.join(', '))
    if (result.errors?.length) showToast('Errors: ' + result.errors.join(', '))
    loadSettingsTab('mcp')
  })

  // Toggle + uninstall
  container.querySelectorAll('.mcp-toggle-input').forEach(el => {
    el.addEventListener('change', async () => {
      await window.klaus.mcp.toggle(el.dataset.mcp, el.checked)
      showToast(el.checked ? 'Enabled' : 'Disabled')
    })
  })
  container.querySelectorAll('[data-delmcp]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('Remove MCP server: ' + el.dataset.delmcp + '?')) return
      await window.klaus.mcp.remove(el.dataset.delmcp)
      showToast('Removed'); loadSettingsTab('mcp')
    })
  })
}

function addMcpEnvRow(key, val) {
  const rows = document.getElementById('mcpf-env-rows')
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:4px;align-items:center'
  row.innerHTML = `<input class="s-form-input" placeholder="KEY" value="${esc(key)}" style="flex:1" data-envkey><input class="s-form-input" placeholder="value" value="${esc(val)}" style="flex:1" data-envval><button class="s-btn" style="padding:4px 8px;font-size:16px;opacity:0.5" onclick="this.parentElement.remove()">&times;</button>`
  rows.appendChild(row)
}

function getMcpEnvVars() {
  const env = {}
  document.querySelectorAll('#mcpf-env-rows [data-envkey]').forEach(el => {
    const key = el.value.trim()
    const val = el.parentElement.querySelector('[data-envval]').value
    if (key) env[key] = val
  })
  return Object.keys(env).length ? env : undefined
}

// ==================== Cron Tasks ====================
async function loadCronTab(container) {
  const tasks = await settingsApi.cron.list()
  container.innerHTML = `<div class="settings-section"><div class="settings-section-header"><h3>Scheduled Tasks</h3><button class="btn-sm" id="cron-add-btn">+ New Task</button></div>
    <div id="cron-form" style="display:none"><div class="settings-card">
      <div class="form-row"><label>Task ID</label><input id="cf-id" placeholder="my-task"></div>
      <div class="form-row"><label>Name</label><input id="cf-name" placeholder="Friendly name"></div>
      <div class="form-row"><label>Schedule (cron)</label><input id="cf-schedule" placeholder="0 9 * * *"></div>
      <div class="form-row"><label>Prompt</label><textarea id="cf-prompt" rows="3" class="prompt-editor" placeholder="What should the agent do?"></textarea></div>
      <div class="form-actions"><button class="btn-sm btn-primary" id="cf-save">Save</button><button class="btn-sm" id="cf-cancel">Cancel</button></div></div></div>
    <div id="cron-list">${tasks.length === 0 ? '<p class="empty-text">No scheduled tasks</p>' : `<table class="s-table"><thead><tr><th>ID</th><th>Name</th><th>Schedule</th><th>Status</th><th></th></tr></thead><tbody>${tasks.map(t => `
    <tr><td><span class="s-code">${esc(t.id)}</span></td><td>${esc(t.name || '-')}</td><td class="s-muted">${esc(t.schedule)}</td>
    <td>${t.enabled ? '<span class="s-badge s-badge-green">On</span>' : '<span class="s-badge s-badge-gray">Off</span>'}</td>
    <td><div class="s-actions"><button class="s-btn s-btn-ghost" onclick="toggleCron('${esc(t.id)}',${!t.enabled})">${t.enabled ? 'Disable' : 'Enable'}</button><button class="s-btn s-btn-danger" onclick="deleteCron('${esc(t.id)}')">Delete</button></div></td></tr>`).join('')}</tbody></table>`}</div></div>`
  document.getElementById('cron-add-btn')?.addEventListener('click', () => document.getElementById('cron-form').style.display = 'block')
  document.getElementById('cf-cancel')?.addEventListener('click', () => document.getElementById('cron-form').style.display = 'none')
  document.getElementById('cf-save')?.addEventListener('click', async () => {
    const id = gv('cf-id'), schedule = gv('cf-schedule'), prompt = gv('cf-prompt')
    if (!id || !schedule || !prompt) { showToast('All fields required'); return }
    await settingsApi.cron.upsert({ id, name: gv('cf-name') || undefined, schedule, prompt, enabled: true, createdAt: Date.now(), updatedAt: Date.now() })
    showToast('Task saved'); loadSettingsTab('cron')
  })
}
window.toggleCron = async function(id, enabled) {
  const tasks = await settingsApi.cron.list()
  const t = tasks.find(x => x.id === id)
  if (t) { await settingsApi.cron.upsert({ ...t, enabled, updatedAt: Date.now() }); loadSettingsTab('cron') }
}
window.deleteCron = async function(id) { if (confirm('Delete this task?')) { await settingsApi.cron.delete(id); showToast('Deleted'); loadSettingsTab('cron') } }

// ==================== Preferences ====================
async function loadPreferencesTab(container) {
  const lang = await settingsApi.kv.get('language') || 'en'
  const theme = await settingsApi.kv.get('theme') || 'light'
  const permMode = await settingsApi.kv.get('permission_mode') || 'default'

  container.innerHTML = `<div class="settings-section"><h3>Preferences</h3>
    <div class="settings-field"><label class="settings-field-label">Color mode</label>
      <div class="settings-theme-options" id="theme-options">
        <div class="settings-theme-card ${theme === 'light' ? 'active' : ''}" data-theme="light"><div class="settings-theme-preview settings-theme-preview-light"></div><div class="settings-theme-label">Light</div></div>
        <div class="settings-theme-card ${theme === 'dark' ? 'active' : ''}" data-theme="dark"><div class="settings-theme-preview settings-theme-preview-dark"></div><div class="settings-theme-label">Dark</div></div>
      </div></div>
    <div class="settings-field"><label class="settings-field-label">Permission Mode</label>
      <div id="perm-options">
        <div class="settings-perm-card ${permMode === 'default' ? 'active' : ''}" data-perm="default"><div class="settings-perm-icon">🛡</div><div><div class="settings-perm-label">Default</div><div class="settings-perm-desc">Ask permission for potentially risky operations</div></div></div>
        <div class="settings-perm-card ${permMode === 'auto' ? 'active' : ''}" data-perm="auto"><div class="settings-perm-icon">⚡</div><div><div class="settings-perm-label">Auto</div><div class="settings-perm-desc">Automatically approve safe operations</div></div></div>
        <div class="settings-perm-card ${permMode === 'bypassPermissions' ? 'active' : ''}" data-perm="bypassPermissions"><div class="settings-perm-icon">🔓</div><div><div class="settings-perm-label">Bypass All</div><div class="settings-perm-desc">Skip all permission prompts (use with caution)</div></div></div>
      </div></div>
    <div class="settings-field"><label class="settings-field-label">Language</label>
      <div class="settings-theme-options">
        <div class="settings-theme-card ${lang === 'en' ? 'active' : ''}" data-lang="en"><div class="settings-theme-label">English</div></div>
        <div class="settings-theme-card ${lang === 'zh' ? 'active' : ''}" data-lang="zh"><div class="settings-theme-label">中文</div></div>
      </div></div></div>`

  container.querySelector('#theme-options')?.addEventListener('click', async (e) => {
    const card = e.target.closest('.settings-theme-card'); if (!card) return
    container.querySelectorAll('#theme-options .settings-theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === card.dataset.theme))
    await settingsApi.kv.set('theme', card.dataset.theme); applyTheme(card.dataset.theme)
  })
  container.querySelector('#perm-options')?.addEventListener('click', async (e) => {
    const card = e.target.closest('.settings-perm-card'); if (!card) return
    container.querySelectorAll('.settings-perm-card').forEach(c => c.classList.toggle('active', c.dataset.perm === card.dataset.perm))
    await settingsApi.kv.set('permission_mode', card.dataset.perm); showToast('Permission mode saved')
  })
  container.querySelectorAll('[data-lang]').forEach(card => {
    card.addEventListener('click', async () => {
      container.querySelectorAll('[data-lang]').forEach(c => c.classList.toggle('active', c.dataset.lang === card.dataset.lang))
      await settingsApi.kv.set('language', card.dataset.lang)
      if (typeof setLanguage === 'function') setLanguage(card.dataset.lang)
      showToast('Language saved')
    })
  })
}

// ==================== Utils ====================
function esc(str) { return str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') : '' }
function gv(id) { return document.getElementById(id)?.value?.trim() || '' }
function showToast(msg) {
  let toast = document.getElementById('settings-toast')
  if (!toast) { toast = document.createElement('div'); toast.id = 'settings-toast'; toast.className = 's-toast'; document.body.appendChild(toast) }
  toast.textContent = msg; toast.classList.add('show')
  setTimeout(() => toast.classList.remove('show'), 2500)
}

window.toggleSettings = toggleSettings
window.loadSettingsTab = loadSettingsTab
window.showToast = showToast
