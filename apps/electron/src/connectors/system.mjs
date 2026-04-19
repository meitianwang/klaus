// Klaus connector: macOS system tools
//   clipboard  (pbpaste / pbcopy)
//   screenshot (screencapture)
//   spotlight  (mdfind)
//   notification (osascript display notification)
import { runServer, osa, esc, run } from './_mcp.mjs'
import { homedir } from 'node:os'
import { join } from 'node:path'

runServer({
  name: 'klaus-macos-system',
  tools: [
    {
      name: 'read_clipboard',
      description: 'Read the current clipboard as plain text.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const out = await run('/usr/bin/pbpaste', [])
        return { content: [{ type: 'text', text: out }] }
      },
    },

    {
      name: 'spotlight_search',
      description: 'Search local files with Spotlight (mdfind). Use raw Spotlight query syntax or a plain keyword.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Spotlight query (e.g. "kMDItemKind == \'PDF document\'" or plain keyword)' },
          onlyin: { type: 'string', description: 'Limit search to a directory (optional)' },
          limit: { type: 'number', default: 50 },
        },
        required: ['query'],
      },
      handler: async ({ query, onlyin, limit = 50 }) => {
        const args = []
        if (onlyin) { args.push('-onlyin', onlyin) }
        args.push(query)
        const out = await run('/usr/bin/mdfind', args, { timeout: 20_000 })
        const paths = out.split('\n').filter(Boolean).slice(0, Math.max(1, Math.min(500, limit)))
        return { content: [{ type: 'text', text: JSON.stringify({ query, count: paths.length, paths }, null, 2) }] }
      },
    },

    {
      name: 'write_clipboard',
      description: 'Write plain text to the clipboard. Overwrites current contents.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      handler: async ({ text }) => {
        await run('/usr/bin/pbcopy', [], { stdin: text })
        return { content: [{ type: 'text', text: `Wrote ${text.length} char(s) to clipboard` }] }
      },
    },

    {
      name: 'capture_screen',
      description: 'Take a screenshot. Defaults to fullscreen on Desktop. Optional `region` = "x,y,w,h" for a rectangular capture. Optional `path` for custom location.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path. Defaults to ~/Desktop/klaus-capture-<ts>.png' },
          region: { type: 'string', description: 'Rectangular region "x,y,w,h" (optional)' },
          silent: { type: 'boolean', description: 'Suppress shutter sound', default: true },
        },
      },
      handler: async ({ path, region, silent = true }) => {
        const dest = path || join(homedir(), 'Desktop', `klaus-capture-${Date.now()}.png`)
        const args = []
        if (silent) args.push('-x')
        if (region) args.push('-R', region)
        args.push(dest)
        await run('/usr/sbin/screencapture', args, { timeout: 10_000 })
        return { content: [{ type: 'text', text: `Saved screenshot to ${dest}` }] }
      },
    },

    {
      name: 'show_notification',
      description: 'Display a macOS system notification.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          message: { type: 'string' },
          subtitle: { type: 'string' },
        },
        required: ['title', 'message'],
      },
      handler: async ({ title, message, subtitle }) => {
        const parts = [`display notification "${esc(message)}"`, `with title "${esc(title)}"`]
        if (subtitle) parts.push(`subtitle "${esc(subtitle)}"`)
        await osa(parts.join(' '))
        return { content: [{ type: 'text', text: `Notification shown: ${title}` }] }
      },
    },
  ],
})
