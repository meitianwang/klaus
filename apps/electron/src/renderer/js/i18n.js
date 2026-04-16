// Klaus Desktop — i18n (Chinese / English)

const I18N = {
  en: {
    new_chat: 'New Chat',
    settings: 'Settings',
    send: 'Send',
    placeholder: 'Send a message...',
    welcome_title: 'Klaus AI',
    welcome_sub: 'Start a conversation',
    initializing: 'Initializing...',
    ready: 'Ready',
    thinking: 'Thinking...',
    allow: 'Allow',
    deny: 'Deny',
    allowed: 'Allowed',
    denied: 'Denied',
    allow_tool: 'Allow',
    delete_confirm: 'Delete this conversation?',
    delete_model_confirm: 'Delete this model?',
    today: 'Today',
    yesterday: 'Yesterday',
    earlier: 'Earlier',
    models: 'Models',
    prompts: 'Prompts',
    mcp: 'MCP',
    preferences: 'Preferences',
    add_model: '+ Add Model',
    no_models: 'No models configured',
    save: 'Save',
    saved: 'Saved!',
    cancel: 'Cancel',
    set_default: 'Set Default',
    delete: 'Delete',
    language: 'Language',
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    permission_mode: 'Permission Mode',
    perm_default: 'Default (Ask)',
    perm_auto: 'Auto',
    perm_bypass: 'Bypass All',
    reconnect_all: 'Reconnect All',
    reconnecting: 'Reconnecting...',
    reconnected: 'Reconnected.',
    prompt_hint: 'Customize sections of the system prompt. Leave empty to use engine defaults.',
    mcp_hint: 'MCP servers are configured in ~/.klaus/.mcp.json',
  },
  zh: {
    new_chat: '新对话',
    settings: '设置',
    send: '发送',
    placeholder: '输入消息...',
    welcome_title: 'Klaus AI',
    welcome_sub: '开始一段对话',
    initializing: '初始化中...',
    ready: '就绪',
    thinking: '思考中...',
    allow: '允许',
    deny: '拒绝',
    allowed: '已允许',
    denied: '已拒绝',
    allow_tool: '允许',
    delete_confirm: '删除此对话？',
    delete_model_confirm: '删除此模型？',
    today: '今天',
    yesterday: '昨天',
    earlier: '更早',
    models: '模型',
    prompts: '提示词',
    mcp: 'MCP',
    preferences: '偏好设置',
    add_model: '+ 添加模型',
    no_models: '暂无模型配置',
    save: '保存',
    saved: '已保存！',
    cancel: '取消',
    set_default: '设为默认',
    delete: '删除',
    language: '语言',
    theme: '主题',
    light: '浅色',
    dark: '深色',
    permission_mode: '权限模式',
    perm_default: '默认（询问）',
    perm_auto: '自动',
    perm_bypass: '跳过所有',
    reconnect_all: '重新连接',
    reconnecting: '重连中...',
    reconnected: '已重连。',
    prompt_hint: '自定义系统提示词分段。留空则使用引擎默认值。',
    mcp_hint: 'MCP 服务器在 ~/.klaus/.mcp.json 中配置',
  },
}

let currentLang = 'en'

function tt(key) {
  return I18N[currentLang]?.[key] ?? I18N['en']?.[key] ?? key
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = tt(el.dataset.i18n)
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = tt(el.dataset.i18nPlaceholder)
  })
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = tt(el.dataset.i18nTitle)
  })
}

function setLanguage(lang) {
  currentLang = lang
  applyI18n()
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

// Load saved preferences on startup
async function loadPreferences() {
  try {
    const lang = await window.klaus.settings.kv.get('language')
    if (lang) {
      currentLang = lang
      applyI18n()
    }
    const theme = await window.klaus.settings.kv.get('theme')
    if (theme) {
      applyTheme(theme)
    }
  } catch {}
}

// Expose globally
window.tt = tt
window.applyI18n = applyI18n
window.setLanguage = setLanguage
window.applyTheme = applyTheme
window.loadPreferences = loadPreferences

// Auto-load on script init
loadPreferences()
