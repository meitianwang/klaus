// Klaus connector: Safari (via AppleScript + sqlite3 for history + plutil for bookmarks)
import { runServer, osa, esc, run } from './_mcp.mjs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HISTORY_DB = join(homedir(), 'Library/Safari/History.db')
const BOOKMARKS_PLIST = join(homedir(), 'Library/Safari/Bookmarks.plist')
// Mac Absolute Time (seconds since 2001-01-01) → Unix epoch offset
const MAC_EPOCH_OFFSET = 978307200

function flattenBookmarks(node, path = []) {
  const out = []
  if (!node) return out
  if (Array.isArray(node.Children)) {
    const folderName = node.Title || ''
    const nextPath = folderName ? [...path, folderName] : path
    for (const child of node.Children) out.push(...flattenBookmarks(child, nextPath))
  } else if (node.WebBookmarkType === 'WebBookmarkTypeLeaf' && node.URLString) {
    out.push({
      title: node.URIDictionary?.title || node.URLString,
      url: node.URLString,
      folder: path.join(' / '),
    })
  }
  return out
}

runServer({
  name: 'klaus-macos-safari',
  tools: [
    {
      name: 'list_tabs',
      description: 'List all Safari windows and their tabs (index, URL, title). Returns JSON.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const script = `
          set output to ""
          tell application "Safari"
            set wins to every window
            set wIdx to 0
            repeat with w in wins
              set wIdx to wIdx + 1
              set tIdx to 0
              repeat with t in tabs of w
                set tIdx to tIdx + 1
                set u to ""
                set ti to ""
                try
                  set u to URL of t
                end try
                try
                  set ti to name of t
                end try
                set output to output & wIdx & "\t" & tIdx & "\t" & u & "\t" & ti & linefeed
              end repeat
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const tabs = raw.split('\n').filter(Boolean).map(line => {
          const [w, t, url, title] = line.split('\t')
          return { window: parseInt(w, 10), tab: parseInt(t, 10), url, title: title || '' }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ count: tabs.length, tabs }, null, 2) }] }
      },
    },

    {
      name: 'get_active_tab',
      description: 'Get the URL, title and user-selected text of the frontmost Safari tab.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const script = `
          tell application "Safari"
            set u to ""
            set ti to ""
            try
              set u to URL of current tab of front window
              set ti to name of current tab of front window
            end try
          end tell
          set sel to ""
          try
            tell application "Safari"
              set sel to (do JavaScript "window.getSelection().toString()" in current tab of front window)
            end tell
          end try
          return u & linefeed & ti & linefeed & "---" & linefeed & sel
        `
        const raw = await osa(script)
        const [url = '', title = '', , ...selParts] = raw.split('\n')
        const selection = selParts.join('\n')
        return { content: [{ type: 'text', text: JSON.stringify({ url, title, selection }, null, 2) }] }
      },
    },

    {
      name: 'read_tab',
      description: 'Read the plain-text body of a Safari tab (active tab by default, or window/tab indices from list_tabs). Requires "Allow JavaScript from Apple Events" in Safari Develop menu.',
      inputSchema: {
        type: 'object',
        properties: {
          window: { type: 'number', description: 'Window index from list_tabs (default = front window)' },
          tab: { type: 'number', description: 'Tab index from list_tabs (default = current tab)' },
          limit: { type: 'number', description: 'Max characters to return', default: 8000 },
        },
      },
      handler: async ({ window: wi, tab: ti, limit = 8000 }) => {
        const target = (wi && ti)
          ? `tab ${ti} of window ${wi}`
          : `current tab of front window`
        const script = `
          tell application "Safari"
            set body_ to (do JavaScript "document.body.innerText" in ${target})
          end tell
          return body_
        `
        const raw = await osa(script, { timeout: 20_000 })
        const trimmed = raw.length > limit ? raw.slice(0, limit) + `\n…(truncated, total ${raw.length} chars)` : raw
        return { content: [{ type: 'text', text: trimmed }] }
      },
    },

    {
      name: 'open_url',
      description: 'Open a URL in Safari. By default opens in a new tab; set `current=true` to navigate the front tab.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          current: { type: 'boolean', default: false },
        },
        required: ['url'],
      },
      handler: async ({ url, current = false }) => {
        const script = current
          ? `tell application "Safari" to set URL of current tab of front window to "${esc(url)}"`
          : `tell application "Safari"
               activate
               tell front window to set newTab to make new tab with properties {URL:"${esc(url)}"}
               set current tab of front window to newTab
             end tell`
        await osa(script)
        return { content: [{ type: 'text', text: `Opened ${url}` }] }
      },
    },

    {
      name: 'switch_to_tab',
      description: 'Activate Safari and switch to a specific window/tab (indices from list_tabs).',
      inputSchema: {
        type: 'object',
        properties: {
          window: { type: 'number' },
          tab: { type: 'number' },
        },
        required: ['window', 'tab'],
      },
      handler: async ({ window: wi, tab: ti }) => {
        const script = `
          tell application "Safari"
            activate
            set current tab of window ${wi} of application "Safari" to tab ${ti} of window ${wi} of application "Safari"
            set index of window ${wi} of application "Safari" to 1
          end tell
        `
        await osa(script)
        return { content: [{ type: 'text', text: `Switched to window ${wi}, tab ${ti}` }] }
      },
    },

    {
      name: 'close_tab',
      description: 'Close a specific Safari tab by window/tab indices (from list_tabs).',
      inputSchema: {
        type: 'object',
        properties: {
          window: { type: 'number' },
          tab: { type: 'number' },
        },
        required: ['window', 'tab'],
      },
      handler: async ({ window: wi, tab: ti }) => {
        const script = `tell application "Safari" to close tab ${ti} of window ${wi}`
        await osa(script)
        return { content: [{ type: 'text', text: `Closed window ${wi}, tab ${ti}` }] }
      },
    },

    {
      name: 'list_bookmarks',
      description: 'List Safari bookmarks (title, URL, folder path). Requires Full Disk Access to read ~/Library/Safari/Bookmarks.plist.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 200 },
        },
      },
      handler: async ({ limit = 200 }) => {
        let json
        try {
          const out = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', BOOKMARKS_PLIST])
          json = JSON.parse(out)
        } catch (err) {
          const msg = String(err?.message || '')
          if (msg.includes('Operation not permitted') || msg.includes('No such file')) {
            throw new Error('Cannot read Safari bookmarks — grant Klaus "Full Disk Access" in System Settings › Privacy & Security.')
          }
          throw err
        }
        const all = flattenBookmarks(json)
        const capped = all.slice(0, Math.max(1, Math.min(1000, limit)))
        return { content: [{ type: 'text', text: JSON.stringify({ count: capped.length, total: all.length, bookmarks: capped }, null, 2) }] }
      },
    },

    {
      name: 'list_history',
      description: 'List recent Safari browsing history (newest first). Requires Full Disk Access to read ~/Library/Safari/History.db.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 50 },
        },
      },
      handler: async ({ limit = 50 }) => {
        const sql = `
          SELECT hi.url, hv.title, hv.visit_time
          FROM history_visits hv
          JOIN history_items hi ON hi.id = hv.history_item
          ORDER BY hv.visit_time DESC
          LIMIT ${Math.max(1, Math.min(500, limit))}
        `
        let out
        try {
          out = await run('/usr/bin/sqlite3', ['-json', '-readonly', HISTORY_DB, sql], { timeout: 15_000 })
        } catch (err) {
          const msg = String(err?.message || '')
          if (msg.includes('unable to open database file') || msg.includes('authorization denied')) {
            throw new Error('Cannot read Safari history — grant Klaus "Full Disk Access" in System Settings › Privacy & Security.')
          }
          throw err
        }
        const rows = out.trim() ? JSON.parse(out) : []
        const items = rows.map(r => ({
          url: r.url,
          title: r.title || null,
          visited: new Date((Number(r.visit_time) + MAC_EPOCH_OFFSET) * 1000).toISOString(),
        }))
        return { content: [{ type: 'text', text: JSON.stringify({ count: items.length, history: items }, null, 2) }] }
      },
    },
  ],
})
