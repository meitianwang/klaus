// Klaus Desktop — Settings Panel
// Tabs: Profile, Models, Channels, Connectors, Skills, MCP
// Prompts are managed in the Klaus web admin panel (cloud).
// Scheduled tasks live in their own view (cron.js, sidebar entry).

const settingsApi = window.klaus.settings
let settingsVisible = false
let currentSettingsTab = 'profile'
let skillsView = 'market' // market | builtin | installed
let skillsFilter = 'all' // all | enabled | disabled (only applied on installed tab)
let skillsSearchQuery = ''

function toggleSettings(tab) {
  settingsVisible = !settingsVisible
  const view = document.getElementById('settings-view')
  if (settingsVisible) { view.classList.add('active'); loadSettingsTab(tab || currentSettingsTab) }
  else { view.classList.remove('active') }
}

function loadSettingsTab(tab) {
  currentSettingsTab = tab
  document.querySelectorAll('.settings-nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.stab === tab))
  const content = document.getElementById('settings-content')
  switch (tab) {
    case 'profile': loadProfileTab(content); break
    case 'preferences': loadPreferencesTab(content); break
    case 'models': loadModelsTab(content); break
    case 'channels': loadChannelsTab(content); break
    case 'connectors': loadConnectorsTab(content); break
    case 'skills': loadSkillsTab(content); break
    case 'mcp': loadMcpTab(content); break
    case 'systemAuth': loadSystemAuthTab(content); break
  }
}

// 把 dataURL 头像应用到所有头像 DOM（设置页 + 侧栏），无图时用首字母占位
function applyAvatar(dataUrl, displayName) {
  const initial = (displayName || 'U').charAt(0).toUpperCase()
  document.querySelectorAll('.sidebar-avatar').forEach(el => {
    if (dataUrl) {
      el.style.backgroundImage = `url("${dataUrl}")`
      el.style.backgroundSize = 'cover'
      el.style.backgroundPosition = 'center'
      el.style.color = 'transparent'
      // 保留子元素（hidden file input），只清掉文字节点
      Array.from(el.childNodes).forEach(n => { if (n.nodeType === 3) n.remove() })
      if (!el.textContent.trim()) el.textContent = ''
      // 把首字母文字放在 ::after 伪元素也行，这里简单清掉让背景图透出来
      el.childNodes.forEach?.(() => {})
    } else {
      el.style.backgroundImage = ''
      el.style.color = ''
      Array.from(el.childNodes).forEach(n => { if (n.nodeType === 3) n.remove() })
      el.insertBefore(document.createTextNode(initial), el.firstChild)
    }
  })
}

// 启动时把保存过的 display_name / email / avatar 应用到侧栏
async function bootstrapProfile() {
  try {
    const name = await settingsApi.kv.get('display_name') || tt('user_default_name')
    const email = await settingsApi.kv.get('email') || tt('user_default_email')
    const dataUrl = await settingsApi.kv.get('avatar_data_url')
    // 侧栏名字
    const sidebarName = document.querySelector('.sidebar-username')
    if (sidebarName) sidebarName.textContent = name
    // 用户菜单里的 email
    const emailEl = document.getElementById('user-menu-email')
    if (emailEl) emailEl.textContent = email
    // 侧栏头像（有图片就用图，没有就用首字母）
    applyAvatar(dataUrl, name)
  } catch {}
}
window.bootstrapProfile = bootstrapProfile
// 向后兼容旧名字
window.bootstrapAvatar = bootstrapProfile

// ==================== Profile（含偏好设置：主题 / 权限 / 语言） ====================
async function loadProfileTab(container) {
  const displayName = await settingsApi.kv.get('display_name') || tt('user_default_name')
  const email = await settingsApi.kv.get('email') || tt('user_default_email')
  const avatarDataUrl = await settingsApi.kv.get('avatar_data_url')
  const theme = await settingsApi.kv.get('theme') || 'light'

  container.innerHTML = `<div class="settings-section">
    <div class="settings-profile-header" style="display:flex;gap:16px;margin-bottom:20px;align-items:center">
      <div class="sidebar-avatar" style="width:56px;height:56px;font-size:22px;cursor:pointer;position:relative;${avatarDataUrl ? `background-image:url('${avatarDataUrl}');background-size:cover;background-position:center;color:transparent` : ''}" id="profile-avatar-wrap" title="${esc(tt('upload_avatar_tooltip'))}">
        ${avatarDataUrl ? '' : esc(displayName.charAt(0).toUpperCase())}
        <input type="file" id="profile-avatar-input" accept="image/*" hidden>
      </div>
      <div>
        <div style="font-size:16px;font-weight:600;color:var(--fg)" id="profile-name-display">${esc(displayName)}</div>
        <div style="font-size:13px;color:var(--fg-tertiary)">${esc(email)}</div>
      </div>
    </div>
    <div class="settings-field">
      <label class="settings-field-label">${tt("display_name")}</label>
      <input class="settings-field-input" type="text" id="profile-name-input" value="${esc(displayName)}">
    </div>
    <button class="settings-btn-save" id="profile-save-btn">${tt('save')}</button>
    <span id="profile-save-status" style="margin-left:8px;font-size:12px;color:var(--fg-tertiary)"></span>

    <div class="settings-field" style="margin-top:24px">
      <label class="settings-field-label">${tt("color_mode")}</label>
      <div class="settings-theme-options" id="theme-options">
        <div class="settings-theme-card ${theme === 'light' ? 'active' : ''}" data-theme="light">
          <div class="settings-theme-preview settings-theme-preview-light"></div>
          <div class="settings-theme-footer">
            <div class="settings-theme-radio"></div>
            <div class="settings-theme-label">${tt('light') || 'Light'}</div>
          </div>
        </div>
        <div class="settings-theme-card ${theme === 'dark' ? 'active' : ''}" data-theme="dark">
          <div class="settings-theme-preview settings-theme-preview-dark"></div>
          <div class="settings-theme-footer">
            <div class="settings-theme-radio"></div>
            <div class="settings-theme-label">${tt('dark') || 'Dark'}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`

  document.getElementById('profile-avatar-wrap')?.addEventListener('click', () => {
    document.getElementById('profile-avatar-input')?.click()
  })
  // 选文件 → Canvas 缩到 128x128（避免大图塞爆 SQLite KV）→ 存 dataURL → 同步所有头像 DOM
  document.getElementById('profile-avatar-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const resized = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const size = 128
          const canvas = document.createElement('canvas')
          canvas.width = size; canvas.height = size
          const ctx = canvas.getContext('2d')
          // 居中裁剪成正方形再缩
          const s = Math.min(img.width, img.height)
          const sx = (img.width - s) / 2
          const sy = (img.height - s) / 2
          ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size)
          resolve(canvas.toDataURL('image/png'))
        }
        img.onerror = reject
        img.src = dataUrl
      })
      // 立即本地回显（canvas 输出 dataURL，不等网络）
      await settingsApi.kv.set('avatar_data_url', resized)
      const name = document.getElementById('profile-name-input')?.value?.trim() || tt('user_default_name')
      applyAvatar(resized, name)
      const wrap = document.getElementById('profile-avatar-wrap')
      if (wrap) {
        wrap.style.backgroundImage = `url("${resized}")`
        wrap.style.backgroundSize = 'cover'
        wrap.style.backgroundPosition = 'center'
        wrap.style.color = 'transparent'
        Array.from(wrap.childNodes).forEach(n => { if (n.nodeType === 3) n.remove() })
      }
      // 后台把 PNG 原始字节上传到云端；成功后 main 会广播 klausAuth:updated，
      // chat.js 的监听会把 avatar_data_url 覆盖成服务端绝对 URL
      // ⚠️ 不能用 fetch(dataURL)——CSP connect-src 会拦，直接 base64→ArrayBuffer
      try {
        const base64 = resized.slice(resized.indexOf(',') + 1)
        const bin = atob(base64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const res = await window.klaus?.klausAuth?.uploadAvatar?.('image/png', bytes.buffer)
        if (res && !res.ok) console.warn('[Settings] avatar cloud upload rejected:', res.error)
      } catch (err) {
        console.warn('[Settings] avatar cloud upload failed:', err)
      }
      showToast(tt('avatar_updated'))
    } catch (err) {
      showToast(tt('avatar_upload_failed_prefix') + (err?.message || String(err)))
    }
  })
  document.getElementById('profile-save-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('profile-name-input')?.value?.trim()
    if (!name) return
    const statusEl = document.getElementById('profile-save-status')
    if (statusEl) statusEl.textContent = ''
    // 先回写云端；失败也落本地 KV，避免完全丢失用户输入
    let cloudOk = false
    try {
      const r = await window.klaus?.klausAuth?.updateProfile?.(name)
      cloudOk = !!r?.ok
    } catch { cloudOk = false }
    // main 成功时会广播 klausAuth:updated，自动刷新 KV + 侧栏；失败这里兜底
    if (!cloudOk) {
      await settingsApi.kv.set('display_name', name)
      if (typeof window.bootstrapProfile === 'function') window.bootstrapProfile()
    }
    document.getElementById('profile-name-display').textContent = name
    if (statusEl) statusEl.textContent = cloudOk ? tt('saved') : tt('saved') + ' (local)'
    setTimeout(() => { if (statusEl) statusEl.textContent = '' }, 2000)
  })

  // Theme switch
  container.querySelector('#theme-options')?.addEventListener('click', async (e) => {
    const card = e.target.closest('.settings-theme-card'); if (!card) return
    container.querySelectorAll('#theme-options .settings-theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === card.dataset.theme))
    await settingsApi.kv.set('theme', card.dataset.theme); applyTheme(card.dataset.theme)
  })
}

