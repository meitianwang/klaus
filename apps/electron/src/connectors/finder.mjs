// Klaus connector: Finder (tags / selection / trash / reveal)
import { runServer, osa, esc } from './_mcp.mjs'

runServer({
  name: 'klaus-macos-finder',
  tools: [
    {
      name: 'get_selection',
      description: 'Get POSIX paths of the items currently selected in the frontmost Finder window.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const script = `
          set out to ""
          tell application "Finder"
            set sel to selection as alias list
            repeat with s in sel
              set out to out & POSIX path of s & linefeed
            end repeat
          end tell
          return out
        `
        const raw = await osa(script)
        const paths = raw.split('\n').map(s => s.trim()).filter(Boolean)
        return { content: [{ type: 'text', text: JSON.stringify({ count: paths.length, paths }, null, 2) }] }
      },
    },

    {
      name: 'get_tags',
      description: 'Read Finder tags attached to a path. Returns array of tag names.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      handler: async ({ path }) => {
        const script = `
          tell application "Finder"
            set f to POSIX file "${esc(path)}" as alias
            set tagList to label names of f
            set AppleScript's text item delimiters to "\t"
            set out to tagList as string
          end tell
          return out
        `
        try {
          const raw = await osa(script)
          const tags = raw.split('\t').map(s => s.trim()).filter(Boolean)
          return { content: [{ type: 'text', text: JSON.stringify({ path, tags }, null, 2) }] }
        } catch (err) {
          // `label names` requires macOS Finder that supports it; otherwise fallback to shell xattr
          throw new Error(`Failed to read tags on ${path}: ${err?.message || err}`)
        }
      },
    },

    {
      name: 'reveal_file',
      description: 'Open Finder and highlight the given path (does not open/edit the file).',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      handler: async ({ path }) => {
        const script = `
          tell application "Finder"
            activate
            reveal POSIX file "${esc(path)}"
          end tell
        `
        await osa(script)
        return { content: [{ type: 'text', text: `Revealed ${path}` }] }
      },
    },

    {
      name: 'set_tags',
      description: 'Replace Finder tags on a path. Pass an array of tag names (empty array clears tags).',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['path', 'tags'],
      },
      handler: async ({ path, tags }) => {
        const list = tags.map(t => `"${esc(t)}"`).join(', ')
        const script = `
          tell application "Finder"
            set f to POSIX file "${esc(path)}" as alias
            set label names of f to {${list}}
          end tell
        `
        await osa(script)
        return { content: [{ type: 'text', text: `Set ${tags.length} tag(s) on ${path}` }] }
      },
    },

    {
      name: 'move_to_trash',
      description: 'Move a file/folder to the Trash (recoverable from Trash). Safer than rm. Path must exist.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      handler: async ({ path }) => {
        const script = `
          tell application "Finder"
            move POSIX file "${esc(path)}" to trash
          end tell
        `
        await osa(script)
        return { content: [{ type: 'text', text: `Moved to Trash: ${path}` }] }
      },
    },
  ],
})
