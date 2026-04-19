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
      { name: 'list_reminders',    labelZh: '列出提醒事项', labelEn: 'List reminders',        descZh: '列出指定列表的提醒事项（或所有列表）', descEn: 'List reminders in a list (or all lists)', readOnly: true },
      { name: 'search_reminders',  labelZh: '搜索提醒',     labelEn: 'Search reminders',      descZh: '按关键字搜索提醒事项',               descEn: 'Search reminders by keyword',             readOnly: true },
      { name: 'create_reminder',   labelZh: '创建提醒',     labelEn: 'Create reminder',       descZh: '创建新的提醒事项',                   descEn: 'Create a new reminder',                   readOnly: false },
      { name: 'complete_reminder', labelZh: '完成提醒',     labelEn: 'Complete reminder',     descZh: '将提醒事项标记为已完成',             descEn: 'Mark a reminder as completed',            readOnly: false },
      { name: 'delete_reminder',   labelZh: '删除提醒',     labelEn: 'Delete reminder',       descZh: '删除提醒事项',                       descEn: 'Delete a reminder',                       readOnly: false },
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
      { name: 'list_events',   labelZh: '列出日历事件', labelEn: 'List events',   descZh: '列出指定时间段内的日历事件', descEn: 'List calendar events in a date range', readOnly: true },
      { name: 'search_events', labelZh: '搜索事件',     labelEn: 'Search events', descZh: '按关键字搜索日历事件',       descEn: 'Search calendar events by keyword',    readOnly: true },
      { name: 'create_event',  labelZh: '创建事件',     labelEn: 'Create event',  descZh: '创建新的日历事件',           descEn: 'Create a new calendar event',          readOnly: false },
      { name: 'delete_event',  labelZh: '删除事件',     labelEn: 'Delete event',  descZh: '删除日历事件',               descEn: 'Delete a calendar event',              readOnly: false },
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
      { name: 'list_notes',   labelZh: '列出备忘录', labelEn: 'List notes',   descZh: '列出备忘录（可按文件夹过滤）', descEn: 'List notes (optionally filter by folder)', readOnly: true },
      { name: 'search_notes', labelZh: '搜索备忘录', labelEn: 'Search notes', descZh: '按关键字搜索备忘录',           descEn: 'Search notes by keyword',                  readOnly: true },
      { name: 'read_note',    labelZh: '读取备忘录', labelEn: 'Read note',    descZh: '读取指定备忘录的内容',         descEn: 'Read the content of a specific note',      readOnly: true },
      { name: 'create_note',  labelZh: '创建备忘录', labelEn: 'Create note',  descZh: '创建新的备忘录',               descEn: 'Create a new note',                        readOnly: false },
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
      { name: 'list_mailboxes',  labelZh: '列出邮箱', labelEn: 'List mailboxes',  descZh: '列出所有邮箱',   descEn: 'List all mailboxes',         readOnly: true },
      { name: 'search_messages', labelZh: '搜索邮件', labelEn: 'Search messages', descZh: '按关键字搜索邮件', descEn: 'Search mail messages',       readOnly: true },
      { name: 'read_message',    labelZh: '读取邮件', labelEn: 'Read message',    descZh: '读取指定邮件内容', descEn: 'Read a specific message body', readOnly: true },
      { name: 'create_draft',    labelZh: '创建草稿', labelEn: 'Create draft',    descZh: '创建邮件草稿',   descEn: 'Create a mail draft',          readOnly: false },
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
      { name: 'search_contacts', labelZh: '搜索联系人', labelEn: 'Search contacts', descZh: '按关键字搜索联系人', descEn: 'Search contacts by keyword', readOnly: true },
      { name: 'read_contact',    labelZh: '读取联系人', labelEn: 'Read contact',    descZh: '读取联系人详细信息', descEn: 'Read contact details',       readOnly: true },
      { name: 'create_contact',  labelZh: '创建联系人', labelEn: 'Create contact',  descZh: '创建新联系人',       descEn: 'Create a new contact',       readOnly: false },
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
      { name: 'list_tabs',      labelZh: '列出标签页',   labelEn: 'List tabs',       descZh: '列出所有窗口和标签页', descEn: 'List all windows and tabs',                       readOnly: true },
      { name: 'get_active_tab', labelZh: '当前标签页',   labelEn: 'Active tab',      descZh: '获取当前活动标签页 URL、标题、选中文本', descEn: 'Get active tab URL, title and selection', readOnly: true },
      { name: 'read_tab',       labelZh: '读取页面内容', labelEn: 'Read page',       descZh: '读取指定标签页的纯文本正文',           descEn: 'Read plain-text body of a tab',           readOnly: true },
      { name: 'open_url',       labelZh: '打开网址',     labelEn: 'Open URL',        descZh: '在新标签页或当前标签页打开 URL',       descEn: 'Open a URL in a new or current tab',      readOnly: false },
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
      { name: 'get_selection', labelZh: '当前选中项', labelEn: 'Current selection', descZh: '读取 Finder 当前选中的文件/文件夹路径', descEn: 'Read paths of currently-selected Finder items', readOnly: true },
      { name: 'get_tags',      labelZh: '读取标签',   labelEn: 'Get tags',          descZh: '读取指定路径的 Finder 标签',             descEn: 'Read Finder tags on a given path',             readOnly: true },
      { name: 'reveal_file',   labelZh: '显示文件',   labelEn: 'Reveal file',       descZh: '在 Finder 中打开并高亮指定路径',         descEn: 'Open Finder and highlight the given path',     readOnly: false },
      { name: 'set_tags',      labelZh: '设置标签',   labelEn: 'Set tags',          descZh: '设置/替换指定路径的 Finder 标签',       descEn: 'Set or replace Finder tags on a path',          readOnly: false },
      { name: 'move_to_trash', labelZh: '移到废纸篓', labelEn: 'Move to Trash',     descZh: '将指定路径移到废纸篓（可恢复）',        descEn: 'Move a path to the Trash (recoverable)',       readOnly: false },
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
      { name: 'read_clipboard',    labelZh: '读取剪贴板',     labelEn: 'Read clipboard',    descZh: '读取当前剪贴板的文本内容',                   descEn: 'Read current clipboard text',                    readOnly: true },
      { name: 'spotlight_search',  labelZh: 'Spotlight 搜索', labelEn: 'Spotlight search',  descZh: '用 Spotlight (mdfind) 搜索本地文件',         descEn: 'Search local files with Spotlight (mdfind)',     readOnly: true },
      { name: 'write_clipboard',   labelZh: '写入剪贴板',     labelEn: 'Write clipboard',   descZh: '把文本写入剪贴板',                           descEn: 'Write text to clipboard',                        readOnly: false },
      { name: 'capture_screen',    labelZh: '截屏',           labelEn: 'Capture screen',    descZh: '截屏并保存到指定路径（默认桌面，支持区域）', descEn: 'Take a screenshot, save to path (supports area)', readOnly: false },
      { name: 'show_notification', labelZh: '发送系统通知',   labelEn: 'Show notification', descZh: '通过系统通知中心弹出一条通知',               descEn: 'Display a macOS system notification',            readOnly: false },
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
