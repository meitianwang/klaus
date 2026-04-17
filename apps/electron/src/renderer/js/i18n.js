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
    ch_hint_desc: 'Connect messaging platforms so users can chat with Klaus directly from their IM apps.',
    ch_setup: 'Configure', ch_configured: 'Configured', ch_connect: 'Connect', ch_disconnect: 'Disconnect',
    ch_setup_steps: 'Setup Steps', ch_fields_required: 'Please fill in all required fields',
    ch_coming_soon: 'Coming soon', ch_feishu_perms_copied: 'Permissions copied',
    ch_wechat_desc: 'Scan QR code to connect WeChat bot',
    ch_wecom_desc: 'Connect to WeCom smart bot',
    ch_wecom_step1: 'Admin Console → "Admin Tools" (left sidebar, bottom)', ch_wecom_step1_link: 'Open Console',
    ch_wecom_step2: 'Click "Smart Bot" → "Create Bot" → "Manual Create"',
    ch_wecom_step3: 'At the bottom, click "API Mode" → choose "Long Connection" → Save',
    ch_wecom_step4: 'Copy Bot ID and Secret below',
    ch_qq_desc: 'Connect to QQ via official QQ Bot API',
    ch_qq_step1: 'Create a bot on QQ Open Platform', ch_qq_step1_link: 'Open Platform',
    ch_qq_step2: "Find the bot's App ID and App Secret in the bot settings page",
    ch_qq_step3: 'Copy App ID and App Secret below',
    ch_feishu_desc: 'Connect to Feishu bot for team messaging',
    ch_feishu_step1: 'Create app on Feishu Open Platform', ch_feishu_step1_link: 'Create App →',
    ch_feishu_step2: 'In app details, click "Add Capability" → add "Bot"',
    ch_feishu_step3: 'Go to "Permissions" → "Batch Import", paste the permission JSON, then click "Apply"',
    ch_feishu_copy_perms: 'Copy Permissions',
    ch_feishu_step4: 'Go to "Credentials & Basic Info", copy App ID and App Secret below',
    ch_dingtalk_desc: 'Connect to DingTalk bot for team messaging',
    ch_dingtalk_step1: 'Create app on DingTalk Open Platform', ch_dingtalk_step1_link: 'Create App',
    ch_dingtalk_step2: 'Add "Bot" capability, enable Stream mode',
    ch_dingtalk_step3: 'Copy Client ID (AppKey) and Client Secret (AppSecret) below',
    ch_telegram_desc: 'Connect Telegram Bot via Bot API',
    ch_telegram_step1: 'Open Telegram, search @BotFather and start a chat', ch_telegram_step1_link: 'Open @BotFather',
    ch_telegram_step2: 'Send /newbot, set a name and username for your bot',
    ch_telegram_step3: 'BotFather will reply with a Bot Token (format: 123456:ABC-DEF...)',
    ch_telegram_step4: 'Copy the Bot Token and paste it below',
    ch_imessage_desc: 'macOS iMessage bridge via imsg CLI',
    ch_imessage_info: 'Click Connect to auto-install imsg and set up iMessage bridge. You may need to grant Full Disk Access permission when prompted.',
    ch_imessage_usage: 'iMessage bridge is running. Anyone who sends you an iMessage will get a reply from Klaus.',
    ch_imessage_perm_title: 'Grant Full Disk Access',
    ch_imessage_perm_desc: 'Open System Settings → Privacy & Security → Full Disk Access, and enable your terminal app (Terminal / iTerm / Warp). Then click Connect again.',
    ch_imessage_need_fda: 'imsg installed. Please grant Full Disk Access, then click Connect again.',
    ch_whatsapp_desc: 'WhatsApp via Baileys (QR code login)',
    ch_wechat_scan_hint: 'Open WeChat and scan the QR code below',
    ch_wechat_loading: 'Loading QR...',
    ch_wechat_waiting: 'Waiting for scan...',
    ch_wechat_scanned: 'Scanned. Confirm on phone...',
    ch_wechat_expired: 'QR expired. Close and reopen to retry.',
    ch_whatsapp_scan_hint: 'Open WhatsApp → Linked Devices → Link a Device → Scan',
    ch_whatsapp_loading: 'Starting WhatsApp...',
    ch_whatsapp_waiting: 'Waiting for scan...',
    ch_connected: 'Connected',
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
    thought_for: 'Thought for ',
    no_mcp: 'No MCP servers configured', no_skills: 'No skills found', no_cron: 'No scheduled tasks',
    // User menu
    menu_settings: 'Settings', menu_language: 'Language', menu_help: 'Help', menu_logout: 'Logout',
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
    ch_hint_desc: '连接即时通讯平台，让用户可以直接在 IM 应用里与 Klaus 对话。',
    ch_setup: '配置', ch_configured: '已配置', ch_connect: '连接', ch_disconnect: '断开连接',
    ch_setup_steps: '设置步骤', ch_fields_required: '请填写所有必填字段',
    ch_coming_soon: '即将推出', ch_feishu_perms_copied: '权限已复制',
    ch_wechat_desc: '扫码登录微信机器人',
    ch_wecom_desc: '连接企业微信智能机器人',
    ch_wecom_step1: '管理后台 → 左下角"管理工具"', ch_wecom_step1_link: '打开后台',
    ch_wecom_step2: '点击"智能机器人" → "创建机器人" → "手动创建"',
    ch_wecom_step3: '底部点击"API 模式" → 选择"长连接" → 保存',
    ch_wecom_step4: '在下方填写 Bot ID 和 Secret',
    ch_qq_desc: '通过官方 QQ 机器人 API 连接 QQ',
    ch_qq_step1: '在 QQ 开放平台创建机器人', ch_qq_step1_link: '开放平台',
    ch_qq_step2: '在机器人设置页面找到 App ID 和 App Secret',
    ch_qq_step3: '在下方填写 App ID 和 App Secret',
    ch_feishu_desc: '连接飞书机器人用于团队协作',
    ch_feishu_step1: '在飞书开放平台创建应用', ch_feishu_step1_link: '创建应用 →',
    ch_feishu_step2: '在应用详情里点击"添加能力" → 添加"机器人"',
    ch_feishu_step3: '进入"权限管理" → "批量导入"，粘贴下方权限 JSON，然后点击"申请"',
    ch_feishu_copy_perms: '复制权限',
    ch_feishu_step4: '在"凭证与基础信息"中复制 App ID 和 App Secret',
    ch_dingtalk_desc: '连接钉钉机器人用于团队协作',
    ch_dingtalk_step1: '在钉钉开放平台创建应用', ch_dingtalk_step1_link: '创建应用',
    ch_dingtalk_step2: '添加"机器人"能力，启用 Stream 模式',
    ch_dingtalk_step3: '复制下方的 Client ID (AppKey) 和 Client Secret (AppSecret)',
    ch_telegram_desc: '通过 Bot API 连接 Telegram 机器人',
    ch_telegram_step1: '打开 Telegram，搜索 @BotFather 并开始对话', ch_telegram_step1_link: '打开 @BotFather',
    ch_telegram_step2: '发送 /newbot，设置机器人名称和用户名',
    ch_telegram_step3: 'BotFather 会返回一个 Bot Token（格式：123456:ABC-DEF...）',
    ch_telegram_step4: '复制 Bot Token 并粘贴到下方',
    ch_imessage_desc: '通过 imsg CLI 桥接 macOS iMessage',
    ch_imessage_info: '点击"连接"自动安装 imsg 并建立 iMessage 桥接。系统可能会提示授权完全磁盘访问权限。',
    ch_imessage_usage: 'iMessage 桥接运行中。任何给你发 iMessage 的人都会收到 Klaus 的回复。',
    ch_imessage_perm_title: '授予完全磁盘访问权限',
    ch_imessage_perm_desc: '打开"系统设置 → 隐私与安全性 → 完全磁盘访问权限"，启用你的终端应用（Terminal / iTerm / Warp），然后再次点击连接。',
    ch_imessage_need_fda: 'imsg 已安装。请先授予完全磁盘访问权限，然后再次点击连接。',
    ch_whatsapp_desc: '通过 Baileys 连接 WhatsApp（扫码登录）',
    ch_wechat_scan_hint: '打开微信扫描下方二维码',
    ch_wechat_loading: '加载二维码中...',
    ch_wechat_waiting: '等待扫码...',
    ch_wechat_scanned: '已扫码，请在手机上确认...',
    ch_wechat_expired: '二维码已过期，关闭重开重试',
    ch_whatsapp_scan_hint: '打开 WhatsApp → 已连接的设备 → 连接设备 → 扫码',
    ch_whatsapp_loading: 'WhatsApp 启动中...',
    ch_whatsapp_waiting: '等待扫码...',
    ch_connected: '已连接',
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
    thought_for: '思考了 ',
    no_mcp: '暂无 MCP 服务器', no_skills: '暂无技能', no_cron: '暂无定时任务',
    // User menu
    menu_settings: '设置', menu_language: '语言', menu_help: '帮助', menu_logout: '退出',
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

function setLanguage(lang) {
  currentLang = lang
  applyI18n()
  if (typeof settingsVisible !== 'undefined' && settingsVisible && typeof loadSettingsTab === 'function' && typeof currentSettingsTab === 'string') {
    loadSettingsTab(currentSettingsTab)
  }
}

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