// ==================== Preferences ====================
async function loadPreferencesTab(container) {
  const permMode = await settingsApi.kv.get('permission_mode') || 'default'
  let keepAwake = false
  try { keepAwake = (await settingsApi.cron.keepAwake.get())?.enabled === true } catch {}
  let loginItem = false
  try { loginItem = (await window.klaus.app.loginItem.get())?.enabled === true } catch {}
  const notifyDesktop = (await settingsApi.kv.get('notification.desktop')) !== 'off'
  const notifySound = (await settingsApi.kv.get('notification.sound')) !== 'off'

  const row = (id, label, desc, checked) => `
    <div class="pref-row">
      <div class="pref-row-text">
        <div class="pref-row-label">${label}</div>
        <div class="pref-row-desc">${desc}</div>
      </div>
      <label class="pref-switch">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
        <span class="pref-switch-track"></span>
      </label>
    </div>
  `

  container.innerHTML = `<div class="settings-section">
    <div class="settings-field">
      <label class="settings-field-label">${tt("permission_mode")}</label>
      <div class="pref-card" id="perm-options" style="margin-top:0">
        <div class="pref-row perm-row ${permMode === 'default' ? 'active' : ''}" data-perm="default">
          <div class="pref-row-text"><div class="pref-row-label">${tt('perm_default')}</div><div class="pref-row-desc">${tt('perm_default_desc')}</div></div>
          <div class="settings-theme-radio"></div>
        </div>
        <div class="pref-row perm-row ${permMode === 'auto' ? 'active' : ''}" data-perm="auto">
          <div class="pref-row-text"><div class="pref-row-label">${tt('perm_auto')}</div><div class="pref-row-desc">${tt('perm_auto_desc')}</div></div>
          <div class="settings-theme-radio"></div>
        </div>
        <div class="pref-row perm-row ${permMode === 'bypassPermissions' ? 'active' : ''}" data-perm="bypassPermissions">
          <div class="pref-row-text"><div class="pref-row-label">${tt('perm_bypass')}</div><div class="pref-row-desc">${tt('perm_bypass_desc')}</div></div>
          <div class="settings-theme-radio"></div>
        </div>
      </div>
    </div>

    <div class="pref-card">
      ${row('pref-login-item', tt('pref_login_item'), tt('pref_login_item_desc'), loginItem)}
      ${row('pref-keep-awake', tt('cron_keep_awake'), tt('pref_keep_awake_desc'), keepAwake)}
      ${row('pref-notify-desktop', tt('pref_notify_desktop'), tt('pref_notify_desktop_desc'), notifyDesktop)}
      ${row('pref-notify-sound', tt('pref_notify_sound'), tt('pref_notify_sound_desc'), notifySound)}
    </div>
  </div>`

  container.querySelector('#perm-options')?.addEventListener('click', async (e) => {
    const card = e.target.closest('.perm-row'); if (!card) return
    container.querySelectorAll('.perm-row').forEach(c => c.classList.toggle('active', c.dataset.perm === card.dataset.perm))
    await settingsApi.kv.set('permission_mode', card.dataset.perm); showToast(tt('perm_mode_saved'))
  })
  container.querySelector('#pref-login-item')?.addEventListener('change', async (e) => {
    const checked = e.target.checked
    const res = await window.klaus.app.loginItem.set(checked)
    if (!res?.ok) { e.target.checked = !checked; showToast(res?.error || 'Failed'); return }
    showToast(tt('settings_saved'))
  })
  container.querySelector('#pref-keep-awake')?.addEventListener('change', async (e) => {
    const checked = e.target.checked
    const res = await settingsApi.cron.keepAwake.set(checked)
    if (!res?.ok) { e.target.checked = !checked; showToast(res?.error || 'Failed'); return }
    showToast(tt('settings_saved'))
  })
  container.querySelector('#pref-notify-desktop')?.addEventListener('change', async (e) => {
    await settingsApi.kv.set('notification.desktop', e.target.checked ? 'on' : 'off')
    showToast(tt('settings_saved'))
  })
  container.querySelector('#pref-notify-sound')?.addEventListener('change', async (e) => {
    await settingsApi.kv.set('notification.sound', e.target.checked ? 'on' : 'off')
    showToast(tt('settings_saved'))
  })
}

// ==================== Models ====================
async function loadModelsTab(container) {
  const authMode = (await settingsApi.kv.get('auth_mode')) || 'subscription'

  const segment = `
    <div class="auth-mode-segment" style="display:inline-flex;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:3px;margin-bottom:16px">
      <button class="auth-mode-btn" data-mode="subscription" style="padding:6px 14px;border:none;border-radius:6px;cursor:pointer;font-size:13px;background:${authMode==='subscription'?'var(--bg)':'transparent'};color:${authMode==='subscription'?'var(--fg)':'var(--fg-tertiary)'};font-weight:${authMode==='subscription'?'600':'400'}">${tt('auth_subscription')}</button>
      <button class="auth-mode-btn" data-mode="custom" style="padding:6px 14px;border:none;border-radius:6px;cursor:pointer;font-size:13px;background:${authMode==='custom'?'var(--bg)':'transparent'};color:${authMode==='custom'?'var(--fg)':'var(--fg-tertiary)'};font-weight:${authMode==='custom'?'600':'400'}">${tt('sub_custom_mode_btn')}</button>
    </div>
  `

  let body = ''
  if (authMode === 'subscription') {
    body = await renderSubscriptionSection()
  } else {
    const models = await settingsApi.models.list()
    body = `<div class="settings-section-header"><h3>${tt("models")}</h3><button class="btn-sm" onclick="showAddModelForm()">${tt("add_model")}</button></div>
      <div id="models-list">${models.length === 0 ? `<p class="empty-text">${tt('no_models')}</p>` : models.map(m => `
        <div class="settings-card ${m.isDefault ? 'card-default' : ''}">
          <div class="card-header"><strong>${esc(m.name)}</strong>${m.isDefault ? `<span class="badge">${tt('model_badge_default')}</span>` : ''}${m.role ? `<span class="s-badge s-badge-blue">${esc(m.role)}</span>` : ''}</div>
          <div class="card-meta">${esc(m.provider || 'anthropic')} / ${esc(m.model)} &middot; ${m.maxContextTokens.toLocaleString()} tokens &middot; thinking: ${esc(m.thinking)}</div>
          <div class="card-actions">${!m.isDefault ? `<button class="btn-xs" onclick="setDefaultModel('${esc(m.id)}')">${tt('set_default')}</button>` : ''}<button class="btn-xs" onclick="showModelForm('${esc(m.id)}')">${tt('model_edit')}</button><button class="btn-xs btn-danger" onclick="deleteModel('${esc(m.id)}')">${tt('delete_title')}</button></div>
        </div>`).join('')}</div>
      <div id="model-form" style="display:none"></div>`
  }

  container.innerHTML = `<div class="settings-section">${segment}${body}</div>`

  // 绑定 segment 点击
  container.querySelectorAll('.auth-mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode
      await settingsApi.kv.set('auth_mode', mode)
      window.dispatchEvent(new Event('klaus:auth-mode-changed'))
      loadSettingsTab('models')
    })
  })

  // subscription 模式下绑定登录/登出按钮
  if (authMode === 'subscription') {
    bindSubscriptionHandlers(container)
  }
}

async function renderSubscriptionSection() {
  const status = await window.klaus.auth?.status?.() || { loggedIn: false }
  if (status.loggedIn) {
    return `
      <div class="settings-card">
        <div class="card-header"><strong>${esc(status.account || tt('sub_account_fallback'))}</strong><span class="badge">${tt('auth_logged_in')}</span></div>
        <div class="card-meta" style="color:var(--fg-tertiary);font-size:13px;margin:8px 0">${tt('sub_mode_desc')}</div>
        <div class="card-actions"><button class="btn-xs btn-danger" id="auth-logout-btn">${tt('sub_logout')}</button></div>
      </div>
    `
  }
  return `
    <div class="settings-card">
      <div class="card-header"><strong>${tt('sub_card_not_logged_in')}</strong></div>
      <div class="card-meta" style="color:var(--fg-tertiary);font-size:13px;margin:8px 0">${tt('sub_hint_not_logged_in')}</div>
      <div class="card-actions"><button class="btn-sm btn-primary" id="auth-login-btn">${tt('sub_login_btn')}</button></div>
      <div id="auth-login-status" style="margin-top:10px;font-size:12px;color:var(--fg-tertiary)"></div>
    </div>
  `
}

function bindSubscriptionHandlers(container) {
  container.querySelector('#auth-login-btn')?.addEventListener('click', async () => {
    const statusEl = container.querySelector('#auth-login-status')
    if (statusEl) statusEl.textContent = tt('sub_auth_opening')
    try {
      const res = await window.klaus.auth.login()
      if (res?.ok) {
        window.dispatchEvent(new Event('klaus:auth-mode-changed'))
        loadSettingsTab('models')
      } else {
        if (statusEl) statusEl.textContent = tt('auth_login_failed_prefix') + (res?.error || tt('auth_unknown_error'))
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = tt('auth_login_failed_prefix') + (err?.message || String(err))
    }
  })
  container.querySelector('#auth-logout-btn')?.addEventListener('click', async () => {
    if (!(await window.klausDialog.confirm(tt('sub_confirm_logout')))) return
    try {
      await window.klaus.auth.logout()
    } catch {}
    window.dispatchEvent(new Event('klaus:auth-mode-changed'))
    loadSettingsTab('models')
  })
}
// 编辑态下藏住 id —— add 时是 null，edit 时是目标 modelId
let editingModelId = null

// Add/edit 二合一：无参=add，传 id=edit（后端 upsert 已支持带 id 更新）
window.showModelForm = async function(modelId) {
  editingModelId = modelId || null
  let existing = null
  if (modelId) {
    const models = await settingsApi.models.list()
    existing = models.find(m => m.id === modelId)
    if (!existing) { editingModelId = null; return }
  }
  const form = document.getElementById('model-form'); form.style.display = 'block'
  const title = existing ? tt('edit_model_title') : tt('add_model_title')
  const v = (k, fallback = '') => existing ? (existing[k] ?? fallback) : fallback
  form.innerHTML = `<div class="settings-card"><h4 style="margin-bottom:12px">${title}</h4>
    <div class="form-row"><label>${tt('model_field_name')}</label><input id="mf-name" placeholder="${esc(tt('model_placeholder_name'))}" value="${esc(v('name'))}"></div>
    <div class="form-row"><label>${tt('model_field_model_id')}</label><input id="mf-model" placeholder="claude-sonnet-4-20250514" value="${esc(v('model'))}"></div>
    <div class="form-row"><label>${tt('model_field_api_key')}</label><input id="mf-apikey" type="password" placeholder="sk-ant-..." value="${esc(v('apiKey'))}"></div>
    <div class="form-row"><label>${tt('model_field_provider')}</label><div id="mf-provider" class="kls-select kls-select-block"></div></div>
    <div class="form-row"><label>${tt('model_field_base_url')}</label><input id="mf-baseurl" value="${esc(v('baseUrl'))}"></div>
    <div class="form-row"><label>${tt('model_field_max_tokens')}</label><input id="mf-tokens" type="number" value="${v('maxContextTokens', 200000)}"></div>
    <div class="form-row"><label>${tt('model_field_thinking')}</label><div id="mf-thinking" class="kls-select kls-select-block"></div></div>
    <div class="form-actions"><button class="btn-sm btn-primary" onclick="saveModel()">${tt('save')}</button><button class="btn-sm" onclick="document.getElementById('model-form').style.display='none'">${tt('cancel')}</button></div></div>`
  window.klsSelect.bind(document.getElementById('mf-provider'), {
    items: [
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'bedrock',   label: 'AWS Bedrock' },
      { value: 'vertex',    label: 'Google Vertex' },
    ],
    value: v('provider', 'anthropic'),
  })
  window.klsSelect.bind(document.getElementById('mf-thinking'), {
    items: ['off', 'low', 'medium', 'high'].map(k => ({ value: k, i18nKey: 'thinking_' + k })),
    value: v('thinking', 'off'),
  })
}
// 兼容旧入口名
window.showAddModelForm = () => window.showModelForm()

