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
    chip_write: 'Help me write', chip_code: 'Write code', chip_explain: 'Explain a concept', chip_brainstorm: 'Brainstorm ideas',
    // Settings
    settings: 'Settings', back: 'Back', save: 'Save', saved: 'Saved!',
    settings_back_to_app: 'Back to app',
    settings_group_account: 'Account',
    settings_group_general: 'General',
    settings_group_integrations: 'Extensions & Integrations',
    cancel: 'Cancel', delete_title: 'Delete',
    settings_saved: 'Saved', settings_failed: 'Failed', settings_deleted: 'Deleted',
    settings_confirm_delete: 'Are you sure?',
    // Profile
    profile: 'Profile', display_name: 'Display name',
    preferences: 'Preferences',
    // Models
    models: 'Models', add_model: '+ Add Model', no_models: 'No models configured',
    set_default: 'Set Default', delete_model: 'Delete this model?',
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
    cron: 'Scheduled Tasks',
    cron_subtitle: 'Automate recurring tasks, or run them manually anytime. Describe what you want done regularly in any chat and Klaus can set it up quickly.',
    cron_new: 'New task',
    cron_edit: 'Edit',
    cron_run_now: 'Run now',
    cron_run_failed: 'Could not start task',
    cron_refresh: 'Refresh',
    cron_via_klaus: 'Create via Klaus',
    cron_via_klaus_seed: "I want to create a scheduled task. Please help me work out:\n1. What the task should do (the content you want Klaus to run)\n2. How often it should run (daily / weekly / weekdays / a specific time)\n3. A short name for it\nThen confirm the details and I'll add it on the Scheduled Tasks page.",
    cron_tab_tasks: 'My Tasks', cron_tab_runs: 'Run History',
    cron_sort_created_desc: 'Newest first', cron_sort_created_asc: 'Oldest first',
    cron_sort_name_asc: 'Name A-Z', cron_sort_enabled_first: 'Enabled first',
    cron_task_all: 'All tasks',
    cron_status_all: 'All statuses', cron_status_success: 'Success', cron_status_failed: 'Failed', cron_status_running: 'Running',
    cron_trigger_scheduled: 'Scheduled', cron_trigger_manual: 'Manual',
    cron_awake_hint: 'Scheduled tasks only run while the computer stays awake',
    cron_keep_awake: 'Keep system awake',
    cron_runs_empty: 'No execution records yet',
    cron_today: 'Today', cron_yesterday: 'Yesterday',
    cron_month: '/', cron_day: '',
    cron_form_name: 'Name',
    cron_form_schedule: 'Schedule (cron)',
    cron_form_schedule_hint: 'Examples: 0 9 * * * (every day at 9:00), 0 12 * * 1-5 (weekdays at noon)',
    cron_form_prompt: 'Prompt',
    cron_fields_required: 'Schedule and prompt are required.',
    cron_delete_confirm: 'Delete this task?',
    cron_every_day: 'Daily', cron_weekdays: 'Weekdays', cron_weekends: 'Weekends', cron_every: 'Every ',
    cron_monday: 'Monday', cron_tuesday: 'Tuesday', cron_wednesday: 'Wednesday',
    cron_thursday: 'Thursday', cron_friday: 'Friday', cron_saturday: 'Saturday', cron_sunday: 'Sunday',
    settings_cron_running: 'Running', settings_cron_stopped: 'Stopped',
    settings_cron_tasks_label: 'tasks', settings_cron_active_label: 'active',
    settings_cron_next: 'Next', settings_cron_task_name: 'Name',
    settings_cron_type: 'Type', settings_cron_schedule: 'Schedule',
    settings_cron_oneshot: 'One-shot', settings_cron_recurring: 'Recurring',
    settings_cron_fired: 'Fired', settings_cron_delete_confirm: 'Delete this task?',
    settings_on: 'On', settings_off: 'Off',
    // Preferences
    preferences: 'Preferences', color_mode: 'Theme',
    light: 'Light', dark: 'Dark', system: 'System',
    permission_mode: 'Permission Mode', language: 'Language',
    perm_default: 'Default', perm_default_desc: 'Ask permission for potentially risky operations',
    perm_auto: 'Auto', perm_auto_desc: 'Automatically approve safe operations',
    perm_bypass: 'Bypass All', perm_bypass_desc: 'Skip all permission prompts (use with caution)',
    thought_for: 'Thought for ',
    no_mcp: 'No MCP servers configured', no_skills: 'No skills found', no_cron: 'No scheduled tasks',
    // User menu
    menu_settings: 'Settings', menu_language: 'Language', menu_help: 'Help', menu_logout: 'Logout',
    user_default_name: 'User', user_default_email: 'user@local',
    // Login screen (Klaus user auth)
    login_welcome_title: 'Welcome to Klaus',
    login_welcome_subtitle: 'Your AI desktop assistant for everyone',
    login_btn: 'Sign in / Sign up',
    login_opening: 'Opening browser…',
    login_failed_prefix: 'Sign in failed: ',
    login_retry: 'Retry',
    // UI chrome
    toggle_sidebar: 'Toggle sidebar', close_btn: 'Close', attach_file: 'Attach file',
    send_stop: 'Send / Stop', drop_files: 'Drop files to upload',
    upload_avatar_tooltip: 'Click to upload avatar',
    auth_pill_tooltip: 'Click to switch auth mode',
    // Auth pill (header)
    auth_subscription: 'Claude Subscription', auth_custom: 'Custom',
    auth_logged_in: 'Logged in', auth_not_logged_in: 'Not signed in',
    auth_not_configured: 'Not configured',
    // Auth required card
    auth_card_sub_title: 'Sign in to Claude',
    auth_card_custom_title: 'Configure a custom model',
    auth_card_sub_hint: 'Use your Claude Pro / Max subscription. Click Sign In below to open the browser and finish authorization.',
    auth_card_custom_hint: 'Custom mode needs a model with API key configured in Settings first.',
    auth_primary_sub: 'Sign in to Claude',
    auth_primary_custom: 'Configure model',
    auth_secondary_sub: 'or switch to custom model',
    auth_secondary_custom: 'or switch to Claude subscription',
    auth_opening_browser: 'Opening browser…',
    auth_wait_browser: 'Please finish authorization in the browser — this will resume automatically.',
    auth_success: '✓ Signed in',
    auth_please_resend: 'Signed in. Please resend your message.',
    auth_login_failed_prefix: 'Sign in failed: ',
    auth_retry_login: 'Retry sign in',
    auth_unknown_error: 'unknown error',
    auth_mode_switched_sub: 'Switched to Claude subscription — please resend your message',
    auth_mode_switched_custom: 'Switched to custom model — please resend your message',
    auth_switch_failed_prefix: 'Switch failed: ',
    // Thinking / stream
    thinking_label: 'Thinking',
    // Tool status
    tool_completed: 'completed', tool_failed: 'failed',
    // Permission card
    permission_default_msg: 'This tool requires your approval.',
    permission_show_input: 'Show input',
    permission_always_allow: 'Always allow',
    permission_rules_saved: ' (rules saved)',
    // Agent panel
    agents: 'Agents', agent_running: 'running',
    agent_count_one: ' agent', agent_count_many: ' agents',
    agent_tool_call_one: ' tool call', agent_tool_call_many: ' tool calls',
    agent_running_with_tools: 'running · ',
    // Context collapse / retry / MCP
    context_collapsed: ' collapsed · ', context_staged: ' staged',
    retrying_prefix: 'Retrying (',
    mcp_auth_opened_prefix: 'MCP authorization opened in browser for ',
    mcp_auth_opened_fallback: 'server',
    // Upload
    file_too_large: 'File too large (max 10MB): ',
    upload_failed_short: 'Upload failed: ',
    uploading_label: 'uploading... ',
    // Subscription section (settings)
    sub_account_fallback: 'Claude account',
    sub_mode_desc: 'In subscription mode, Claude automatically manages models (Opus / Sonnet / Haiku) — no manual configuration needed.',
    sub_logout: 'Sign out',
    sub_card_not_logged_in: 'Not signed in',
    sub_hint_not_logged_in: 'Use your Claude subscription (Pro / Max) to chat — model and usage are managed by your subscription.',
    sub_login_btn: 'Sign in to Claude',
    sub_auth_opening: 'Opening browser… please finish authorization there',
    sub_confirm_logout: 'Sign out of your Claude account?',
    sub_custom_mode_btn: 'Custom model',
    // Profile toasts
    avatar_updated: 'Avatar updated',
    avatar_upload_failed_prefix: 'Avatar upload failed: ',
    perm_mode_saved: 'Permission mode saved',
    language_saved: 'Language saved',
    // Tray menu
    tray_new_chat: 'New Chat', tray_show_app: 'Show Klaus',
    tray_settings: 'Settings', tray_quit: 'Quit',
    // Slash menu descriptions
    slash_new_desc: 'Start a new chat',
    slash_clear_desc: 'Clear current session',
    slash_help_desc: 'Show available commands',
    // Add Model form
    add_model_title: 'Add Model',
    model_field_name: 'Name', model_placeholder_name: 'My Claude Model',
    model_field_model_id: 'Model ID',
    model_field_api_key: 'API Key',
    model_field_provider: 'Provider',
    model_field_base_url: 'Base URL (optional)',
    model_field_max_tokens: 'Max Context Tokens',
    model_field_thinking: 'Thinking',
    thinking_off: 'Off', thinking_low: 'Low', thinking_medium: 'Medium', thinking_high: 'High',
    model_badge_default: 'Default',
    // Cron / Skills / MCP misc
    cron_enable: 'Enable', cron_disable: 'Disable',
    toast_deleted: 'Deleted', toast_reconnected: 'Reconnected',
    toast_error_prefix: 'Error: ', toast_unknown: 'unknown',
    skills_install_btn: 'Install',
    // Channel short names — used as sidebar badges on channel-sourced sessions
    // (aligns with Web 端 src/channels/web-ui-chat-js.ts:176-181)
    settings_ch_feishu: 'Feishu', settings_ch_dingtalk: 'DingTalk',
    settings_ch_wechat: 'WeChat', settings_ch_wecom: 'WeCom',
    settings_ch_qq: 'QQ', settings_ch_telegram: 'Telegram',
    settings_ch_whatsapp: 'WhatsApp',
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
    chip_write: '帮我写一段文字', chip_code: '帮我写代码', chip_explain: '解释一个概念', chip_brainstorm: '头脑风暴',
    // Settings
    settings: '设置', back: '返回', save: '保存', saved: '已保存！',
    settings_back_to_app: '返回应用',
    settings_group_account: '账户',
    settings_group_general: '通用',
    settings_group_integrations: '扩展与集成',
    cancel: '取消', delete_title: '删除',
    settings_saved: '已保存', settings_failed: '失败', settings_deleted: '已删除',
    settings_confirm_delete: '确定要删除吗？',
    // Profile
    profile: '个人资料', display_name: '显示名称',
    preferences: '偏好设置',
    // Models
    models: '模型', add_model: '+ 添加模型', no_models: '暂无模型配置',
    set_default: '设为默认', delete_model: '删除此模型？',
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
    cron: '定时任务',
    cron_subtitle: '按计划自动执行任务，也可随时手动触发。在任意对话中描述你想定期做的事，即可快速创建。',
    cron_new: '新建定时任务',
    cron_edit: '编辑',
    cron_run_now: '立即运行',
    cron_run_failed: '任务启动失败',
    cron_refresh: '刷新',
    cron_via_klaus: '通过 Klaus 创建',
    cron_via_klaus_seed: '我想创建一个定时任务，请和我确认：\n1. 这个任务要做什么（你想让我执行的内容）？\n2. 多久执行一次（每天/每周/工作日/指定时间）？\n3. 任务叫什么名字？\n确认后帮我把这些信息整理出来，我去"定时任务"页面创建。',
    cron_tab_tasks: '我的定时任务', cron_tab_runs: '执行记录',
    cron_sort_created_desc: '按创建时间倒序', cron_sort_created_asc: '按创建时间正序',
    cron_sort_name_asc: '按名称 A-Z', cron_sort_enabled_first: '启用优先',
    cron_task_all: '全部任务',
    cron_status_all: '全部状态', cron_status_success: '成功', cron_status_failed: '失败', cron_status_running: '运行中',
    cron_trigger_scheduled: '定时触发', cron_trigger_manual: '手动触发',
    cron_awake_hint: '定时任务仅在电脑保持唤醒时运行',
    cron_keep_awake: '保持系统唤醒',
    cron_runs_empty: '暂无执行记录',
    cron_today: '今天', cron_yesterday: '昨天',
    cron_month: '月', cron_day: '日',
    cron_form_name: '名称',
    cron_form_schedule: '计划（cron 表达式）',
    cron_form_schedule_hint: '示例：0 9 * * *（每天 9:00），0 12 * * 1-5（工作日中午 12:00）',
    cron_form_prompt: '提示词',
    cron_fields_required: '计划和提示词为必填项',
    cron_delete_confirm: '删除这个定时任务吗？',
    cron_every_day: '每天', cron_weekdays: '工作日', cron_weekends: '周末', cron_every: '每',
    cron_monday: '周一', cron_tuesday: '周二', cron_wednesday: '周三',
    cron_thursday: '周四', cron_friday: '周五', cron_saturday: '周六', cron_sunday: '周日',
    settings_cron_running: '运行中', settings_cron_stopped: '已停止',
    settings_cron_tasks_label: '个任务', settings_cron_active_label: '个活跃',
    settings_cron_next: '下次执行', settings_cron_task_name: '名称',
    settings_cron_type: '类型', settings_cron_schedule: '计划',
    settings_cron_oneshot: '一次性', settings_cron_recurring: '重复',
    settings_cron_fired: '已执行', settings_cron_delete_confirm: '删除此任务？',
    settings_on: '开', settings_off: '关',
    // Preferences
    preferences: '偏好设置', color_mode: '主题',
    light: '浅色', dark: '深色', system: '跟随系统',
    permission_mode: '权限模式', language: '语言',
    perm_default: '默认', perm_default_desc: '对有风险的操作请求许可',
    perm_auto: '自动', perm_auto_desc: '自动批准安全操作',
    perm_bypass: '跳过所有', perm_bypass_desc: '跳过所有权限提示（谨慎使用）',
    thought_for: '思考了 ',
    no_mcp: '暂无 MCP 服务器', no_skills: '暂无技能', no_cron: '暂无定时任务',
    // User menu
    menu_settings: '设置', menu_language: '语言', menu_help: '帮助', menu_logout: '退出',
    user_default_name: '用户', user_default_email: 'user@local',
    // Login screen (Klaus user auth)
    login_welcome_title: '欢迎使用 Klaus',
    login_welcome_subtitle: '面向所有人的 AI 桌面助手',
    login_btn: '登录/注册',
    login_opening: '正在打开浏览器…',
    login_failed_prefix: '登录失败：',
    login_retry: '重试',
    // UI chrome
    toggle_sidebar: '切换侧栏', close_btn: '关闭', attach_file: '附加文件',
    send_stop: '发送 / 停止', drop_files: '拖放文件以上传',
    upload_avatar_tooltip: '点击上传头像',
    auth_pill_tooltip: '点击切换认证模式',
    // Auth pill (header)
    auth_subscription: 'Claude 订阅', auth_custom: '自定义',
    auth_logged_in: '已登录', auth_not_logged_in: '未登录',
    auth_not_configured: '未配置',
    // Auth required card
    auth_card_sub_title: '请先登录 Claude 订阅',
    auth_card_custom_title: '请先配置自定义模型',
    auth_card_sub_hint: '使用你的 Claude Pro / Max 订阅聊天，点击下方登录按钮会打开浏览器完成授权。',
    auth_card_custom_hint: '自定义模式需要先在设置中添加一个含 API Key 的模型。',
    auth_primary_sub: '登录 Claude 账号',
    auth_primary_custom: '去配置模型',
    auth_secondary_sub: '或切换到自定义模型',
    auth_secondary_custom: '或切换到 Claude 订阅',
    auth_opening_browser: '正在打开浏览器…',
    auth_wait_browser: '请在浏览器中完成授权，完成后这里会自动继续',
    auth_success: '✓ 登录成功',
    auth_please_resend: '已登录，请重新发送你的消息',
    auth_login_failed_prefix: '登录失败：',
    auth_retry_login: '重试登录',
    auth_unknown_error: '未知错误',
    auth_mode_switched_sub: '已切换到 Claude 订阅模式，请重新发送你的消息',
    auth_mode_switched_custom: '已切换到自定义模型模式，请重新发送你的消息',
    auth_switch_failed_prefix: '切换失败：',
    // Thinking / stream
    thinking_label: '思考中',
    // Tool status
    tool_completed: '已完成', tool_failed: '失败',
    // Permission card
    permission_default_msg: '此工具需要你的批准。',
    permission_show_input: '展开输入',
    permission_always_allow: '始终允许',
    permission_rules_saved: '（规则已保存）',
    // Agent panel
    agents: '智能体', agent_running: '运行中',
    agent_count_one: ' 个智能体', agent_count_many: ' 个智能体',
    agent_tool_call_one: ' 次工具调用', agent_tool_call_many: ' 次工具调用',
    agent_running_with_tools: '运行中 · ',
    // Context collapse / retry / MCP
    context_collapsed: ' 已折叠 · ', context_staged: ' 暂存',
    retrying_prefix: '重试中 (',
    mcp_auth_opened_prefix: '已在浏览器打开 MCP 授权：',
    mcp_auth_opened_fallback: '服务器',
    // Upload
    file_too_large: '文件过大（最大 10MB）：',
    upload_failed_short: '上传失败：',
    uploading_label: '上传中... ',
    // Subscription section (settings)
    sub_account_fallback: 'Claude 账号',
    sub_mode_desc: '订阅模式下由 Claude 引擎自动管理模型（Opus / Sonnet / Haiku），无需手动配置。',
    sub_logout: '登出',
    sub_card_not_logged_in: '未登录',
    sub_hint_not_logged_in: '使用你的 Claude 订阅（Pro / Max）聊天，模型和用量由订阅管理。',
    sub_login_btn: '登录 Claude 账号',
    sub_auth_opening: '正在打开浏览器…请在浏览器中完成授权',
    sub_confirm_logout: '确定登出 Claude 账号吗？',
    sub_custom_mode_btn: '自定义模型',
    // Profile toasts
    avatar_updated: '头像已更新',
    avatar_upload_failed_prefix: '头像上传失败：',
    perm_mode_saved: '权限模式已保存',
    language_saved: '语言已保存',
    // Tray menu
    tray_new_chat: '新对话', tray_show_app: '显示 Klaus',
    tray_settings: '设置', tray_quit: '退出',
    // Slash menu descriptions
    slash_new_desc: '开始新对话',
    slash_clear_desc: '清空当前会话',
    slash_help_desc: '查看可用命令',
    // Add Model form
    add_model_title: '添加模型',
    model_field_name: '名称', model_placeholder_name: '我的 Claude 模型',
    model_field_model_id: '模型 ID',
    model_field_api_key: 'API Key',
    model_field_provider: '服务商',
    model_field_base_url: 'Base URL（可选）',
    model_field_max_tokens: '最大上下文 Tokens',
    model_field_thinking: '思考',
    thinking_off: '关', thinking_low: '低', thinking_medium: '中', thinking_high: '高',
    model_badge_default: '默认',
    // Cron / Skills / MCP misc
    cron_enable: '启用', cron_disable: '停用',
    toast_deleted: '已删除', toast_reconnected: '已重连',
    toast_error_prefix: '错误：', toast_unknown: '未知',
    skills_install_btn: '安装',
    // Channel short names — sidebar badges
    settings_ch_feishu: '飞书', settings_ch_dingtalk: '钉钉',
    settings_ch_wechat: '微信', settings_ch_wecom: '企微',
    settings_ch_qq: 'QQ', settings_ch_telegram: 'Telegram',
    settings_ch_whatsapp: 'WhatsApp',
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
