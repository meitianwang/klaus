/**
 * Built-in Connector catalog — Klaus-shipped system integrations.
 *
 * Different from MCP servers: connectors are zero-config, first-party,
 * curated, and have pre-declared tool metadata. User controls granularity
 * via per-tool checkboxes (no policy concept — enabled = auto-allowed,
 * unchecked = denied).
 */

export interface ConnectorTool {
  name: string            // technical id (e.g. 'list_reminders')
  labelZh: string         // short action label shown in UI
  labelEn: string
  descZh: string          // longer description (MCP server tool description)
  descEn: string
  readOnly: boolean
}

export interface ConnectorEntry {
  id: string
  group: 'macos'
  platform: NodeJS.Platform
  nameZh: string
  nameEn: string
  descZh: string
  descEn: string
  icon: string
  script: string
  tools: ConnectorTool[]
}

export const CONNECTOR_CATALOG: ConnectorEntry[] = [
  {
    id: 'macos-reminders',
    group: 'macos',
    platform: 'darwin',
    nameZh: '提醒事项',
    nameEn: 'Reminders',
    descZh: '读取和管理你的提醒事项和任务列表',
    descEn: 'Read and manage your reminders and task lists',
    icon: '📋',
    script: 'reminders.mjs',
    tools: [
      { name: 'list_reminders',      labelZh: '列出提醒事项', labelEn: 'List reminders',         descZh: '列出指定列表的提醒事项（或所有列表）', descEn: 'List reminders in a list (or all lists)', readOnly: true },
      { name: 'search_reminders',    labelZh: '搜索提醒',     labelEn: 'Search reminders',       descZh: '按关键字搜索提醒事项',               descEn: 'Search reminders by keyword',             readOnly: true },
      { name: 'list_reminder_lists', labelZh: '列出提醒列表', labelEn: 'List reminder lists',    descZh: '列出所有提醒事项列表',                 descEn: 'List all reminder lists',                 readOnly: true },
      { name: 'create_reminder',     labelZh: '创建提醒',     labelEn: 'Create reminder',        descZh: '创建新的提醒事项',                   descEn: 'Create a new reminder',                   readOnly: false },
      { name: 'update_reminder',     labelZh: '更新提醒',     labelEn: 'Update reminder',        descZh: '修改提醒的标题、到期时间、备注或优先级', descEn: 'Update reminder title / due / body / priority', readOnly: false },
      { name: 'complete_reminder',   labelZh: '完成提醒',     labelEn: 'Complete reminder',      descZh: '将提醒事项标记为已完成',             descEn: 'Mark a reminder as completed',            readOnly: false },
      { name: 'delete_reminder',     labelZh: '删除提醒',     labelEn: 'Delete reminder',        descZh: '删除提醒事项',                       descEn: 'Delete a reminder',                       readOnly: false },
      { name: 'create_reminder_list',labelZh: '创建提醒列表', labelEn: 'Create reminder list',   descZh: '创建新的提醒事项列表',               descEn: 'Create a new reminder list',              readOnly: false },
      { name: 'delete_reminder_list',labelZh: '删除提醒列表', labelEn: 'Delete reminder list',   descZh: '删除提醒事项列表（及其中所有提醒）', descEn: 'Delete a reminder list (and its reminders)', readOnly: false },
    ],
  },
  {
    id: 'macos-calendar',
    group: 'macos',
    platform: 'darwin',
    nameZh: '日历',
    nameEn: 'Calendar',
    descZh: '读取和管理你的日历事件',
    descEn: 'Read and manage your calendar events',
    icon: '📅',
    script: 'calendar.mjs',
    tools: [
      { name: 'list_events',     labelZh: '列出日历事件', labelEn: 'List events',     descZh: '列出指定时间段内的日历事件', descEn: 'List calendar events in a date range', readOnly: true },
      { name: 'search_events',   labelZh: '搜索事件',     labelEn: 'Search events',   descZh: '按关键字搜索日历事件',       descEn: 'Search calendar events by keyword',    readOnly: true },
      { name: 'get_event',       labelZh: '读取事件',     labelEn: 'Get event',       descZh: '获取单个事件的完整详情',     descEn: 'Get full details of a single event',   readOnly: true },
      { name: 'list_calendars',  labelZh: '列出日历',     labelEn: 'List calendars',  descZh: '列出所有日历（含名称、账号）', descEn: 'List all calendars with account info', readOnly: true },
      { name: 'create_event',    labelZh: '创建事件',     labelEn: 'Create event',    descZh: '创建新的日历事件',           descEn: 'Create a new calendar event',          readOnly: false },
      { name: 'update_event',    labelZh: '更新事件',     labelEn: 'Update event',    descZh: '修改事件标题、时间、地点、备注', descEn: 'Update event title / time / location / notes', readOnly: false },
      { name: 'delete_event',    labelZh: '删除事件',     labelEn: 'Delete event',    descZh: '删除日历事件',               descEn: 'Delete a calendar event',              readOnly: false },
    ],
  },
  {
    id: 'macos-notes',
    group: 'macos',
    platform: 'darwin',
    nameZh: '备忘录',
    nameEn: 'Notes',
    descZh: '读取和创建你的备忘录',
    descEn: 'Read and create your notes',
    icon: '📝',
    script: 'notes.mjs',
    tools: [
      { name: 'list_notes',       labelZh: '列出备忘录',     labelEn: 'List notes',        descZh: '列出备忘录（可按文件夹过滤）', descEn: 'List notes (optionally filter by folder)', readOnly: true },
      { name: 'search_notes',     labelZh: '搜索备忘录',     labelEn: 'Search notes',      descZh: '按关键字搜索备忘录',           descEn: 'Search notes by keyword',                  readOnly: true },
      { name: 'read_note',        labelZh: '读取备忘录',     labelEn: 'Read note',         descZh: '读取指定备忘录的内容',         descEn: 'Read the content of a specific note',      readOnly: true },
      { name: 'list_folders',     labelZh: '列出文件夹',     labelEn: 'List folders',      descZh: '列出备忘录所有文件夹（含嵌套）', descEn: 'List all Notes folders (including nested)', readOnly: true },
      { name: 'list_attachments', labelZh: '列出附件',       labelEn: 'List attachments',  descZh: '列出指定备忘录的附件信息',     descEn: 'List attachments of a given note',          readOnly: true },
      { name: 'create_note',      labelZh: '创建备忘录',     labelEn: 'Create note',       descZh: '创建新的备忘录',               descEn: 'Create a new note',                        readOnly: false },
      { name: 'update_note',      labelZh: '更新备忘录',     labelEn: 'Update note',       descZh: '修改备忘录的标题、正文，或移动到其他文件夹', descEn: 'Update note title/body, or move to another folder', readOnly: false },
      { name: 'append_to_note',   labelZh: '追加内容',       labelEn: 'Append to note',    descZh: '在备忘录末尾追加内容（不覆盖正文）', descEn: 'Append content to an existing note',       readOnly: false },
      { name: 'delete_note',      labelZh: '删除备忘录',     labelEn: 'Delete note',       descZh: '删除指定的备忘录',             descEn: 'Delete a specific note',                    readOnly: false },
      { name: 'create_folder',    labelZh: '创建文件夹',     labelEn: 'Create folder',     descZh: '创建新的备忘录文件夹',         descEn: 'Create a new Notes folder',                readOnly: false },
      { name: 'rename_folder',    labelZh: '重命名文件夹',   labelEn: 'Rename folder',     descZh: '重命名备忘录文件夹',           descEn: 'Rename a Notes folder',                    readOnly: false },
      { name: 'delete_folder',    labelZh: '删除文件夹',     labelEn: 'Delete folder',     descZh: '删除文件夹（及里面的所有备忘录）', descEn: 'Delete a folder (and all its notes)',      readOnly: false },
      { name: 'save_attachment',  labelZh: '导出附件',       labelEn: 'Save attachment',   descZh: '把指定备忘录的某个附件保存到本地', descEn: 'Save a note attachment to a local path',   readOnly: false },
    ],
  },
  {
    id: 'macos-mail',
    group: 'macos',
    platform: 'darwin',
    nameZh: '邮件',
    nameEn: 'Mail',
    descZh: '读取邮件和创建草稿',
    descEn: 'Read mail and create drafts',
    icon: '✉️',
    script: 'mail.mjs',
    tools: [
      { name: 'list_mailboxes',  labelZh: '列出邮箱',   labelEn: 'List mailboxes',   descZh: '列出所有邮箱',       descEn: 'List all mailboxes',         readOnly: true },
      { name: 'search_messages', labelZh: '搜索邮件',   labelEn: 'Search messages',  descZh: '按关键字搜索邮件',   descEn: 'Search mail messages',       readOnly: true },
      { name: 'read_message',    labelZh: '读取邮件',   labelEn: 'Read message',     descZh: '读取指定邮件内容',   descEn: 'Read a specific message body', readOnly: true },
      { name: 'create_draft',    labelZh: '创建草稿',   labelEn: 'Create draft',     descZh: '创建邮件草稿',       descEn: 'Create a mail draft',          readOnly: false },
      { name: 'send_message',    labelZh: '发送邮件',   labelEn: 'Send message',     descZh: '直接发送一封邮件（跳过草稿）', descEn: 'Send an email directly (no draft step)', readOnly: false },
      { name: 'mark_read',       labelZh: '标记已读',   labelEn: 'Mark read',        descZh: '将指定邮件标记为已读或未读', descEn: 'Mark a message as read or unread',      readOnly: false },
      { name: 'move_message',    labelZh: '移动邮件',   labelEn: 'Move message',     descZh: '把邮件移动到另一个邮箱',   descEn: 'Move a message to a different mailbox', readOnly: false },
      { name: 'delete_message',  labelZh: '删除邮件',   labelEn: 'Delete message',   descZh: '删除邮件（移到垃圾箱）',   descEn: 'Delete a message (moves to Trash)',     readOnly: false },
    ],
  },
  {
    id: 'macos-contacts',
    group: 'macos',
    platform: 'darwin',
    nameZh: '通讯录',
    nameEn: 'Contacts',
    descZh: '搜索、读取和创建联系人',
    descEn: 'Search, read and create contacts',
    icon: '👤',
    script: 'contacts.mjs',
    tools: [
      { name: 'search_contacts', labelZh: '搜索联系人', labelEn: 'Search contacts', descZh: '按关键字搜索联系人',           descEn: 'Search contacts by keyword',          readOnly: true },
      { name: 'read_contact',    labelZh: '读取联系人', labelEn: 'Read contact',    descZh: '读取联系人详细信息',           descEn: 'Read contact details',                readOnly: true },
      { name: 'list_groups',     labelZh: '列出分组',   labelEn: 'List groups',     descZh: '列出通讯录所有分组',           descEn: 'List all contact groups',             readOnly: true },
      { name: 'create_contact',  labelZh: '创建联系人', labelEn: 'Create contact',  descZh: '创建新联系人',                 descEn: 'Create a new contact',                readOnly: false },
      { name: 'update_contact',  labelZh: '更新联系人', labelEn: 'Update contact',  descZh: '修改联系人姓名、电话、邮箱等', descEn: 'Update contact name, phone, email...', readOnly: false },
      { name: 'delete_contact',  labelZh: '删除联系人', labelEn: 'Delete contact',  descZh: '删除联系人',                   descEn: 'Delete a contact',                    readOnly: false },
    ],
  },
  {
    id: 'macos-messages',
    group: 'macos',
    platform: 'darwin',
    nameZh: '信息',
    nameEn: 'Messages',
    descZh: '读取和发送 iMessage / 短信',
    descEn: 'Read and send iMessage / SMS',
    icon: '💬',
    script: 'messages.mjs',
    tools: [
      { name: 'list_recent_conversations', labelZh: '最近会话',   labelEn: 'Recent conversations', descZh: '列出最近的会话（按最后一条消息时间排序）', descEn: 'List recent conversations ordered by last message', readOnly: true },
      { name: 'read_conversation',         labelZh: '读取会话',   labelEn: 'Read conversation',    descZh: '读取指定联系人的最近消息',                 descEn: 'Read recent messages with a contact',               readOnly: true },
      { name: 'search_messages',           labelZh: '搜索消息',   labelEn: 'Search messages',      descZh: '跨所有会话全局搜索消息正文',               descEn: 'Global full-text search across all conversations',  readOnly: true },
      { name: 'send_message',              labelZh: '发送消息',   labelEn: 'Send message',         descZh: '发送 iMessage 到指定手机号/邮箱/联系人',   descEn: 'Send iMessage to phone / email / buddy',            readOnly: false },
    ],
  },
  {
    id: 'macos-safari',
    group: 'macos',
    platform: 'darwin',
    nameZh: 'Safari 浏览器',
    nameEn: 'Safari',
    descZh: '读取 Safari 标签页、页面内容，打开网址',
    descEn: 'Read Safari tabs, page content, open URLs',
    icon: '🧭',
    script: 'safari.mjs',
    tools: [
      { name: 'list_tabs',       labelZh: '列出标签页',    labelEn: 'List tabs',       descZh: '列出所有窗口和标签页',                 descEn: 'List all windows and tabs',                       readOnly: true },
      { name: 'get_active_tab',  labelZh: '当前标签页',    labelEn: 'Active tab',      descZh: '获取当前活动标签页 URL、标题、选中文本', descEn: 'Get active tab URL, title and selection',         readOnly: true },
      { name: 'read_tab',        labelZh: '读取页面内容',  labelEn: 'Read page',       descZh: '读取指定标签页的纯文本正文',           descEn: 'Read plain-text body of a tab',                   readOnly: true },
      { name: 'list_bookmarks',  labelZh: '列出书签',      labelEn: 'List bookmarks',  descZh: '列出 Safari 书签（按文件夹层级）',      descEn: 'List Safari bookmarks (folder hierarchy)',        readOnly: true },
      { name: 'list_history',    labelZh: '列出浏览历史',  labelEn: 'List history',    descZh: '列出最近浏览历史（按时间倒序）',       descEn: 'List recent browsing history (newest first)',     readOnly: true },
      { name: 'open_url',        labelZh: '打开网址',      labelEn: 'Open URL',        descZh: '在新标签页或当前标签页打开 URL',       descEn: 'Open a URL in a new or current tab',              readOnly: false },
      { name: 'switch_to_tab',   labelZh: '切换标签页',    labelEn: 'Switch to tab',   descZh: '切换到指定窗口/标签页并激活',          descEn: 'Switch to a specific window/tab and activate',    readOnly: false },
      { name: 'close_tab',       labelZh: '关闭标签页',    labelEn: 'Close tab',       descZh: '关闭指定标签页',                       descEn: 'Close a specific tab',                            readOnly: false },
    ],
  },
  {
    id: 'macos-shortcuts',
    group: 'macos',
    platform: 'darwin',
    nameZh: '快捷指令',
    nameEn: 'Shortcuts',
    descZh: '列出并执行你定义的 Shortcut（macOS 12+）',
    descEn: 'List and run your user-defined Shortcuts (macOS 12+)',
    icon: '⚡',
    script: 'shortcuts.mjs',
    tools: [
      { name: 'list_shortcuts', labelZh: '列出快捷指令', labelEn: 'List shortcuts', descZh: '列出所有已安装的快捷指令',       descEn: 'List all installed Shortcuts',             readOnly: true },
      { name: 'run_shortcut',   labelZh: '运行快捷指令', labelEn: 'Run shortcut',   descZh: '运行指定快捷指令，可传入文本参数', descEn: 'Run a shortcut, optionally with text input', readOnly: false },
    ],
  },
  {
    id: 'macos-finder',
    group: 'macos',
    platform: 'darwin',
    nameZh: '访达',
    nameEn: 'Finder',
    descZh: '读取 Finder 选中项、标签，移动到废纸篓',
    descEn: 'Read Finder selection, tags; move to Trash',
    icon: '🗂',
    script: 'finder.mjs',
    tools: [
      { name: 'get_selection', labelZh: '当前选中项',  labelEn: 'Current selection', descZh: '读取 Finder 当前选中的文件/文件夹路径', descEn: 'Read paths of currently-selected Finder items', readOnly: true },
      { name: 'get_tags',      labelZh: '读取标签',    labelEn: 'Get tags',          descZh: '读取指定路径的 Finder 标签',             descEn: 'Read Finder tags on a given path',             readOnly: true },
      { name: 'get_comment',   labelZh: '读取注释',    labelEn: 'Get comment',       descZh: '读取 Finder 注释（Spotlight comment）',  descEn: 'Read Finder comment (Spotlight comment)',      readOnly: true },
      { name: 'get_file_info', labelZh: '文件信息',    labelEn: 'File info',         descZh: '读取文件大小、类型、创建/修改时间', descEn: 'Read file size, kind, created / modified dates', readOnly: true },
      { name: 'list_folder',   labelZh: '列出文件夹',  labelEn: 'List folder',       descZh: '列出文件夹内容（含 Finder 标签/注释等元数据）', descEn: 'List folder contents with Finder tags / comments', readOnly: true },
      { name: 'reveal_file',   labelZh: '显示文件',    labelEn: 'Reveal file',       descZh: '在 Finder 中打开并高亮指定路径',         descEn: 'Open Finder and highlight the given path',     readOnly: false },
      { name: 'open_file',     labelZh: '打开文件',    labelEn: 'Open file',         descZh: '用默认应用打开文件',                     descEn: 'Open file with its default application',       readOnly: false },
      { name: 'set_tags',      labelZh: '设置标签',    labelEn: 'Set tags',          descZh: '设置/替换指定路径的 Finder 标签',       descEn: 'Set or replace Finder tags on a path',          readOnly: false },
      { name: 'set_comment',   labelZh: '设置注释',    labelEn: 'Set comment',       descZh: '设置 Finder 注释',                       descEn: 'Set Finder comment',                            readOnly: false },
      { name: 'move_to_trash', labelZh: '移到废纸篓',  labelEn: 'Move to Trash',     descZh: '将指定路径移到废纸篓（可恢复）',        descEn: 'Move a path to the Trash (recoverable)',       readOnly: false },
    ],
  },
  {
    id: 'macos-system',
    group: 'macos',
    platform: 'darwin',
    nameZh: '系统工具',
    nameEn: 'System Tools',
    descZh: '剪贴板、截图、Spotlight 搜索、系统通知',
    descEn: 'Clipboard, screenshot, Spotlight search, notifications',
    icon: '🛠',
    script: 'system.mjs',
    tools: [
      { name: 'read_clipboard',     labelZh: '读取剪贴板',     labelEn: 'Read clipboard',     descZh: '读取当前剪贴板的文本内容',                   descEn: 'Read current clipboard text',                    readOnly: true },
      { name: 'spotlight_search',   labelZh: 'Spotlight 搜索', labelEn: 'Spotlight search',   descZh: '用 Spotlight (mdfind) 搜索本地文件',         descEn: 'Search local files with Spotlight (mdfind)',     readOnly: true },
      { name: 'list_running_apps',  labelZh: '运行中的应用',   labelEn: 'Running apps',       descZh: '列出当前正在运行的应用',                     descEn: 'List currently running applications',             readOnly: true },
      { name: 'write_clipboard',    labelZh: '写入剪贴板',     labelEn: 'Write clipboard',    descZh: '把文本写入剪贴板',                           descEn: 'Write text to clipboard',                        readOnly: false },
      { name: 'capture_screen',     labelZh: '截屏',           labelEn: 'Capture screen',     descZh: '截屏并保存到指定路径（默认桌面，支持区域）', descEn: 'Take a screenshot, save to path (supports area)', readOnly: false },
      { name: 'show_notification',  labelZh: '发送系统通知',   labelEn: 'Show notification',  descZh: '通过系统通知中心弹出一条通知',               descEn: 'Display a macOS system notification',            readOnly: false },
      { name: 'open_app',           labelZh: '打开应用',       labelEn: 'Open app',           descZh: '启动或激活指定应用',                         descEn: 'Launch or activate an application',              readOnly: false },
      { name: 'set_volume',         labelZh: '设置音量',       labelEn: 'Set volume',         descZh: '设置系统输出音量（0–100）',                  descEn: 'Set system output volume (0–100)',               readOnly: false },
      { name: 'show_dialog',        labelZh: '系统弹窗',       labelEn: 'Show dialog',        descZh: '弹出系统对话框（用于提示/确认）',            descEn: 'Show a system dialog (prompt / confirm)',        readOnly: false },
      { name: 'lock_screen',        labelZh: '锁屏',           labelEn: 'Lock screen',        descZh: '立即锁定屏幕',                               descEn: 'Lock the screen immediately',                    readOnly: false },
    ],
  },
]

/** Server name prefix to avoid collision with user-added MCP servers */
export const CONNECTOR_SERVER_PREFIX = 'klaus-'

export function connectorServerName(id: string): string {
  return `${CONNECTOR_SERVER_PREFIX}${id}`
}

export function parseConnectorServer(name: string): string | null {
  if (!name.startsWith(CONNECTOR_SERVER_PREFIX)) return null
  return name.slice(CONNECTOR_SERVER_PREFIX.length)
}

export function getConnectorById(id: string): ConnectorEntry | undefined {
  return CONNECTOR_CATALOG.find(c => c.id === id)
}