window.saveModel = async function() {
  const now = Date.now()
  let base = { id: crypto.randomUUID(), isDefault: false, createdAt: now }
  if (editingModelId) {
    const models = await settingsApi.models.list()
    const existing = models.find(m => m.id === editingModelId)
    if (existing) base = { ...existing } // 保留 isDefault / createdAt / role / cost_* 等未暴露字段
  }
  await settingsApi.models.upsert({
    ...base,
    name: gv('mf-name') || 'Untitled',
    provider: gv('mf-provider'),
    model: gv('mf-model') || 'claude-sonnet-4-20250514',
    apiKey: gv('mf-apikey') || undefined,
    baseUrl: gv('mf-baseurl') || undefined,
    maxContextTokens: parseInt(gv('mf-tokens')) || 200000,
    thinking: gv('mf-thinking'),
    updatedAt: now,
  })
  editingModelId = null
  loadSettingsTab('models')
}
window.setDefaultModel = async (id) => {
  await settingsApi.models.setDefault(id)
  window.dispatchEvent(new Event('klaus:auth-mode-changed'))
  loadSettingsTab('models')
}
window.deleteModel = async (id) => {
  if (!(await window.klausDialog.confirm({ message: tt('delete_model'), danger: true }))) return
  await settingsApi.models.delete(id)
  loadSettingsTab('models')
}

// ==================== Channels ====================
const FEISHU_PERMISSIONS_JSON = '{"scopes":{"tenant":["contact:contact.base:readonly","docx:document:readonly","im:chat:read","im:chat:update","im:message.group_at_msg:readonly","im:message.p2p_msg:readonly","im:message.pins:read","im:message.pins:write_only","im:message.reactions:read","im:message.reactions:write_only","im:message:readonly","im:message:recall","im:message:send_as_bot","im:message:send_multi_users","im:message:send_sys_msg","im:message:update","im:resource","application:application:self_manage","cardkit:card:write","cardkit:card:read"],"user":["contact:user.employee_id:readonly","offline_access"]}}'

function buildChannelDefs() {
  return [
    {
      id: 'wechat', name: 'WeChat', icon: 'wechat-icon.png',
      desc: tt('ch_wechat_desc'),
      inputs: [],
      flow: 'wechat-qr',
    },
    {
      id: 'wecom', name: 'WeCom', icon: 'wecom-icon.png',
      desc: tt('ch_wecom_desc'),
      inputs: [['botid', 'bot_id', 'Bot ID', 'text', 'Enter Bot ID'], ['secret', 'secret', 'Secret', 'password', 'Enter Secret']],
      guide: [
        { num: '1', text: tt('ch_wecom_step1'), link: { href: 'https://work.weixin.qq.com/wework_admin/frame#manageTools', label: tt('ch_wecom_step1_link') } },
        { num: '2', text: tt('ch_wecom_step2') },
        { num: '3', text: tt('ch_wecom_step3') },
        { num: '4', text: tt('ch_wecom_step4') },
      ],
    },
    {
      id: 'qq', name: 'QQ', icon: 'qq-icon.png',
      desc: tt('ch_qq_desc'),
      inputs: [['appid', 'app_id', 'App ID', 'text', '102xxxxxx'], ['secret', 'client_secret', 'App Secret', 'password', 'Enter App Secret']],
      guide: [
        { num: '1', text: tt('ch_qq_step1'), link: { href: 'https://q.qq.com/', label: tt('ch_qq_step1_link') } },
        { num: '2', text: tt('ch_qq_step2') },
        { num: '3', text: tt('ch_qq_step3') },
      ],
    },
    {
      id: 'feishu', name: 'Feishu / Lark', icon: 'feishu.png',
      desc: tt('ch_feishu_desc'),
      inputs: [['appid', 'app_id', 'App ID', 'text', 'cli_xxxxxxxxxxxxxxxx'], ['secret', 'app_secret', 'App Secret', 'password', 'Enter App Secret']],
      guide: [
        { num: '1', text: tt('ch_feishu_step1'), link: { href: 'https://open.feishu.cn/app', label: tt('ch_feishu_step1_link') } },
        { num: '2', text: tt('ch_feishu_step2') },
        { num: '3', text: tt('ch_feishu_step3'), action: { id: 'feishu-copy-perms', label: tt('ch_feishu_copy_perms') } },
        { num: '4', text: tt('ch_feishu_step4') },
      ],
    },
    {
      id: 'dingtalk', name: 'DingTalk', icon: 'dingtalk.png',
      desc: tt('ch_dingtalk_desc'),
      inputs: [['clientid', 'client_id', 'Client ID (AppKey)', 'text', 'dingxxxxxxxx'], ['secret', 'client_secret', 'Client Secret (AppSecret)', 'password', 'Enter Client Secret']],
      guide: [
        { num: '1', text: tt('ch_dingtalk_step1'), link: { href: 'https://open-dev.dingtalk.com/fe/app', label: tt('ch_dingtalk_step1_link') } },
        { num: '2', text: tt('ch_dingtalk_step2') },
        { num: '3', text: tt('ch_dingtalk_step3') },
      ],
    },
    {
      id: 'telegram', name: 'Telegram', icon: 'telegram-icon.png',
      desc: tt('ch_telegram_desc'),
      inputs: [['token', 'bot_token', 'Bot Token', 'password', '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11']],
      guide: [
        { num: '1', text: tt('ch_telegram_step1'), link: { href: 'https://t.me/BotFather', label: tt('ch_telegram_step1_link') } },
        { num: '2', text: tt('ch_telegram_step2') },
        { num: '3', text: tt('ch_telegram_step3') },
        { num: '4', text: tt('ch_telegram_step4') },
      ],
    },
    {
      id: 'whatsapp', name: 'WhatsApp', icon: 'whatsapp-icon.png',
      desc: tt('ch_whatsapp_desc'),
      inputs: [],
      flow: 'whatsapp-qr',
    },
  ]
}

async function loadChannelsTab(container) {
  const channels = await window.klaus.channels.list()
  const stateMap = new Map(channels.map(c => [c.id, c]))
  const defs = buildChannelDefs()

  container.innerHTML = `<div class="settings-section">
    <div class="settings-section-title">${tt('channels')}</div>
    <p class="hint-text">${tt('ch_hint_desc')}</p>
    <div class="ch-grid">${defs.map(ch => {
      const state = stateMap.get(ch.id)
      const connected = !!state?.connected
      return `<div class="ch-card" data-ch-id="${ch.id}">
        <div class="ch-card-head">
          <div class="ch-card-left">
            <img src="${ch.icon}" alt="${esc(ch.name)}" width="42" height="42" class="ch-card-icon">
            <div class="ch-card-name">${esc(ch.name)}</div>
          </div>
          <button class="ch-card-btn ${connected ? 'connected' : ''}" data-ch-cfg="${ch.id}">${connected ? tt('ch_configured') : tt('ch_setup')}</button>
        </div>
        <div class="ch-card-desc">${esc(ch.desc || '')}</div>
      </div>`
    }).join('')}</div>
  </div>`

  ensureChannelModal()
  container.querySelectorAll('[data-ch-cfg]').forEach(btn => {
    btn.addEventListener('click', () => openChannelModal(btn.dataset.chCfg))
  })
}

function ensureChannelModal() {
  if (document.getElementById('ch-modal-overlay')) return
  const overlay = document.createElement('div')
  overlay.id = 'ch-modal-overlay'
  overlay.className = 'ch-modal-overlay'
  overlay.innerHTML = `<div class="ch-modal" role="dialog" aria-modal="true">
    <div class="ch-modal-header">
      <div class="ch-modal-head-left">
        <img id="ch-modal-icon" width="36" height="36" alt="" class="ch-modal-icon">
        <div>
          <div class="ch-modal-title" id="ch-modal-title"></div>
          <div class="ch-modal-desc" id="ch-modal-desc"></div>
        </div>
      </div>
      <button class="ch-modal-close" id="ch-modal-close-btn">&times;</button>
    </div>
    <div class="ch-modal-body" id="ch-modal-body"></div>
  </div>`
  document.body.appendChild(overlay)

  const close = () => {
    overlay.classList.remove('show')
    stopChannelPollers()
  }
  document.getElementById('ch-modal-close-btn').addEventListener('click', close)
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('show')) close() })
}

let wxPollTimer = null
let waPollTimer = null

function stopChannelPollers() {
  if (wxPollTimer) { clearInterval(wxPollTimer); wxPollTimer = null }
  if (waPollTimer) { clearInterval(waPollTimer); waPollTimer = null }
}

async function openChannelModal(id) {
  stopChannelPollers()
  const ch = buildChannelDefs().find(c => c.id === id)
  if (!ch) return
  const channels = await window.klaus.channels.list()
  const state = channels.find(c => c.id === id)
  const connected = !!state?.connected

  document.getElementById('ch-modal-icon').src = ch.icon
  document.getElementById('ch-modal-title').textContent = ch.name
  document.getElementById('ch-modal-desc').textContent = ch.desc || ''

  const body = document.getElementById('ch-modal-body')

  if (ch.flow === 'wechat-qr') {
    renderWechatFlow(body, connected, state)
  } else if (ch.flow === 'whatsapp-qr') {
    renderWhatsappFlow(body, connected)
  } else if (connected) {
    const details = ch.inputs.filter(i => i[3] !== 'password')
      .map(i => `<div class="ch-connected-field"><div class="ch-connected-label">${esc(i[2])}</div><div class="ch-connected-value">${esc(state?.credentials?.[i[1]] || '-')}</div></div>`).join('')
    body.innerHTML = `<div class="ch-connected">
      ${details}
      <button class="s-btn s-btn-danger" id="ch-modal-disconnect">${tt('ch_disconnect')}</button>
    </div>`
    document.getElementById('ch-modal-disconnect').addEventListener('click', async () => {
      if (!(await window.klausDialog.confirm({ message: tt('settings_confirm_delete'), danger: true }))) return
      await window.klaus.channels.disconnect(id)
      showToast(tt('settings_ch_disconnected'))
      document.getElementById('ch-modal-overlay').classList.remove('show')
      loadSettingsTab('channels')
    })
  } else {
    const guideHtml = (ch.guide || []).map(g => {
      const link = g.link ? ` <a href="${g.link.href}" target="_blank" rel="noopener" class="ch-guide-link">${esc(g.link.label)}</a>` : ''
      const action = g.action ? ` <button class="s-btn s-btn-ghost ch-guide-action" id="ch-guide-${g.action.id}">${esc(g.action.label)}</button>` : ''
      return `<div class="ch-guide-row"><span class="ch-guide-num">${g.num}.</span> <span>${esc(g.text)}</span>${link}${action}</div>`
    }).join('')

    const inputsHtml = ch.inputs.map(([key, backendKey, label, type, placeholder]) => `
      <div class="ch-form-field">
        <label class="settings-field-label">${esc(label)} <span class="ch-required">*</span></label>
        <input class="settings-field-input" id="ch-inp-${ch.id}-${key}" type="${type}" placeholder="${esc(placeholder || '')}" value="${esc(state?.credentials?.[backendKey] || '')}">
      </div>`).join('')

    body.innerHTML = `
      ${ch.guide ? `<div class="ch-guide"><div class="ch-guide-title">${tt('ch_setup_steps')}</div>${guideHtml}</div>` : ''}
      <div class="ch-form">${inputsHtml}</div>
      <div class="ch-form-actions">
        <button class="s-btn s-btn-primary" id="ch-modal-connect">${tt('ch_connect')}</button>
      </div>`

    if (ch.id === 'feishu') {
      document.getElementById('ch-guide-feishu-copy-perms')?.addEventListener('click', () => {
        navigator.clipboard.writeText(FEISHU_PERMISSIONS_JSON).then(() => showToast(tt('ch_feishu_perms_copied')))
      })
    }
    document.getElementById('ch-modal-connect').addEventListener('click', async () => {
      const btn = document.getElementById('ch-modal-connect')
      const payload = {}
      let valid = true
      for (const [key, backendKey] of ch.inputs) {
        const val = document.getElementById(`ch-inp-${ch.id}-${key}`)?.value?.trim()
        if (!val) { valid = false; break }
        payload[backendKey] = val
      }
      if (!valid) { showToast(tt('ch_fields_required')); return }
      btn.disabled = true; btn.textContent = tt('settings_ch_connecting')
      const result = await window.klaus.channels.connect(id, payload)
      if (result.ok) {
        showToast(tt('settings_ch_connect_ok'))
        document.getElementById('ch-modal-overlay').classList.remove('show')
        loadSettingsTab('channels')
      } else {
        showToast(result.error || tt('settings_ch_connect_fail'))
        btn.disabled = false; btn.textContent = tt('ch_connect')
      }
    })
  }

  document.getElementById('ch-modal-overlay').classList.add('show')
}

