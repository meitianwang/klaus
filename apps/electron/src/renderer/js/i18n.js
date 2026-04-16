// Klaus Desktop — i18n (Chinese / English)

const I18N = {
  en: {
    // Chat
    new_chat: 'New chat', recents: 'Recents', send: 'Send',
    placeholder: 'Send a message...', connected: 'Connected',
    initializing: 'Initializing...', error: 'Error',
    thinking: 'Thinking...', copy: 'Copy', copied: 'Copied!',
    copy_failed: 'Failed', allow: 'Allow', deny: 'Deny',
    allowed: 'Allowed', denied: 'Denied', bot_name: 'Klaus',
    file_ready: 'File ready', download: 'Download',
    upload_failed: 'Upload failed: ',
    // Welcome
    welcome_title: 'Klaus AI', welcome_sub: 'How can I help you today?',
    good_morning: 'Good morning', good_afternoon: 'Good afternoon', good_evening: 'Good evening',
    // Settings
    settings: 'Settings', back: 'Back', save: 'Save', saved: 'Saved!',
    cancel: 'Cancel', delete_title: 'Delete',
    settings_saved: 'Saved', settings_failed: 'Failed', settings_deleted: 'Deleted',
    settings_confirm_delete: 'Are you sure?',
    // Profile
    profile: 'Profile', display_name: 'Display name',
    // Models
    models: 'Models', add_model: '+ Add Model', no_models: 'No models configured',
    set_default: 'Set Default', delete_model: 'Delete this model?',
    // Prompts
    prompts: 'Prompts', prompt_hint: 'Customize sections of the system prompt. Leave empty to use engine defaults.',
    // Channels
    channels: 'Channels', ch_hint: 'Connect messaging platforms to Klaus.',
    settings_ch_connect: 'Connect', settings_ch_connecting: 'Connecting...',
    settings_ch_connect_ok: 'Connected!', settings_ch_connect_fail: 'Connection failed',
    settings_ch_disconnected: 'Disconnected',
    // Skills
    skills: 'Skills', installed: 'Installed', market: 'Market',
    enabled: 'Enabled', disabled: 'Disabled', builtin: 'Built-in',
    settings_skills_upload: 'Upload Skill',
    settings_skills_on: 'Skill enabled', settings_skills_off: 'Skill disabled',
    settings_skills_uninstall: 'Uninstall',
    settings_skills_uninstalled_toast: 'Uninstalled',
    settings_skills_uploading: 'Uploading...',
    settings_skills_installed_toast: 'Installed',
    // MCP
    mcp: 'MCP', settings_mcp_hint: 'MCP servers are configured in ~/.klaus/.mcp.json',
    settings_mcp_uninstall: 'Uninstall', settings_mcp_name_required: 'Name is required',
    settings_mcp_delete_confirm: 'Remove this MCP server?',
    settings_mcp_import_failed: 'Import failed', settings_mcp_imported: 'Imported',
    settings_mcp_import_json: 'Import JSON', settings_mcp_reconnect: 'Reconnect',
    settings_skills_install: 'Install',
    // Cron
    cron: 'Tasks', settings_cron_running: 'Running', settings_cron_stopped: 'Stopped',
    settings_cron_tasks_label: 'tasks', settings_cron_active_label: 'active',
    settings_cron_next: 'Next', settings_cron_task_name: 'Name',
    settings_cron_type: 'Type', settings_cron_schedule: 'Schedule',
    settings_cron_oneshot: 'One-shot', settings_cron_recurring: 'Recurring',
    settings_cron_fired: 'Fired', settings_cron_delete_confirm: 'Delete this task?',
    settings_on: 'On', settings_off: 'Off',
    // Preferences
    preferences: 'Preferences', color_mode: 'Color mode',
    light: 'Light', dark: 'Dark', system: 'System',
    permission_mode: 'Permission Mode', language: 'Language',
    perm_default: 'Default', perm_default_desc: 'Ask permission for potentially risky operations',
    perm_auto: 'Auto', perm_auto_desc: 'Automatically approve safe operations',
    perm_bypass: 'Bypass All', perm_bypass_desc: 'Skip all permission prompts (use with caution)',
    // User menu
    menu_settings: 'Settings', menu_help: 'Help',
  },
  zh: {
    // Chat
    new_chat: '新对话', recents: '最近', send: '发送',
    placeholder: '输入消息...', connected: '已连接',
    initializing: '初始化中...', error: '错误',
    thinking: '思考中...', copy: '复制', copied: '已复制！',
    copy_failed: '复制失败', allow: '允许', deny: '拒绝',
    allowed: '已允许', denied: '已拒绝', bot_name: 'Klaus',
    file_ready: '文件就绪', download: '下载',
    upload_failed: '上传失败：',
    // Welcome
    welcome_title: 'Klaus AI', welcome_sub: '有什么可以帮你的？',
    good_morning: '早上好', good_afternoon: '下午好', good_evening: '晚上好',
    // Settings
    settings: '设置', back: '返回', save: '保存', saved: '已保存！',
    cancel: '取消', delete_title: '删除',
    settings_saved: '已保存', settings_failed: '失败', settings_deleted: '已删除',
    settings_confirm_delete: '确定要删除吗？',
    // Profile
    profile: '个人资料', display_name: '显示名称',
    // Models
    models: '模型', add_model: '+ 添加模型', no_models: '暂无模型配置',
    set_default: '设为默认', delete_model: '删除此模型？',
    // Prompts
    prompts: '提示词', prompt_hint: '自定义系统提示词分段。留空则使用引擎默认值。',
    // Channels
    channels: '频道', ch_hint: '连接即时通讯平台到 Klaus。',
    settings_ch_connect: '连接', settings_ch_connecting: '连接中...',
    settings_ch_connect_ok: '连接成功！', settings_ch_connect_fail: '连接失败',
    settings_ch_disconnected: '已断开',
    // Skills
    skills: '技能', installed: '已安装', market: '市场',
    enabled: '已启用', disabled: '已禁用', builtin: '内置',
    settings_skills_upload: '上传技能',
    settings_skills_on: '技能已启用', settings_skills_off: '技能已禁用',
    settings_skills_uninstall: '卸载',
    settings_skills_uninstalled_toast: '已卸载',
    settings_skills_uploading: '上传中...',
    settings_skills_installed_toast: '已安装',
    // MCP
    mcp: 'MCP', settings_mcp_hint: 'MCP 服务器在 ~/.klaus/.mcp.json 中配置',
    settings_mcp_uninstall: '卸载', settings_mcp_name_required: '名称不能为空',
    settings_mcp_delete_confirm: '确定移除此 MCP 服务器？',
    settings_mcp_import_failed: '导入失败', settings_mcp_imported: '已导入',
    settings_mcp_import_json: '导入 JSON', settings_mcp_reconnect: '重新连接',
    settings_skills_install: '安装',
    // Cron
    cron: '定时任务', settings_cron_running: '运行中', settings_cron_stopped: '已停止',
    settings_cron_tasks_label: '个任务', settings_cron_active_label: '个活跃',
    settings_cron_next: '下次执行', settings_cron_task_name: '名称',
    settings_cron_type: '类型', settings_cron_schedule: '计划',
    settings_cron_oneshot: '一次性', settings_cron_recurring: '重复',
    settings_cron_fired: '已执行', settings_cron_delete_confirm: '删除此任务？',
    settings_on: '开', settings_off: '关',
    // Preferences
    preferences: '偏好设置', color_mode: '颜色模式',
    light: '浅色', dark: '深色', system: '跟随系统',
    permission_mode: '权限模式', language: '语言',
    perm_default: '默认', perm_default_desc: '对有风险的操作请求许可',
    perm_auto: '自动', perm_auto_desc: '自动批准安全操作',
    perm_bypass: '跳过所有', perm_bypass_desc: '跳过所有权限提示（谨慎使用）',
    // User menu
    menu_settings: '设置', menu_help: '帮助',
  },
}

let currentLang = 'en'

function tt(key) { return I18N[currentLang]?.[key] ?? I18N['en']?.[key] ?? key }

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const t = tt(el.dataset.i18n)
    if (t) el.textContent = t
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const t = tt(el.dataset.i18nPlaceholder)
    if (t) el.placeholder = t
  })
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const t = tt(el.dataset.i18nTitle)
    if (t) el.title = t
  })
}

function setLanguage(lang) { currentLang = lang; applyI18n() }

function applyTheme(theme) { document.documentElement.setAttribute('data-theme', theme) }

async function loadPreferences() {
  try {
    const lang = await window.klaus.settings.kv.get('language')
    if (lang) { currentLang = lang; applyI18n() }
    const theme = await window.klaus.settings.kv.get('theme')
    if (theme) applyTheme(theme)
  } catch {}
}

window.tt = tt
window.applyI18n = applyI18n
window.setLanguage = setLanguage
window.applyTheme = applyTheme
window.loadPreferences = loadPreferences

loadPreferences()
