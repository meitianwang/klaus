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

    {
      name: 'list_running_apps',
      description: 'List the names of currently running applications (from System Events).',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const script = `
          set output to ""
          tell application "System Events"
            repeat with p in (every application process where background only is false)
              set output to output & (name of p) & linefeed
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const apps = raw.split('\n').map(s => s.trim()).filter(Boolean)
        return { content: [{ type: 'text', text: JSON.stringify({ count: apps.length, apps }, null, 2) }] }
      },
    },

    {
      name: 'open_app',
      description: 'Launch or activate an application by name (e.g. "Safari", "Messages", "TextEdit").',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      handler: async ({ name }) => {
        const script = `tell application "${esc(name)}" to activate`
        await osa(script)
        return { content: [{ type: 'text', text: `Activated ${name}` }] }
      },
    },

    {
      name: 'set_volume',
      description: 'Set system output volume (0–100).',
      inputSchema: {
        type: 'object',
        properties: {
          level: { type: 'number', description: '0 (mute) to 100 (max)' },
        },
        required: ['level'],
      },
      handler: async ({ level }) => {
        const n = Math.max(0, Math.min(100, Math.round(level)))
        // `set volume output volume <0-100>` — AppleScript native
        await osa(`set volume output volume ${n}`)
        return { content: [{ type: 'text', text: `Volume set to ${n}` }] }
      },
    },

    {
      name: 'show_dialog',
      description: 'Show a macOS system dialog. Returns the button the user clicked, or an error if they canceled / timed out. Useful for confirmation before destructive actions or asking user for a quick decision.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          title: { type: 'string' },
          buttons: { type: 'array', items: { type: 'string' }, description: 'Up to 3 button labels (default: ["OK"])' },
          defaultButton: { type: 'string' },
          timeoutSeconds: { type: 'number', default: 60 },
        },
        required: ['message'],
      },
      handler: async ({ message, title, buttons, defaultButton, timeoutSeconds = 60 }) => {
        const btns = (buttons && buttons.length) ? buttons : ['OK']
        const parts = [
          `display dialog "${esc(message)}"`,
          `buttons {${btns.map(b => `"${esc(b)}"`).join(', ')}}`,
        ]
        if (title) parts.push(`with title "${esc(title)}"`)
        if (defaultButton) parts.push(`default button "${esc(defaultButton)}"`)
        parts.push(`giving up after ${Math.max(5, Math.min(600, timeoutSeconds))}`)
        const script = `
          try
            set r to ${parts.join(' ')}
            if gave up of r then return "GAVE_UP"
            return button returned of r
          on error errMsg number errNum
            if errNum = -128 then return "CANCELED"
            error errMsg
          end try
        `
        const raw = await osa(script, { timeout: (timeoutSeconds + 5) * 1000 })
        if (raw === 'CANCELED') throw new Error('User canceled the dialog')
        if (raw === 'GAVE_UP') throw new Error(`Dialog timed out after ${timeoutSeconds}s`)
        return { content: [{ type: 'text', text: JSON.stringify({ button: raw }, null, 2) }] }
      },
    },

    {
      name: 'lock_screen',
      description: 'Lock the screen immediately.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        // Uses the private but stable CGSession tool (shipped with macOS)
        await run('/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession', ['-suspend'])
        return { content: [{ type: 'text', text: 'Screen locked' }] }
      },
    },
  ],
})