function closeChannelModal() {
  document.getElementById('ch-modal-overlay')?.classList.remove('show')
  stopChannelPollers()
}

// --- WeChat QR flow ---
function renderWechatFlow(body, connected, state) {
  if (connected) {
    body.innerHTML = `<div class="ch-connected">
      <div class="ch-connected-field">
        <div><div class="ch-connected-label">Account ID</div><div class="ch-connected-value">${esc(state?.credentials?.account_id || '-')}</div></div>
        <button class="s-btn s-btn-danger" id="ch-wx-disconnect">${tt('ch_disconnect')}</button>
      </div>
    </div>`
    document.getElementById('ch-wx-disconnect').addEventListener('click', async () => {
      if (!(await window.klausDialog.confirm({ message: tt('settings_confirm_delete'), danger: true }))) return
      await window.klaus.channels.disconnect('wechat')
      showToast(tt('settings_ch_disconnected'))
      closeChannelModal()
      loadSettingsTab('channels')
    })
    return
  }
  body.innerHTML = `<div class="ch-qr-wrap">
    <div class="ch-qr-hint">${tt('ch_wechat_scan_hint')}</div>
    <img id="ch-wx-qr-img" class="ch-qr-img" alt="QR Code">
    <div id="ch-wx-qr-status" class="ch-qr-status">${tt('ch_wechat_loading')}</div>
  </div>`

  window.klaus.channels.wechatQrStart().then(result => {
    if (!result.ok) {
      document.getElementById('ch-wx-qr-status').textContent = result.error || tt('settings_ch_connect_fail')
      return
    }
    document.getElementById('ch-wx-qr-img').src = result.qrcodeDataUrl
    document.getElementById('ch-wx-qr-status').textContent = tt('ch_wechat_waiting')
    wxPollTimer = setInterval(async () => {
      const r = await window.klaus.channels.wechatQrPoll()
      if (!r.ok) return
      const statusEl = document.getElementById('ch-wx-qr-status')
      if (!statusEl) { stopChannelPollers(); return }
      if (r.status === 'scaned') statusEl.textContent = tt('ch_wechat_scanned')
      else if (r.status === 'confirmed') {
        stopChannelPollers()
        showToast(tt('settings_ch_connect_ok'))
        closeChannelModal()
        loadSettingsTab('channels')
      } else if (r.status === 'expired') {
        stopChannelPollers()
        statusEl.textContent = tt('ch_wechat_expired')
      }
    }, 3000)
  })
}

// --- WhatsApp QR flow ---
function renderWhatsappFlow(body, connected) {
  if (connected) {
    body.innerHTML = `<div class="ch-connected">
      <div class="ch-connected-field">
        <div class="ch-connected-label">${tt('ch_connected')}</div>
        <button class="s-btn s-btn-danger" id="ch-wa-disconnect">${tt('ch_disconnect')}</button>
      </div>
    </div>`
    document.getElementById('ch-wa-disconnect').addEventListener('click', async () => {
      if (!(await window.klausDialog.confirm({ message: tt('settings_confirm_delete'), danger: true }))) return
      await window.klaus.channels.disconnect('whatsapp')
      showToast(tt('settings_ch_disconnected'))
      closeChannelModal()
      loadSettingsTab('channels')
    })
    return
  }
  body.innerHTML = `<div class="ch-qr-wrap">
    <div class="ch-qr-hint">${tt('ch_whatsapp_scan_hint')}</div>
    <img id="ch-wa-qr-img" class="ch-qr-img" alt="QR Code" style="display:none">
    <div id="ch-wa-qr-status" class="ch-qr-status">${tt('ch_whatsapp_loading')}</div>
  </div>`

  const updateQr = (r) => {
    const img = document.getElementById('ch-wa-qr-img')
    const statusEl = document.getElementById('ch-wa-qr-status')
    if (!img || !statusEl) return false
    if (r.status === 'connected') {
      stopChannelPollers()
      showToast(tt('settings_ch_connect_ok'))
      closeChannelModal()
      loadSettingsTab('channels')
      return true
    }
    if (r.status === 'qr' && r.qrcodeDataUrl) {
      img.src = r.qrcodeDataUrl
      img.style.display = 'block'
      statusEl.textContent = tt('ch_whatsapp_waiting')
    } else {
      statusEl.textContent = tt('ch_whatsapp_loading')
    }
    return false
  }

  window.klaus.channels.whatsappStart().then(r => {
    if (!r.ok) {
      document.getElementById('ch-wa-qr-status').textContent = r.error || tt('settings_ch_connect_fail')
      return
    }
    if (updateQr(r)) return
    waPollTimer = setInterval(async () => {
      const p = await window.klaus.channels.whatsappPoll()
      if (p.ok) updateQr(p)
    }, 3000)
  })
}

