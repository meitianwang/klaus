// Klaus connector: Safari (via AppleScript + JavaScript-for-Automation)
import { runServer, osa, esc } from './_mcp.mjs'

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
  ],
})
