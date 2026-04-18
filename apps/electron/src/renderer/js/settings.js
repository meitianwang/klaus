// Klaus Desktop — Settings Panel
// Tabs: Profile, Models, Channels, Skills, MCP
// Prompts are managed in the Klaus web admin panel (cloud).
// Scheduled tasks live in their own view (cron.js, sidebar entry).

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
    case 'preferences': loadPreferencesTab(content); break
    case 'models': loadModelsTab(content); break
    case 'channels': loadChannelsTab(content); break
    case 'skills': loadSkillsTab(content); break
    case 'mcp': loadMcpTab(content); break
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
      await settingsApi.kv.set('avatar_data_url', resized)
      const name = document.getElementById('profile-name-input')?.value?.trim() || tt('user_default_name')
      applyAvatar(resized, name)
      // 设置页内的 avatar-wrap 也刷新（applyAvatar 会处理，但它的 initial 逻辑针对侧栏，这里直接设背景）
      const wrap = document.getElementById('profile-avatar-wrap')
      if (wrap) {
        wrap.style.backgroundImage = `url("${resized}")`
        wrap.style.backgroundSize = 'cover'
        wrap.style.backgroundPosition = 'center'
        wrap.style.color = 'transparent'
        Array.from(wrap.childNodes).forEach(n => { if (n.nodeType === 3) n.remove() })
      }
      showToast(tt('avatar_updated'))
    } catch (err) {
      showToast(tt('avatar_upload_failed_prefix') + (err?.message || String(err)))
    }
  })
  document.getElementById('profile-save-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('profile-name-input')?.value?.trim()
    if (name) {
      await settingsApi.kv.set('display_name', name)
      document.getElementById('profile-name-display').textContent = name
      document.getElementById('profile-save-status').textContent = tt('saved')
      setTimeout(() => document.getElementById('profile-save-status').textContent = '', 2000)
      // 统一走 bootstrapProfile —— 会正确处理头像（有图时不被首字母覆盖）和侧栏名
      if (typeof window.bootstrapProfile === 'function') window.bootstrapProfile()
    }
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

  container.innerHTML = `<div class="settings-section">
    <div class="settings-field">
      <label class="settings-field-label">${tt("permission_mode")}</label>
      <div id="perm-options">
        <div class="settings-perm-card ${permMode === 'default' ? 'active' : ''}" data-perm="default"><div class="settings-perm-icon">🛡</div><div><div class="settings-perm-label">${tt('perm_default')}</div><div class="settings-perm-desc">${tt('perm_default_desc')}</div></div></div>
        <div class="settings-perm-card ${permMode === 'auto' ? 'active' : ''}" data-perm="auto"><div class="settings-perm-icon">⚡</div><div><div class="settings-perm-label">${tt('perm_auto')}</div><div class="settings-perm-desc">${tt('perm_auto_desc')}</div></div></div>
        <div class="settings-perm-card ${permMode === 'bypassPermissions' ? 'active' : ''}" data-perm="bypassPermissions"><div class="settings-perm-icon">🔓</div><div><div class="settings-perm-label">${tt('perm_bypass')}</div><div class="settings-perm-desc">${tt('perm_bypass_desc')}</div></div></div>
      </div>
    </div>
    <div class="settings-field settings-row-field">
      <div class="settings-row-text">
        <div class="settings-row-label">${tt('cron_keep_awake')}</div>
        <div class="settings-row-desc">${tt('cron_awake_hint')}</div>
      </div>
      <label class="cron-switch">
        <input type="checkbox" id="pref-keep-awake" ${keepAwake ? 'checked' : ''}>
        <span class="cron-switch-track"></span>
      </label>
    </div>
  </div>`

  container.querySelector('#perm-options')?.addEventListener('click', async (e) => {
    const card = e.target.closest('.settings-perm-card'); if (!card) return
    container.querySelectorAll('.settings-perm-card').forEach(c => c.classList.toggle('active', c.dataset.perm === card.dataset.perm))
    await settingsApi.kv.set('permission_mode', card.dataset.perm); showToast(tt('perm_mode_saved'))
  })
  container.querySelector('#pref-keep-awake')?.addEventListener('change', async (e) => {
    const checked = e.target.checked
    const res = await settingsApi.cron.keepAwake.set(checked)
    if (!res?.ok) {
      e.target.checked = !checked
      showToast(res?.error || 'Failed')
      return
    }
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
          <div class="card-actions">${!m.isDefault ? `<button class="btn-xs" onclick="setDefaultModel('${esc(m.id)}')">${tt('set_default')}</button>` : ''}<button class="btn-xs btn-danger" onclick="deleteModel('${esc(m.id)}')">${tt('delete_title')}</button></div>
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
    if (!confirm(tt('sub_confirm_logout'))) return
    try {
      await window.klaus.auth.logout()
    } catch {}
    window.dispatchEvent(new Event('klaus:auth-mode-changed'))
    loadSettingsTab('models')
  })
}
window.showAddModelForm = function() {
  const form = document.getElementById('model-form'); form.style.display = 'block'
  form.innerHTML = `<div class="settings-card"><h4 style="margin-bottom:12px">${tt('add_model_title')}</h4>
    <div class="form-row"><label>${tt('model_field_name')}</label><input id="mf-name" placeholder="${esc(tt('model_placeholder_name'))}"></div>
    <div class="form-row"><label>${tt('model_field_model_id')}</label><input id="mf-model" placeholder="claude-sonnet-4-20250514"></div>
    <div class="form-row"><label>${tt('model_field_api_key')}</label><input id="mf-apikey" type="password" placeholder="sk-ant-..."></div>
    <div class="form-row"><label>${tt('model_field_provider')}</label><select id="mf-provider"><option value="anthropic">Anthropic</option><option value="bedrock">AWS Bedrock</option><option value="vertex">Google Vertex</option></select></div>
    <div class="form-row"><label>${tt('model_field_base_url')}</label><input id="mf-baseurl"></div>
    <div class="form-row"><label>${tt('model_field_max_tokens')}</label><input id="mf-tokens" type="number" value="200000"></div>
    <div class="form-row"><label>${tt('model_field_thinking')}</label><select id="mf-thinking"><option value="off">${tt('thinking_off')}</option><option value="low">${tt('thinking_low')}</option><option value="medium">${tt('thinking_medium')}</option><option value="high">${tt('thinking_high')}</option></select></div>
    <div class="form-actions"><button class="btn-sm btn-primary" onclick="saveModel()">${tt('save')}</button><button class="btn-sm" onclick="document.getElementById('model-form').style.display='none'">${tt('cancel')}</button></div></div>`
}
window.saveModel = async function() {
  const now = Date.now()
  await settingsApi.models.upsert({ id: crypto.randomUUID(), name: gv('mf-name') || 'Untitled', provider: gv('mf-provider'), model: gv('mf-model') || 'claude-sonnet-4-20250514', apiKey: gv('mf-apikey') || undefined, baseUrl: gv('mf-baseurl') || undefined, maxContextTokens: parseInt(gv('mf-tokens')) || 200000, thinking: gv('mf-thinking'), isDefault: false, createdAt: now, updatedAt: now })
  loadSettingsTab('models')
}
window.setDefaultModel = async (id) => {
  await settingsApi.models.setDefault(id)
  window.dispatchEvent(new Event('klaus:auth-mode-changed'))
  loadSettingsTab('models')
}
window.deleteModel = async (id) => { if (confirm(tt('delete_model'))) { await settingsApi.models.delete(id); loadSettingsTab('models') } }

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
      if (!confirm(tt('settings_confirm_delete'))) return
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
      if (!confirm(tt('settings_confirm_delete'))) return
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
      if (!confirm(tt('settings_confirm_delete'))) return
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
  if (skills.length === 0) return `<p class="empty-text">${tt('no_skills') || 'No skills found'}</p>`
  return skills.map(s => {
    const isMarket = view === 'market'
    const toggle = !isMarket ? `<label class="sk-toggle"><input type="checkbox" class="sk-toggle-input" data-skill="${esc(s.dirName || s.name)}" ${s.userEnabled ? 'checked' : ''}><span class="sk-slider"></span></label>` : ''
    const installBtn = isMarket ? `<button class="btn-xs ${s.installed ? '' : 'btn-primary'}" data-install="${esc(s.dirName || s.name)}" ${s.installed ? 'disabled' : ''}>${s.installed ? tt('installed') : tt('settings_skills_install')}</button>` : ''
    const uninstallBtn = !isMarket && s.source === 'installed' ? `<button class="btn-xs btn-danger" data-uninstall="${esc(s.dirName || s.name)}">${tt('settings_skills_uninstall')}</button>` : ''
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
      el.disabled = true; el.textContent = tt('settings_skills_uploading')
      const result = await window.klaus.skills.install(el.dataset.install)
      if (result.ok) { showToast(tt('settings_skills_installed_toast') + ': ' + result.name); loadSettingsTab('skills') }
      else { showToast(tt('toast_error_prefix') + (result.error || tt('toast_unknown'))); el.disabled = false; el.textContent = tt('skills_install_btn') }
    })
  })
  document.querySelectorAll('[data-uninstall]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm(tt('settings_skills_uninstall') + ': ' + el.dataset.uninstall + '?')) return
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

  container.innerHTML = `<div class="settings-section"><div class="settings-section-header"><h3>${tt("mcp")}</h3>
      <div style="display:flex;gap:6px"><button class="btn-sm" id="mcp-add-manual">${tt("mcp")} +</button><button class="btn-sm" id="mcp-add-json">${tt('settings_mcp_import_json')}</button><button class="btn-sm" onclick="window.klaus.mcp.reconnect().then(()=>{showToast(tt('toast_reconnected'));loadSettingsTab('mcp')})">${tt('settings_mcp_reconnect')}</button></div></div>

    <!-- Manual form (hidden) -->
    <div id="mcp-manual-form" style="display:none"><div class="settings-card">
      <div class="form-row"><label>Name</label><input id="mcpf-name" placeholder="server-name" class="s-form-input" style="width:100%"></div>
      <div class="form-row"><label>Type</label><select id="mcpf-type" class="s-form-input" style="width:100%"><option value="stdio">stdio</option><option value="sse">SSE</option><option value="http">HTTP</option></select></div>
      <div id="mcpf-command-wrap"><div class="form-row"><label>Command</label><input id="mcpf-command" placeholder='npx -y @modelcontextprotocol/server-everything' class="s-form-input" style="width:100%"></div></div>
      <div id="mcpf-url-wrap" style="display:none"><div class="form-row"><label>URL</label><input id="mcpf-url" placeholder="https://..." class="s-form-input" style="width:100%"></div></div>
      <div class="form-row"><label>Timeout (seconds, optional)</label><input id="mcpf-timeout" type="number" class="s-form-input" style="width:100%"></div>
      <div class="form-row"><label>Environment Variables</label><div id="mcpf-env-rows"></div>
        <div style="display:flex;gap:6px;margin-top:4px"><button class="btn-xs" id="mcpf-add-env">+ Add</button><button class="btn-xs" id="mcpf-paste-env">Paste</button></div></div>
      <div class="form-actions"><button class="btn-sm btn-primary" id="mcpf-save">${tt('save')}</button><button class="btn-sm" id="mcpf-cancel">${tt('cancel')}</button></div></div></div>

    <!-- JSON import form (hidden) -->
    <div id="mcp-json-form" style="display:none"><div class="settings-card">
      <div class="form-row"><label>Paste .mcp.json content</label><textarea id="mcpf-json" rows="8" class="prompt-editor" placeholder='{ "mcpServers": { "name": { "command": "..." } } }'></textarea></div>
      <div class="form-actions"><button class="btn-sm btn-primary" id="mcpf-json-import">Import</button><button class="btn-sm" id="mcpf-json-cancel">${tt('cancel')}</button></div></div></div>

    <!-- Server list -->
    <div id="mcp-list">${servers.length === 0 ? `<p class="empty-text">${tt('no_mcp') || 'No MCP servers configured'}</p>` : `<div class="sk-grid">${servers.map(s => {
      const st = statusMap.get(s.name)
      const cfg = s.config || {}
      const type = cfg.type || 'stdio'
      let detail = ''
      if (type === 'stdio') { detail = (cfg.command || '') + (cfg.args ? ' ' + cfg.args.join(' ') : '') }
      else { detail = cfg.url || '' }
      return `<div class="sk-card"><div class="sk-card-head"><div class="sk-card-info"><div class="sk-card-emoji">🔌</div><div class="sk-card-name">${esc(s.name)}</div></div>
        <label class="sk-toggle"><input type="checkbox" class="mcp-toggle-input" data-mcp="${esc(s.name)}" ${s.enabled ? 'checked' : ''}><span class="sk-slider"></span></label></div>
        <div class="sk-card-desc">${esc(detail)}</div>
        <div class="sk-card-actions"><button class="btn-xs btn-danger" data-delmcp="${esc(s.name)}">${tt('settings_skills_uninstall')}</button></div>
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
    if (result.ok) { showToast(tt('settings_saved')); loadSettingsTab('mcp') }
    else showToast(result.error || tt('settings_failed'))
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
      showToast(el.checked ? tt('enabled') : tt('disabled'))
    })
  })
  container.querySelectorAll('[data-delmcp]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm(tt('settings_mcp_delete_confirm') + ': ' + el.dataset.delmcp + '?')) return
      await window.klaus.mcp.remove(el.dataset.delmcp)
      showToast(tt('settings_deleted')); loadSettingsTab('mcp')
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

// ==================== Preferences ====================
// loadPreferencesTab 已合并到 loadProfileTab

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