// ==================== Skills (2 tabs: market / installed) ====================
// Note: QoderWork has a 3rd "built-in" tab for system skills, but Klaus has no
// such concept — listAll() only surfaces user-installed skills — so we ship 2.
async function loadSkillsTab(container) {
  const [installed, market] = await Promise.all([window.klaus.skills.list(), window.klaus.skills.market()])

  const userInstalled = installed

  // Guard against stale state (user was on the old 'builtin' tab before upgrade)
  if (skillsView !== 'market' && skillsView !== 'installed') skillsView = 'market'

  const tabs = [
    { key: 'market', label: tt('skills_tab_market'), count: market.length, showBadge: false },
    { key: 'installed', label: tt('skills_tab_installed'), count: userInstalled.length, showBadge: userInstalled.length > 0 },
  ]

  const baseList = skillsView === 'market' ? market : userInstalled
  const filtered = applySkillsFilters(baseList, skillsView)

  const refreshSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 5a5.5 5.5 0 1 0 .5 4"/><polyline points="13.5,2 13.5,5 10.5,5"/></svg>`
  const searchSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></svg>`
  const klausSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v1m0 10v1m-6-6h1m10 0h1m-8.5-4.5l.7.7m5.6 5.6l.7.7m0-7l-.7.7m-5.6 5.6l-.7.7"/><circle cx="8" cy="8" r="2.5"/></svg>`
  const plusSvg = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>`

  container.innerHTML = `
    <div class="settings-section sk-section">
      <div class="sk-topbar">
        <button class="cron-icon-btn" id="sk-refresh" title="${tt('skills_refresh')}" aria-label="${tt('skills_refresh')}">${refreshSvg}</button>
        <div class="sk-search-wrap">
          <span class="sk-search-icon">${searchSvg}</span>
          <input type="text" id="sk-search" class="sk-search-input" placeholder="${tt('skills_search_ph')}" value="${esc(skillsSearchQuery)}">
        </div>
        <button class="cron-pill-btn" id="sk-via-klaus">${klausSvg}<span>${tt('skills_via_klaus')}</span></button>
        <button class="cron-new-btn" id="sk-upload-btn">${plusSvg}<span>${tt('skills_install_btn')}</span></button>
      </div>

      <div class="sk-tabbar">
        <div class="sk-tabs">
          ${tabs.map(t => `<button class="sk-tab ${skillsView === t.key ? 'active' : ''}" data-skill-tab="${t.key}">${esc(t.label)}${t.showBadge ? ` <span class="sk-tab-count">${t.count}</span>` : ''}</button>`).join('')}
        </div>
        ${skillsView === 'installed' ? `
          <div class="sk-filters">
            <div id="sk-filter" class="kls-select"></div>
          </div>` : ''}
      </div>

      ${skillsView === 'market' ? `<div class="sk-section-label">${tt('skills_section_official')}</div>` : ''}
      <div class="sk-grid" id="sk-grid">${renderSkillCards(filtered, skillsView)}</div>

      <!-- Upload modal -->
      <div id="sk-upload-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1100;align-items:center;justify-content:center">
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
    </div>`

  bindSkillEvents()
  bindSkillTopbarEvents()
}

function applySkillsFilters(list, view) {
  let out = list
  if (view === 'installed') {
    if (skillsFilter === 'enabled') out = out.filter(s => s.userEnabled)
    else if (skillsFilter === 'disabled') out = out.filter(s => !s.userEnabled)
  }
  const q = skillsSearchQuery.trim().toLowerCase()
  if (q) {
    out = out.filter(s => {
      const n = (s.name || '').toLowerCase()
      const d = (s.description || '').toLowerCase()
      return n.includes(q) || d.includes(q)
    })
  }
  return out
}

function renderSkillCards(skills, view) {
  if (skills.length === 0) return `<p class="empty-text sk-empty">${tt('no_skills') || 'No skills found'}</p>`
  return skills.map(s => {
    const isMarket = view === 'market'
    const toggle = view === 'installed' ? `<label class="sk-toggle"><input type="checkbox" class="sk-toggle-input" data-skill="${esc(s.dirName || s.name)}" ${s.userEnabled ? 'checked' : ''}><span class="sk-slider"></span></label>` : ''
    const installBtn = isMarket ? `<button class="btn-xs ${s.installed ? '' : 'btn-primary'}" data-install="${esc(s.dirName || s.name)}" ${s.installed ? 'disabled' : ''}>${s.installed ? tt('installed') : tt('settings_skills_install') || tt('skills_install_btn')}</button>` : ''
    const uninstallBtn = view === 'installed' && s.source === 'installed' ? `<button class="btn-xs btn-danger" data-uninstall="${esc(s.dirName || s.name)}">${tt('settings_skills_uninstall')}</button>` : ''
    const emoji = s.emoji || '🧩'
    return `<div class="sk-card" data-name="${esc(s.name)}">
      <div class="sk-card-head"><div class="sk-card-info"><div class="sk-card-emoji">${esc(emoji)}</div><div class="sk-card-name">${esc(s.name)}</div></div>${toggle}</div>
      <div class="sk-card-desc">${esc(s.description || '')}</div>
      ${installBtn || uninstallBtn ? `<div class="sk-card-actions">${installBtn}${uninstallBtn}</div>` : ''}
    </div>`
  }).join('')
}

function bindSkillTopbarEvents() {
  // Tab switching
  document.querySelectorAll('[data-skill-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      skillsView = btn.dataset.skillTab
      loadSettingsTab('skills')
    })
  })
  // Filter dropdown (installed tab only)
  const skFilterEl = document.getElementById('sk-filter')
  if (skFilterEl) {
    window.klsSelect.bind(skFilterEl, {
      items: [
        { value: 'all',      i18nKey: 'skills_filter_all' },
        { value: 'enabled',  i18nKey: 'skills_filter_enabled' },
        { value: 'disabled', i18nKey: 'skills_filter_disabled' },
      ],
      value: skillsFilter,
      onChange: (v) => { skillsFilter = v; loadSettingsTab('skills') },
    })
  }
  // Search box — debounced reload so input focus survives
  const searchInput = document.getElementById('sk-search')
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      skillsSearchQuery = searchInput.value
      clearTimeout(window.__skSearchTimer)
      window.__skSearchTimer = setTimeout(() => {
        loadSettingsTab('skills')
        // Restore focus + caret after rerender
        setTimeout(() => {
          const el = document.getElementById('sk-search')
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
        }, 0)
      }, 180)
    })
  }
  // Refresh
  document.getElementById('sk-refresh')?.addEventListener('click', (e) => {
    const btn = e.currentTarget
    btn.classList.add('spinning')
    loadSettingsTab('skills')
    setTimeout(() => btn.classList.remove('spinning'), 600)
  })
  // Create via Klaus — mirror cron.js pattern
  document.getElementById('sk-via-klaus')?.addEventListener('click', createSkillViaKlaus)
  // Upload modal trigger
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

function createSkillViaKlaus() {
  const seed = tt('skills_via_klaus_seed') || 'Help me create a skill. First, ask me what the skill should do.'
  // Close settings overlay
  if (settingsVisible) toggleSettings()
  // Fresh chat, then seed the prompt after DOM settles
  setTimeout(() => {
    try { document.getElementById('btn-new-chat')?.click() } catch {}
    setTimeout(() => {
      const inp = document.getElementById('input')
      if (inp) {
        inp.value = seed
        inp.dispatchEvent(new Event('input'))
        inp.focus()
      }
    }, 100)
  }, 50)
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
      el.disabled = true; el.textContent = tt('settings_skills_uploading')
      const result = await window.klaus.skills.install(el.dataset.install)
      if (result.ok) { showToast(tt('settings_skills_installed_toast') + ': ' + result.name); loadSettingsTab('skills') }
      else { showToast(tt('toast_error_prefix') + (result.error || tt('toast_unknown'))); el.disabled = false; el.textContent = tt('skills_install_btn') }
    })
  })
  document.querySelectorAll('[data-uninstall]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!(await window.klausDialog.confirm({
        message: tt('settings_skills_uninstall') + ': ' + el.dataset.uninstall + '?',
        danger: true,
      }))) return
      await window.klaus.skills.uninstall(el.dataset.uninstall)
      showToast(tt('settings_skills_uninstalled_toast')); loadSettingsTab('skills')
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


// ==================== MCP (full management) ====================
function mcpLocalizedText(item) {
  const lang = document.documentElement.lang || 'zh'
  const isZh = typeof lang === 'string' && lang.toLowerCase().startsWith('zh')
  return { name: isZh ? item.nameZh : item.nameEn, desc: isZh ? item.descZh : item.descEn }
}

function mcpStatusDot(status) {
  if (!status) return 'mcp-dot-gray'
  if (status.status === 'connected') return 'mcp-dot-green'
  if (status.status === 'needs-auth') return 'mcp-dot-yellow'
  if (status.status === 'pending') return 'mcp-dot-gray'
  return 'mcp-dot-red'
}

async function loadMcpTab(container) {
  const [servers, status, builtin] = await Promise.all([
    window.klaus.mcp.list(),
    window.klaus.mcp.status(),
    window.klaus.mcp.builtinList(),
  ])
  const statusMap = new Map(status.map(s => [s.name, s]))
  const builtinIds = new Set(builtin.map(b => b.id))
  const customServers = servers.filter(s => !builtinIds.has(s.name))

  container.innerHTML = `
    <div class="settings-section mcp-section">
      <div class="mcp-head">
        <div>
          <h2 class="mcp-title">${tt('mcp')}</h2>
          <p class="mcp-subtitle">${tt('mcp_subtitle')} <em>${tt('mcp_banner')}</em></p>
        </div>
        <button class="mcp-refresh-btn" id="mcp-refresh" title="${tt('settings_mcp_reconnect')}" aria-label="${tt('settings_mcp_reconnect')}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
            <path d="M21 21v-5h-5"/>
          </svg>
        </button>
      </div>

      <div class="mcp-add-card">
        <div class="mcp-add-card-info">
          <div class="mcp-add-card-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </div>
          <div>
            <div class="mcp-add-card-title">${tt('mcp_add_title')}</div>
            <div class="mcp-add-card-desc">${tt('mcp_add_desc')}</div>
          </div>
        </div>
        <div class="mcp-add-dropdown">
          <button class="mcp-add-btn" id="mcp-add-btn">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
            <span>${tt('mcp_add')}</span>
          </button>
          <div class="mcp-add-menu" id="mcp-add-menu" hidden>
            <button class="mcp-add-menu-item" data-action="manual">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              <span>${tt('mcp_add_manual')}</span>
            </button>
            <button class="mcp-add-menu-item" data-action="json">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              <span>${tt('mcp_add_json')}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="mcp-group-title">${tt('mcp_custom_servers')}</div>
      <div class="mcp-list" id="mcp-custom-list">${
        customServers.length === 0
          ? `<div class="mcp-empty">${tt('mcp_no_custom')}</div>`
          : customServers.map(s => renderMcpRow(s, statusMap.get(s.name))).join('')
      }</div>

      <div class="mcp-group-title">${tt('mcp_builtin_servers')}</div>
      <div class="mcp-list" id="mcp-builtin-list">${
        builtin.map(b => renderBuiltinRow(b, statusMap.get(b.id))).join('')
      }</div>
    </div>
  `

  bindMcpEvents(container)
}

function renderMcpRow(server, status) {
  const cfg = server.config || {}
  const type = cfg.type || 'stdio'
  const detail = type === 'stdio'
    ? (cfg.command || '') + (cfg.args ? ' ' + cfg.args.join(' ') : '')
    : cfg.url || ''
  const statusClass = mcpStatusDot(status)
  const toolCount = status?.toolCount ?? 0
  const hasError = !!status?.error
  const isOauth = type === 'sse' || type === 'http'

  return `
    <div class="mcp-row" data-name="${esc(server.name)}">
      <div class="mcp-row-main">
        <button class="mcp-expand-btn" data-action="expand" aria-expanded="false" aria-label="expand">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 10 8 6 12"/></svg>
        </button>
        <span class="mcp-dot ${statusClass}" aria-hidden="true"></span>
        <div class="mcp-row-name">
          <span class="mcp-name-text">${esc(server.name)}</span>
        </div>
        <div class="mcp-row-actions">
          ${hasError ? `<button class="mcp-action-btn mcp-action-primary" data-action="diagnose">${tt('mcp_diagnose')}</button>` : ''}
          ${isOauth ? `<button class="mcp-action-btn" data-action="reset">${tt('mcp_reset')}</button>` : ''}
          <span class="mcp-tool-count">${toolCount} tools</span>
          <label class="mcp-toggle" title="${server.enabled ? tt('enabled') : tt('disabled')}">
            <input type="checkbox" data-action="toggle" ${server.enabled ? 'checked' : ''}>
            <span class="mcp-toggle-slider"></span>
          </label>
          <button class="mcp-icon-btn" data-action="edit" title="${tt('mcp_edit')}" aria-label="edit">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="mcp-icon-btn" data-action="delete" title="${tt('delete_title') || 'Delete'}" aria-label="delete">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </div>
      ${hasError ? `<div class="mcp-error-line" title="${esc(status.error)}">${esc(status.error)}</div>` : ''}
      <div class="mcp-row-expand" data-expand-target hidden>
        <div class="mcp-row-detail">
          <span class="mcp-meta-label">Type</span><span class="mcp-meta-value">${esc(type.toUpperCase())}</span>
          <span class="mcp-meta-label">Target</span><span class="mcp-meta-value mcp-meta-mono">${esc(detail) || '—'}</span>
        </div>
        <div class="mcp-tools-header">Tools (${toolCount})</div>
        <div class="mcp-tools-list">${
          status?.tools?.length
            ? status.tools.map(t => `
                <div class="mcp-tool-item">
                  <div class="mcp-tool-name">${esc(t.name)}</div>
                  ${t.description ? `<div class="mcp-tool-desc">${esc(t.description)}</div>` : ''}
                </div>`).join('')
            : `<div class="mcp-tool-empty">${tt('mcp_empty_tools')}</div>`
        }</div>
      </div>
    </div>
  `
}

function renderBuiltinRow(b, status) {
  const text = mcpLocalizedText(b)
  const installed = b.installed
  const enabled = b.enabled
  const statusClass = installed ? mcpStatusDot(status) : ''
  const toolCount = status?.toolCount ?? 0
  const hasError = installed && !!status?.error
  const isOauth = b.auth === 'oauth'

  return `
    <div class="mcp-row mcp-row-builtin" data-name="${esc(b.id)}" data-builtin-id="${esc(b.id)}">
      <div class="mcp-row-main">
        ${installed ? `
          <button class="mcp-expand-btn" data-action="expand" aria-expanded="false" aria-label="expand">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 10 8 6 12"/></svg>
          </button>` : '<span class="mcp-expand-placeholder"></span>'}
        <div class="mcp-logo">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${b.iconSvg || ''}</svg>
        </div>
        <div class="mcp-row-name mcp-row-name-stacked">
          <div class="mcp-name-row">
            <span class="mcp-name-text">${esc(text.name)}</span>
            ${installed && status?.status === 'connected' ? `<span class="mcp-dot ${statusClass} mcp-dot-inline"></span>` : ''}
          </div>
          <div class="mcp-builtin-desc">${esc(text.desc)}</div>
        </div>
        <div class="mcp-row-actions">
          ${installed && hasError ? `<button class="mcp-action-btn mcp-action-primary" data-action="diagnose">${tt('mcp_diagnose')}</button>` : ''}
          ${installed && isOauth ? `<button class="mcp-action-btn" data-action="reset">${tt('mcp_reset')}</button>` : ''}
          ${installed ? `<span class="mcp-tool-count">${toolCount} tools</span>` : ''}
          <label class="mcp-toggle">
            <input type="checkbox" data-action="${installed ? 'toggle' : 'install'}" ${enabled ? 'checked' : ''}>
            <span class="mcp-toggle-slider"></span>
          </label>
          ${installed ? `
            <button class="mcp-icon-btn" data-action="edit" title="${tt('mcp_edit')}" aria-label="edit">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="mcp-icon-btn" data-action="delete" title="${tt('delete_title') || 'Delete'}" aria-label="delete">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
      ${hasError ? `<div class="mcp-error-line" title="${esc(status.error)}">${esc(status.error)}</div>` : ''}
      ${installed ? `
        <div class="mcp-row-expand" data-expand-target hidden>
          <div class="mcp-tools-header">Tools (${toolCount})</div>
          <div class="mcp-tools-list">${
            status?.tools?.length
              ? status.tools.map(t => `
                  <div class="mcp-tool-item">
                    <div class="mcp-tool-name">${esc(t.name)}</div>
                    ${t.description ? `<div class="mcp-tool-desc">${esc(t.description)}</div>` : ''}
                  </div>`).join('')
              : `<div class="mcp-tool-empty">${tt('mcp_empty_tools')}</div>`
          }</div>
        </div>` : ''}
    </div>
  `
}

function bindMcpEvents(container) {
  container.querySelector('#mcp-refresh')?.addEventListener('click', async () => {
    await window.klaus.mcp.reconnect()
    showToast(tt('toast_reconnected') || tt('settings_mcp_reconnect'))
    loadSettingsTab('mcp')
  })

  const addBtn = container.querySelector('#mcp-add-btn')
  const addMenu = container.querySelector('#mcp-add-menu')
  addBtn?.addEventListener('click', (e) => {
    e.stopPropagation()
    if (addMenu) addMenu.hidden = !addMenu.hidden
  })
  addMenu?.addEventListener('click', (e) => {
    const btn = e.target.closest('.mcp-add-menu-item')
    if (!btn) return
    addMenu.hidden = true
    if (btn.dataset.action === 'manual') openMcpEditModal(null)
    else if (btn.dataset.action === 'json') openMcpJsonModal()
  })
  const hideMenu = (e) => { if (addMenu && !addMenu.contains(e.target) && e.target !== addBtn) addMenu.hidden = true }
  document.addEventListener('click', hideMenu)

  container.querySelectorAll('.mcp-row').forEach(row => {
    const name = row.dataset.name
    const builtinId = row.dataset.builtinId

    row.querySelector('[data-action="expand"]')?.addEventListener('click', () => {
      const tgt = row.querySelector('[data-expand-target]')
      if (!tgt) return
      const showing = !tgt.hidden
      tgt.hidden = showing
      const btn = row.querySelector('[data-action="expand"]')
      btn.setAttribute('aria-expanded', String(!showing))
      btn.classList.toggle('mcp-expand-open', !showing)
    })

    row.querySelector('[data-action="toggle"]')?.addEventListener('change', async (e) => {
      await window.klaus.mcp.toggle(name, e.target.checked)
      showToast(e.target.checked ? (tt('enabled') || 'Enabled') : (tt('disabled') || 'Disabled'))
      setTimeout(() => loadSettingsTab('mcp'), 300)
    })

    row.querySelector('[data-action="install"]')?.addEventListener('change', (e) => {
      const checked = e.target.checked
      e.target.checked = false
      if (checked && builtinId) openBuiltinInstallModal(builtinId)
    })

    row.querySelector('[data-action="edit"]')?.addEventListener('click', async () => {
      const list = await window.klaus.mcp.list()
      const entry = list.find(x => x.name === name)
      if (entry) openMcpEditModal(entry)
    })

    row.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      if (!(await window.klausDialog.confirm({
        message: tt('settings_mcp_delete_confirm') + ': ' + name + '?',
        danger: true,
      }))) return
      await window.klaus.mcp.remove(name)
      showToast(tt('settings_deleted') || 'Deleted')
      loadSettingsTab('mcp')
    })

    row.querySelector('[data-action="reset"]')?.addEventListener('click', async () => {
      if (!(await window.klausDialog.confirm(tt('mcp_reset_confirm')))) return
      const r = await window.klaus.mcp.revokeAuth(name)
      if (r?.ok) { showToast(tt('mcp_reset_done')); setTimeout(() => loadSettingsTab('mcp'), 400) }
      else showToast(r?.error || tt('settings_failed') || 'Failed')
    })

    row.querySelector('[data-action="diagnose"]')?.addEventListener('click', async () => {
      const status = await window.klaus.mcp.status()
      const s = status.find(x => x.name === name)
      openMcpDiagnoseModal(name, s?.error || 'Unknown error')
    })
  })
}

