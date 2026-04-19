/**
 * Built-in MCP server catalog.
 * Each entry has a canonical server name (used as the key in .mcp.json)
 * and default config pointing to a real official/community MCP server.
 */

export interface BuiltinMcpEntry {
  /** Stable identifier, also used as the .mcp.json key when installed */
  id: string
  /** Display name (Chinese) */
  nameZh: string
  nameEn: string
  descZh: string
  descEn: string
  /** Inner SVG content (no <svg> wrapper). Rendered with viewBox 0 0 24 24,
   *  stroke=currentColor, stroke-width 1.7, fill=none. */
  iconSvg: string
  /** Official docs/source link */
  link: string
  /** How this server is authenticated in UI */
  auth: 'oauth' | 'apikey' | 'none'
  /** Default MCP config written to .mcp.json when user installs */
  config: Record<string, unknown>
  /** Required env keys (UI prompts user to fill before install) */
  envKeys?: { key: string; label: string; secret?: boolean }[]
}

export const BUILTIN_MCP_CATALOG: BuiltinMcpEntry[] = [
  {
    id: 'notion',
    nameZh: 'Notion',
    nameEn: 'Notion',
    descZh: '读取和更新 Notion 页面及数据库',
    descEn: 'Read and update Notion pages and databases',
    iconSvg: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8.5 8v8M8.5 8l7 8M15.5 8v8"/>',
    link: 'https://developers.notion.com/docs/mcp',
    auth: 'oauth',
    config: { type: 'http', url: 'https://mcp.notion.com/mcp' },
  },
  {
    id: 'linear',
    nameZh: 'Linear',
    nameEn: 'Linear',
    descZh: '管理 Linear 问题、项目和团队',
    descEn: 'Manage Linear issues, projects and teams',
    iconSvg: '<line x1="5" y1="6" x2="19" y2="6"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="18" x2="13" y2="18"/>',
    link: 'https://linear.app/docs/mcp',
    auth: 'oauth',
    config: { type: 'sse', url: 'https://mcp.linear.app/sse' },
  },
  {
    id: 'amap',
    nameZh: '高德地图',
    nameEn: 'Amap',
    descZh: '高德地图 MCP 服务，提供地理位置、路径规划等能力',
    descEn: 'Amap MCP server: geocoding, routing, POI search',
    iconSvg: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    link: 'https://lbs.amap.com/api/mcp-server',
    auth: 'apikey',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@amap/amap-maps-mcp-server'],
      env: { AMAP_MAPS_API_KEY: '${AMAP_MAPS_API_KEY}' },
    },
    envKeys: [{ key: 'AMAP_MAPS_API_KEY', label: '高德 API Key', secret: true }],
  },
  {
    id: 'arxiv',
    nameZh: 'arXiv',
    nameEn: 'arXiv',
    descZh: '搜索和下载 arXiv 论文',
    descEn: 'Search and download arXiv papers',
    iconSvg: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
    link: 'https://github.com/blazickjp/arxiv-mcp-server',
    auth: 'none',
    config: {
      type: 'stdio',
      command: 'uvx',
      args: ['arxiv-mcp-server'],
    },
  },
  {
    id: 'todoist',
    nameZh: 'Todoist',
    nameEn: 'Todoist',
    descZh: '管理 Todoist 任务和项目',
    descEn: 'Manage Todoist tasks and projects',
    iconSvg: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    link: 'https://github.com/abhiz123/todoist-mcp-server',
    auth: 'apikey',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@abhiz123/todoist-mcp-server'],
      env: { TODOIST_API_TOKEN: '${TODOIST_API_TOKEN}' },
    },
    envKeys: [{ key: 'TODOIST_API_TOKEN', label: 'Todoist API Token', secret: true }],
  },
  {
    id: 'github',
    nameZh: 'GitHub',
    nameEn: 'GitHub',
    descZh: '管理 GitHub 仓库、问题、拉取请求等',
    descEn: 'Manage GitHub repos, issues, pull requests',
    iconSvg: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
    link: 'https://github.com/github/github-mcp-server',
    auth: 'oauth',
    config: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
  },
  {
    id: 'slack',
    nameZh: 'Slack',
    nameEn: 'Slack',
    descZh: '发送消息、管理频道，与 Slack 工作区交互',
    descEn: 'Send messages and interact with Slack workspaces',
    iconSvg: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    link: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    auth: 'apikey',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}', SLACK_TEAM_ID: '${SLACK_TEAM_ID}' },
    },
    envKeys: [
      { key: 'SLACK_BOT_TOKEN', label: 'Slack Bot Token', secret: true },
      { key: 'SLACK_TEAM_ID', label: 'Slack Team ID' },
    ],
  },
  {
    id: 'line',
    nameZh: 'LINE',
    nameEn: 'LINE',
    descZh: '发送消息并与 LINE Bot Messaging API 交互',
    descEn: 'Send messages via LINE Bot Messaging API',
    iconSvg: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    link: 'https://github.com/line/line-bot-mcp-server',
    auth: 'apikey',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@line/line-bot-mcp-server'],
      env: {
        CHANNEL_ACCESS_TOKEN: '${CHANNEL_ACCESS_TOKEN}',
        DESTINATION_USER_ID: '${DESTINATION_USER_ID}',
      },
    },
    envKeys: [
      { key: 'CHANNEL_ACCESS_TOKEN', label: 'LINE Channel Access Token', secret: true },
      { key: 'DESTINATION_USER_ID', label: 'Destination User ID' },
    ],
  },
  {
    id: 'canva',
    nameZh: 'Canva',
    nameEn: 'Canva',
    descZh: '创建和编辑 Canva 设计，访问模板和素材',
    descEn: 'Create and edit Canva designs, access templates',
    iconSvg: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.43-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.12a1.64 1.64 0 0 1 1.67-1.67h1.99c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>',
    link: 'https://www.canva.dev/docs/connect/',
    auth: 'oauth',
    config: { type: 'http', url: 'https://mcp.canva.com/mcp' },
  },
  {
    id: 'supabase',
    nameZh: 'Supabase',
    nameEn: 'Supabase',
    descZh: '管理 Supabase 项目、数据库和边缘函数',
    descEn: 'Manage Supabase projects, databases and edge functions',
    iconSvg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    link: 'https://github.com/supabase-community/supabase-mcp',
    auth: 'apikey',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@supabase/mcp-server-supabase'],
      env: { SUPABASE_ACCESS_TOKEN: '${SUPABASE_ACCESS_TOKEN}' },
    },
    envKeys: [{ key: 'SUPABASE_ACCESS_TOKEN', label: 'Supabase Access Token', secret: true }],
  },
  {
    id: 'vercel',
    nameZh: 'Vercel',
    nameEn: 'Vercel',
    descZh: '管理 Vercel 项目、部署和 Serverless 函数',
    descEn: 'Manage Vercel projects, deployments and serverless functions',
    iconSvg: '<path d="M12 3L2 21h20L12 3z"/>',
    link: 'https://vercel.com/docs/mcp',
    auth: 'oauth',
    config: { type: 'http', url: 'https://mcp.vercel.com/' },
  },
  {
    id: 'neon',
    nameZh: 'Neon',
    nameEn: 'Neon',
    descZh: '管理 Neon Serverless Postgres 数据库、分支和项目',
    descEn: 'Manage Neon serverless Postgres databases and branches',
    iconSvg: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
    link: 'https://github.com/neondatabase/mcp-server-neon',
    auth: 'oauth',
    config: { type: 'sse', url: 'https://mcp.neon.tech/sse' },
  },
  {
    id: 'figma',
    nameZh: 'Figma',
    nameEn: 'Figma',
    descZh: '访问 Figma 设计、组件，协作编辑文件（需打开 Figma Desktop 并启用 Dev Mode MCP）',
    descEn: 'Access Figma designs (requires Figma Desktop with Dev Mode MCP enabled)',
    iconSvg: '<path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H12v7H8.5A3.5 3.5 0 0 1 5 5.5z"/><path d="M12 2h3.5a3.5 3.5 0 1 1 0 7H12V2z"/><path d="M12 12.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0z"/><path d="M5 19.5A3.5 3.5 0 0 1 8.5 16H12v3.5a3.5 3.5 0 1 1-7 0z"/><path d="M5 12.5A3.5 3.5 0 0 1 8.5 9H12v7H8.5A3.5 3.5 0 0 1 5 12.5z"/>',
    link: 'https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Dev-Mode-MCP-Server',
    auth: 'oauth',
    config: { type: 'sse', url: 'http://127.0.0.1:3845/sse' },
  },
  {
    id: 'gcal',
    nameZh: 'Google 日历',
    nameEn: 'Google Calendar',
    descZh: '管理 Google 日历事件，创建会议，查看日程安排',
    descEn: 'Manage Google Calendar events and meetings',
    iconSvg: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    link: 'https://github.com/nspady/google-calendar-mcp',
    auth: 'oauth',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@cocal/google-calendar-mcp'],
      env: { GOOGLE_OAUTH_CREDENTIALS: '${GOOGLE_OAUTH_CREDENTIALS}' },
    },
    envKeys: [
      { key: 'GOOGLE_OAUTH_CREDENTIALS', label: 'GCP OAuth Credentials JSON path' },
    ],
  },
  {
    id: 'gmaps',
    nameZh: 'Google 地图',
    nameEn: 'Google Maps',
    descZh: '搜索地点、获取路线、计算距离、查找附近位置',
    descEn: 'Search places, get routes and nearby locations',
    iconSvg: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
    link: 'https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps',
    auth: 'apikey',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-google-maps'],
      env: { GOOGLE_MAPS_API_KEY: '${GOOGLE_MAPS_API_KEY}' },
    },
    envKeys: [{ key: 'GOOGLE_MAPS_API_KEY', label: 'Google Maps API Key', secret: true }],
  },
  {
    id: 'airtable',
    nameZh: 'Airtable',
    nameEn: 'Airtable',
    descZh: '访问和管理 Airtable 数据库、表格和记录',
    descEn: 'Access Airtable bases, tables and records',
    iconSvg: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
    link: 'https://github.com/domdomegg/airtable-mcp-server',
    auth: 'apikey',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'airtable-mcp-server'],
      env: { AIRTABLE_API_KEY: '${AIRTABLE_API_KEY}' },
    },
    envKeys: [{ key: 'AIRTABLE_API_KEY', label: 'Airtable Personal Access Token', secret: true }],
  },
]

export function getBuiltinById(id: string): BuiltinMcpEntry | undefined {
  return BUILTIN_MCP_CATALOG.find(e => e.id === id)
}

/**
 * Expand ${VAR} placeholders in config using provided env map.
 * Used when installing a built-in server to materialize the real config
 * (with user-provided API keys) into .mcp.json.
 */
export function materializeConfig(
  template: Record<string, unknown>,
  envValues: Record<string, string>,
): Record<string, unknown> {
  const replace = (v: unknown): unknown => {
    if (typeof v === 'string') {
      return v.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => envValues[k] ?? '')
    }
    if (Array.isArray(v)) return v.map(replace)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v)) out[k] = replace(val)
      return out
    }
    return v
  }
  return replace(template) as Record<string, unknown>
}