function openMcpEditModal(existing) {
  const isEdit = !!existing
  const cfg = existing?.config || {}
  const type = cfg.type || 'stdio'
  const cmdStr = type === 'stdio'
    ? (cfg.command || '') + (cfg.args ? ' ' + cfg.args.join(' ') : '')
    : ''
  const url = cfg.url || ''
  const envEntries = Object.entries(cfg.env || {})
  const timeout = cfg.timeout || ''

  const modal = document.createElement('div')
  modal.className = 'mcp-modal-overlay'
  modal.innerHTML = `
    <div class="mcp-modal">
      <div class="mcp-modal-head">
        <div>
          <h3 class="mcp-modal-title">${isEdit ? tt('mcp_edit_title') : tt('mcp_add_modal_title')}</h3>
          ${isEdit ? '' : `<p class="mcp-modal-subtitle">${tt('mcp_add_modal_subtitle')}</p>`}
        </div>
        <button class="mcp-modal-close" data-close aria-label="close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="mcp-modal-body">
        <div class="mcp-field">
          <label class="mcp-field-label">${tt('mcp_field_type')}</label>
          <div id="mcpm-type" class="kls-select kls-select-block"></div>
        </div>
        <div class="mcp-field">
          <label class="mcp-field-label">${tt('mcp_field_name')} <span class="mcp-required">*</span></label>
          <input class="mcp-input" id="mcpm-name" placeholder="${tt('mcp_field_name_placeholder')}" value="${esc(existing?.name || '')}" ${isEdit ? 'readonly' : ''}>
        </div>
        <div class="mcp-field" id="mcpm-cmd-wrap" ${type !== 'stdio' ? 'hidden' : ''}>
          <label class="mcp-field-label">${tt('mcp_field_command')} <span class="mcp-required">*</span></label>
          <textarea class="mcp-input mcp-input-area" id="mcpm-cmd" rows="2" placeholder="npx -y @modelcontextprotocol/server-filesystem">${esc(cmdStr)}</textarea>
          <div class="mcp-field-hint">${tt('mcp_field_command_hint')}</div>
        </div>
        <div class="mcp-field" id="mcpm-url-wrap" ${type === 'stdio' ? 'hidden' : ''}>
          <label class="mcp-field-label">${tt('mcp_field_url')} <span class="mcp-required">*</span></label>
          <input class="mcp-input" id="mcpm-url" placeholder="https://..." value="${esc(url)}">
        </div>
        <div class="mcp-field">
          <label class="mcp-field-label mcp-field-label-row">
            <span>${tt('mcp_field_env')} <span class="mcp-field-optional">${tt('mcp_field_env_optional')}</span></span>
            <button class="mcp-field-inline-btn" id="mcpm-env-paste">${tt('mcp_field_env_paste')}</button>
          </label>
          <div id="mcpm-env-rows"></div>
          <button class="mcp-field-add-btn" id="mcpm-env-add">${tt('mcp_field_env_add')}</button>
        </div>
        <div class="mcp-field">
          <label class="mcp-field-label">${tt('mcp_field_timeout')} <span class="mcp-field-optional">${tt('mcp_field_timeout_optional')}</span></label>
          <input class="mcp-input" id="mcpm-timeout" type="number" placeholder="60" value="${esc(String(timeout))}">
        </div>
      </div>
      <div class="mcp-modal-foot">
        <button class="mcp-submit-btn" id="mcpm-submit">${isEdit ? tt('mcp_save_submit') : tt('mcp_add_submit')}</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)

  const cmdWrap = modal.querySelector('#mcpm-cmd-wrap')
  const urlWrap = modal.querySelector('#mcpm-url-wrap')
  const typeSel = window.klsSelect.bind(modal.querySelector('#mcpm-type'), {
    items: [
      { value: 'stdio', label: 'STDIO' },
      { value: 'sse',   label: 'SSE' },
      { value: 'http',  label: 'HTTP' },
    ],
    value: type,
    disabled: isEdit,
    onChange: (v) => {
      cmdWrap.hidden = v !== 'stdio'
      urlWrap.hidden = v === 'stdio'
    },
  })

  const envRows = modal.querySelector('#mcpm-env-rows')
  const appendEnvRow = (k, v) => {
    const row = document.createElement('div')
    row.className = 'mcp-env-row'
    row.innerHTML = `
      <input class="mcp-input" placeholder="KEY" value="${esc(k || '')}" data-ek>
      <input class="mcp-input" placeholder="value" value="${esc(v || '')}" data-ev>
      <button class="mcp-env-del" aria-label="remove">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="4" y1="12" x2="12" y2="4"/></svg>
      </button>
    `
    row.querySelector('.mcp-env-del').addEventListener('click', () => row.remove())
    envRows.appendChild(row)
  }
  if (envEntries.length) envEntries.forEach(([k, v]) => appendEnvRow(k, String(v)))
  modal.querySelector('#mcpm-env-add').addEventListener('click', () => appendEnvRow('', ''))
  modal.querySelector('#mcpm-env-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText()
      text.trim().split('\n').forEach(line => {
        const eq = line.indexOf('=')
        if (eq > 0) appendEnvRow(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
      })
    } catch {}
  })

  const closeModal = () => modal.remove()
  modal.querySelector('[data-close]').addEventListener('click', closeModal)
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal() })

  modal.querySelector('#mcpm-submit').addEventListener('click', async () => {
    const name = modal.querySelector('#mcpm-name').value.trim()
    if (!name) { showToast(tt('settings_mcp_name_required')); return }
    const t = typeSel.getValue()
    const newCfg = {}
    if (t === 'stdio') {
      const cmd = modal.querySelector('#mcpm-cmd').value.trim()
      if (!cmd) { showToast('Command required'); return }
      const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) || [cmd]
      newCfg.command = parts[0].replace(/^"|"$/g, '')
      if (parts.length > 1) newCfg.args = parts.slice(1).map(p => p.replace(/^"|"$/g, ''))
    } else {
      const u = modal.querySelector('#mcpm-url').value.trim()
      if (!u) { showToast('URL required'); return }
      newCfg.type = t
      newCfg.url = u
    }
    const env = {}
    modal.querySelectorAll('#mcpm-env-rows .mcp-env-row').forEach(r => {
      const k = r.querySelector('[data-ek]').value.trim()
      const v = r.querySelector('[data-ev]').value
      if (k) env[k] = v
    })
    if (Object.keys(env).length) newCfg.env = env
    const to = parseInt(modal.querySelector('#mcpm-timeout').value)
    if (to > 0) newCfg.timeout = to

    let result
    if (isEdit) {
      result = await window.klaus.mcp.update(name, newCfg)
    } else {
      result = await window.klaus.mcp.create({ name, ...newCfg })
    }
    if (result?.ok) {
      showToast(tt('settings_saved') || 'Saved')
      closeModal()
      loadSettingsTab('mcp')
    } else {
      showToast(result?.error || tt('settings_failed') || 'Failed')
    }
  })
}

function openMcpJsonModal() {
  const modal = document.createElement('div')
  modal.className = 'mcp-modal-overlay'
  modal.innerHTML = `
    <div class="mcp-modal">
      <div class="mcp-modal-head">
        <div>
          <h3 class="mcp-modal-title">${tt('mcp_json_modal_title')}</h3>
          <p class="mcp-modal-subtitle">${tt('mcp_json_modal_subtitle')}</p>
        </div>
        <button class="mcp-modal-close" data-close aria-label="close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="mcp-modal-body">
        <textarea class="mcp-input mcp-input-json" id="mcpm-json" rows="14" spellcheck="false" placeholder="${esc(tt('mcp_json_placeholder'))}"></textarea>
      </div>
      <div class="mcp-modal-foot">
        <button class="mcp-submit-btn" id="mcpm-json-submit">${tt('mcp_json_submit')}</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  const closeModal = () => modal.remove()
  modal.querySelector('[data-close]').addEventListener('click', closeModal)
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal() })
  modal.querySelector('#mcpm-json-submit').addEventListener('click', async () => {
    const raw = modal.querySelector('#mcpm-json').value.trim()
    if (!raw) return
    const r = await window.klaus.mcp.importJson(raw)
    if (r.imported?.length) showToast((tt('settings_mcp_imported') || 'Imported') + ': ' + r.imported.join(', '))
    if (r.errors?.length) showToast(r.errors.join('; '))
    closeModal()
    loadSettingsTab('mcp')
  })
}

function openBuiltinInstallModal(builtinId) {
  window.klaus.mcp.builtinList().then(list => {
    const entry = list.find(x => x.id === builtinId)
    if (!entry) return
    const text = mcpLocalizedText(entry)
    const modal = document.createElement('div')
    modal.className = 'mcp-modal-overlay'
    modal.innerHTML = `
      <div class="mcp-modal">
        <div class="mcp-modal-head">
          <div class="mcp-modal-head-with-logo">
            <div class="mcp-logo mcp-logo-lg">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${entry.iconSvg || ''}</svg>
            </div>
            <div>
              <h3 class="mcp-modal-title">${esc(tt('mcp_builtin_install_title')(text.name))}</h3>
              <p class="mcp-modal-subtitle">${esc(text.desc)}</p>
            </div>
          </div>
          <button class="mcp-modal-close" data-close aria-label="close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="mcp-modal-body">
          ${entry.auth === 'oauth' ? `<div class="mcp-banner mcp-banner-muted"><span>${tt('mcp_needs_auth')}</span></div>` : ''}
          ${(entry.envKeys || []).map(k => `
            <div class="mcp-field">
              <label class="mcp-field-label">${esc(k.label)}</label>
              <input class="mcp-input" type="${k.secret ? 'password' : 'text'}" data-envkey="${esc(k.key)}" placeholder="${esc(k.key)}">
            </div>
          `).join('')}
          ${!(entry.envKeys || []).length ? `<p class="mcp-field-hint">${tt('mcp_builtin_install_desc')}</p>` : ''}
        </div>
        <div class="mcp-modal-foot">
          <button class="mcp-submit-btn" id="mcpm-install">${tt('mcp_builtin_install')}</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
    const closeModal = () => modal.remove()
    modal.querySelector('[data-close]').addEventListener('click', closeModal)
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal() })
    modal.querySelector('#mcpm-install').addEventListener('click', async () => {
      const env = {}
      modal.querySelectorAll('[data-envkey]').forEach(el => { env[el.dataset.envkey] = el.value })
      const r = await window.klaus.mcp.builtinInstall(builtinId, env)
      if (r?.ok) { showToast(tt('settings_saved') || 'Enabled'); closeModal(); loadSettingsTab('mcp') }
      else showToast(r?.error || 'Failed')
    })
  })
}

function openMcpDiagnoseModal(name, errText) {
  const modal = document.createElement('div')
  modal.className = 'mcp-modal-overlay'
  modal.innerHTML = `
    <div class="mcp-modal">
      <div class="mcp-modal-head">
        <div>
          <h3 class="mcp-modal-title">${tt('mcp_diagnose_title')}</h3>
          <p class="mcp-modal-subtitle">${esc(name)}</p>
        </div>
        <button class="mcp-modal-close" data-close aria-label="close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="mcp-modal-body">
        <pre class="mcp-diagnose-text">${esc(errText)}</pre>
      </div>
      <div class="mcp-modal-foot">
        <button class="mcp-submit-btn mcp-submit-secondary" id="mcpm-diag-copy">${tt('mcp_diagnose_copy')}</button>
        <button class="mcp-submit-btn" id="mcpm-diag-retry">${tt('mcp_diagnose_retry')}</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  const closeModal = () => modal.remove()
  modal.querySelector('[data-close]').addEventListener('click', closeModal)
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal() })
  modal.querySelector('#mcpm-diag-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(errText).then(() => showToast(tt('mcp_diagnose_copied'))).catch(() => {})
  })
  modal.querySelector('#mcpm-diag-retry').addEventListener('click', async () => {
    await window.klaus.mcp.reconnect()
    closeModal()
    loadSettingsTab('mcp')
  })
}

// ==================== Connectors (Klaus built-in integrations) ====================
// 独立于 MCP：零配置，Klaus 官方策展，per-connector 三态权限。
// 数据源：window.klaus.connectors.list() / .status() / .toggle() / .setPolicy()

// Line-style SVG icons matching QoderWork's macOS connectors visual language.
// Keyed by connector id / group id. Rendered inline so they inherit currentColor
// and theme well.
const CONNECTOR_ICONS = {
  // Apple logo for the macOS group head
  'group:macos': '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17.05 12.69c-.02-2.04 1.67-3.02 1.74-3.07-.95-1.39-2.43-1.58-2.96-1.6-1.26-.13-2.46.74-3.1.74-.65 0-1.63-.72-2.69-.7-1.38.02-2.66.81-3.37 2.05-1.44 2.5-.37 6.18 1.03 8.2.69 1 1.49 2.11 2.55 2.07 1.03-.04 1.42-.66 2.66-.66 1.24 0 1.59.66 2.67.64 1.1-.02 1.8-1 2.48-2.01.78-1.15 1.1-2.27 1.12-2.33-.02-.01-2.15-.83-2.13-3.29zM15.01 7.4c.56-.69.95-1.63.84-2.58-.81.03-1.8.54-2.39 1.21-.53.6-1 1.57-.87 2.49.91.07 1.83-.46 2.42-1.12z"/></svg>',
  // Reminders — notepad with a ring tab on top
  'macos-reminders': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M11 3h2a1 1 0 011 1v1H10V4a1 1 0 011-1z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="15" y2="14"/><line x1="9" y1="18" x2="13" y2="18"/></svg>',
  // Calendar — box with two binding dots on top
  'macos-calendar': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
  // Notes — notebook with a spine on the left
  'macos-notes': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="13" height="18" rx="1.5"/><line x1="6" y1="8" x2="9" y2="8"/><line x1="6" y1="12" x2="9" y2="12"/><line x1="6" y1="16" x2="9" y2="16"/></svg>',
  // Mail — envelope
  'macos-mail': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 8l9 6 9-6"/></svg>',
  // Contacts — address book with side tabs
  'macos-contacts': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="13" height="18" rx="1.5"/><circle cx="11.5" cy="10.5" r="2.2"/><path d="M8 17c0-2 1.6-3.2 3.5-3.2s3.5 1.2 3.5 3.2"/><line x1="18" y1="7" x2="20" y2="7"/><line x1="18" y1="12" x2="20" y2="12"/><line x1="18" y1="17" x2="20" y2="17"/></svg>',
  // Messages — speech bubble
  'macos-messages': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8c-1.3 0-2.6-.3-3.7-.9L4 20l1-3.5C4.4 15 4 13.6 4 12z"/></svg>',
  // Safari — compass
  'macos-safari': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="16,8 10.5,10.5 8,16 13.5,13.5" fill="currentColor" stroke="none"/></svg>',
  // Shortcuts — lightning bolt in a rounded square
  'macos-shortcuts': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M13 6l-5 8h3l-1 4 5-8h-3l1-4z" fill="currentColor" stroke="none"/></svg>',
  // Finder — stylized face (smile)
  'macos-finder': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><line x1="9" y1="9" x2="9" y2="11"/><line x1="15" y1="9" x2="15" y2="11"/><path d="M9 15c1 1 2 1.5 3 1.5s2-.5 3-1.5"/></svg>',
  // System tools — wrench
  'macos-system': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 00-5.4 5.4l-6 6 2 2 6-6a4 4 0 005.4-5.4l-2.5 2.5-2-2 2.5-2.5z"/></svg>',
}

function connectorIcon(key) {
  return CONNECTOR_ICONS[key] || ''
}

async function loadConnectorsTab(container) {
  const [items, statuses] = await Promise.all([
    window.klaus.connectors.list(),
    window.klaus.connectors.status().catch(() => []),
  ])
  const statusMap = new Map(statuses.map(s => ({ name: s.name, ...s })).map(s => [s.name, s]))

  // Group by catalog group field (currently just 'macos'; forward-compatible)
  const groups = new Map()
  for (const c of items) {
    if (!c.availableOnThisPlatform) continue
    if (!groups.has(c.group)) groups.set(c.group, [])
    groups.get(c.group).push(c)
  }

  const groupTitles = { macos: tt('connectors_group_macos') }

  const groupsHtml = [...groups.entries()].map(([groupId, list]) => {
    const enabledCount = list.filter(c => c.enabled).length
    const rows = list.map(c => renderConnectorRow(c, statusMap.get(`klaus-${c.id}`))).join('')
    return `
      <div class="connector-group" data-group="${esc(groupId)}">
        <button class="connector-group-head" data-toggle-group="${esc(groupId)}">
          <span class="connector-group-icon">${connectorIcon('group:' + groupId)}</span>
          <span class="connector-group-title">${esc(groupTitles[groupId] || groupId)}</span>
          <span class="connector-group-count">${tt('connectors_enabled_count').replace('{n}', enabledCount).replace('{total}', list.length)}</span>
          <svg class="connector-group-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,6 8,10 12,6"/></svg>
        </button>
        <div class="connector-group-body">${rows}</div>
      </div>
    `
  }).join('')

  container.innerHTML = `
    <div class="connectors-wrap">
      <h1 class="connectors-title">${tt('connectors')}</h1>
      <p class="connectors-subtitle">${tt('connectors_subtitle')} <em>${tt('connectors_banner')}</em></p>
      ${groups.size === 0 ? `<div class="connectors-empty">${tt('connectors_empty_platform')}</div>` : groupsHtml}
    </div>
  `

  // Expand/collapse group
  container.querySelectorAll('[data-toggle-group]').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.connector-group')
      group.classList.toggle('collapsed')
    })
  })

  // Per-connector switch — enable/disable
  container.querySelectorAll('[data-connector-toggle]').forEach(input => {
    input.addEventListener('change', async () => {
      const id = input.dataset.connectorToggle
      const enabled = input.checked
      const r = await window.klaus.connectors.toggle(id, enabled)
      if (!r?.ok) {
        input.checked = !enabled
        showToast(r?.error || tt('settings_failed'))
        return
      }
      showToast(enabled ? tt('enabled') : tt('disabled'))
      // Reconnect happens in main; re-load to refresh status/tool counts.
      setTimeout(() => loadSettingsTab('connectors'), 400)
    })
  })

  // Expand/collapse the row's tool list — the status line is the affordance
  container.querySelectorAll('[data-toggle-row]').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.connector-row')
      row.classList.toggle('is-expanded')
    })
  })

  // Per-tool checkbox
  container.querySelectorAll('[data-tool-enabled]').forEach(input => {
    input.addEventListener('change', async () => {
      const id = input.dataset.connectorId
      const toolName = input.dataset.tool
      const r = await window.klaus.connectors.setToolEnabled(id, toolName, input.checked)
      if (!r?.ok) {
        input.checked = !input.checked
        showToast(r?.error || tt('settings_failed'))
      }
    })
  })
}

function renderConnectorRow(c, status) {
  // currentLang is defined in i18n.js (classic script, shared global scope)
  const isZh = (typeof currentLang !== 'undefined' ? currentLang : 'zh') !== 'en'
  const nameKey = `connectors_${c.id.replace(/-/g, '_')}_name`
  const descKey = `connectors_${c.id.replace(/-/g, '_')}_desc`
  const name = tt(nameKey) || c.nameZh
  const desc = tt(descKey) || c.descZh

  // Status line (shown only when connector is enabled) — doubles as the
  // expand/collapse affordance. Count reflects checked tools / total tools.
  let statusSection = ''
  if (c.enabled) {
    const total = c.tools.length
    const enabledCount = c.tools.filter(t => t.enabled).length
    const st = status?.status
    let dotClass = 'gray'
    let label = tt('connectors_status_disconnected')
    if (st === 'connected') { dotClass = 'green'; label = tt('connectors_status_connected') }
    else if (st === 'failed') { dotClass = 'red'; label = `${tt('connectors_status_failed')}${status?.error ? ` · ${esc(status.error)}` : ''}` }
    statusSection = `
      <button class="connector-status-row" data-toggle-row="${esc(c.id)}">
        <span class="connector-dot ${dotClass}"></span>
        <span class="connector-status-text">${label} · ${tt('connectors_tools_enabled_count').replace('{n}', enabledCount).replace('{total}', total)}</span>
        <svg class="connector-row-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,6 8,10 12,6"/></svg>
      </button>
    `
  }

  // Tools grouped by readOnly flag → "读取" / "写入"
  const readTools = c.tools.filter(t => t.readOnly)
  const writeTools = c.tools.filter(t => !t.readOnly)
  const renderTool = t => {
    const label = isZh ? t.labelZh : t.labelEn
    const tip = isZh ? t.descZh : t.descEn
    return `
      <label class="connector-tool-item" title="${esc(tip)}">
        <input type="checkbox" class="connector-tool-check"
               data-tool-enabled data-connector-id="${esc(c.id)}" data-tool="${esc(t.name)}"
               ${t.enabled ? 'checked' : ''}>
        <span class="connector-tool-label">${esc(label)}</span>
      </label>
    `
  }

  const toolsGrid = c.enabled ? `
    <div class="connector-tools">
      ${readTools.length ? `
        <div class="connector-tools-group">
          <div class="connector-tools-heading">${tt('connectors_group_read')}</div>
          <div class="connector-tools-row">${readTools.map(renderTool).join('')}</div>
        </div>
      ` : ''}
      ${writeTools.length ? `
        <div class="connector-tools-group">
          <div class="connector-tools-heading">${tt('connectors_group_write')}</div>
          <div class="connector-tools-row">${writeTools.map(renderTool).join('')}</div>
        </div>
      ` : ''}
    </div>
  ` : ''

  return `
    <div class="connector-row ${c.enabled ? 'is-enabled' : ''}" data-connector="${esc(c.id)}">
      <div class="connector-row-main">
        <div class="connector-row-icon">${connectorIcon(c.id) || esc(c.icon)}</div>
        <div class="connector-row-text">
          <div class="connector-row-name">${esc(name)}</div>
          <div class="connector-row-desc">${esc(desc)}</div>
        </div>
        <label class="connector-switch">
          <input type="checkbox" data-connector-toggle="${esc(c.id)}" ${c.enabled ? 'checked' : ''}>
          <span class="connector-slider"></span>
        </label>
      </div>
      ${c.enabled ? `<div class="connector-row-expand">${statusSection}${toolsGrid}</div>` : ''}
    </div>
  `
}

// ==================== Preferences ====================
// loadPreferencesTab 已合并到 loadProfileTab

// ==================== System Authorization ====================
// macOS 隐私与安全授权状态查看 + 一键跳转系统设置对应面板
const SYSTEM_AUTH_ITEMS = [
  { key: 'fullDiskAccess', i18nTitle: 'sys_auth_full_disk', i18nDesc: 'sys_auth_full_disk_desc' },
  { key: 'screenRecording', i18nTitle: 'sys_auth_screen', i18nDesc: 'sys_auth_screen_desc' },
  { key: 'accessibility', i18nTitle: 'sys_auth_accessibility', i18nDesc: 'sys_auth_accessibility_desc' },
  { key: 'automation', i18nTitle: 'sys_auth_automation', i18nDesc: 'sys_auth_automation_desc' },
  { key: 'notification', i18nTitle: 'sys_auth_notification', i18nDesc: 'sys_auth_notification_desc' },
  { key: 'location', i18nTitle: 'sys_auth_location', i18nDesc: 'sys_auth_location_desc' },
]

async function loadSystemAuthTab(container) {
  const api = window.klaus.systemPermissions
  container.innerHTML = `<div class="sys-auth-wrap">
    <h1 class="sys-auth-title">${tt('sys_auth_title')}</h1>
    <p class="sys-auth-subtitle">${tt('sys_auth_subtitle')}</p>
    <div class="sys-auth-card" id="sys-auth-list">
      <div class="sys-auth-loading">${tt('loading') || 'Loading…'}</div>
    </div>
    <div class="sys-auth-footer">
      <span class="sys-auth-hint">${tt('sys_auth_restart_hint')}</span>
      <button class="btn-sm" id="sys-auth-refresh">${tt('sys_auth_refresh')}</button>
    </div>
  </div>`

  const listEl = container.querySelector('#sys-auth-list')

  async function render() {
    listEl.innerHTML = `<div class="sys-auth-loading">${tt('loading') || 'Loading…'}</div>`
    let result
    try {
      result = await api.check()
    } catch (err) {
      listEl.innerHTML = `<div class="sys-auth-empty">${esc(String(err?.message || err))}</div>`
      return
    }
    if (!result?.supported) {
      listEl.innerHTML = `<div class="sys-auth-empty">${tt('sys_auth_macos_only')}</div>`
      return
    }
    const perms = result.permissions || {}
    listEl.innerHTML = SYSTEM_AUTH_ITEMS.map((item, idx) => {
      const status = perms[item.key] || 'unknown'
      const granted = status === 'granted'
      const badgeCls = granted ? 'sys-auth-badge granted' : (status === 'denied' ? 'sys-auth-badge denied' : 'sys-auth-badge unknown')
      const badgeText = granted ? tt('sys_auth_granted') : (status === 'denied' ? tt('sys_auth_denied') : tt('sys_auth_unknown'))
      const icon = granted
        ? `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V5l8-3z"/><polyline points="8.5,12 11,14.5 15.5,9.5"/></svg>`
        : `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V5l8-3z"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16.01"/></svg>`
      const btn = granted ? '' : `<button class="sys-auth-btn" data-sys-grant="${item.key}">
        <span>${tt('sys_auth_grant_btn')}</span>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h7v7"/><path d="M13 3L7 9"/><path d="M11 9v4H3V5h4"/></svg>
      </button>`
      return `<div class="sys-auth-row ${granted ? 'is-granted' : ''}" ${idx === 0 ? '' : 'data-sep="1"'}>
        <div class="sys-auth-row-icon">${icon}</div>
        <div class="sys-auth-row-main">
          <div class="sys-auth-row-head">
            <span class="sys-auth-row-title">${tt(item.i18nTitle)}</span>
            <span class="${badgeCls}">${badgeText}</span>
          </div>
          <div class="sys-auth-row-desc">${tt(item.i18nDesc)}</div>
        </div>
        <div class="sys-auth-row-action">${btn}</div>
      </div>`
    }).join('')

    listEl.querySelectorAll('[data-sys-grant]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.sysGrant
        const res = await api.openSettings(type)
        if (!res?.ok) {
          showToast(res?.error || 'Failed')
          return
        }
        showRestartPrompt()
      })
    })
  }

  container.querySelector('#sys-auth-refresh')?.addEventListener('click', () => {
    render()
  })

  render()
}

// 授权完成后 macOS 对已运行进程缓存了 TCC 决定，新权限必须重启 Klaus 才能生效
function showRestartPrompt() {
  if (document.getElementById('sys-auth-restart-modal')) return
  const modal = document.createElement('div')
  modal.id = 'sys-auth-restart-modal'
  modal.className = 'sys-auth-modal'
  modal.innerHTML = `
    <div class="sys-auth-modal-backdrop"></div>
    <div class="sys-auth-modal-card">
      <div class="sys-auth-modal-title">${tt('sys_auth_restart_title')}</div>
      <div class="sys-auth-modal-body">${tt('sys_auth_restart_body')}</div>
      <div class="sys-auth-modal-footer">
        <button class="btn-sm" id="sys-auth-restart-later">${tt('sys_auth_restart_later')}</button>
        <button class="btn-sm btn-primary" id="sys-auth-restart-now">${tt('sys_auth_restart_now')}</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  const close = () => modal.remove()
  modal.querySelector('.sys-auth-modal-backdrop')?.addEventListener('click', close)
  modal.querySelector('#sys-auth-restart-later')?.addEventListener('click', close)
  modal.querySelector('#sys-auth-restart-now')?.addEventListener('click', async () => {
    try { await window.klaus.systemPermissions.restartApp() }
    catch (err) { showToast(String(err?.message || err)) }
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
