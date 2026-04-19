// Klaus connector: Finder (tags / comments / selection / trash / reveal)
import { runServer, osa, esc, run } from './_mcp.mjs'

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

    {
      name: 'get_comment',
      description: 'Read the Finder comment (aka Spotlight comment) attached to a path.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      handler: async ({ path }) => {
        const script = `
          tell application "Finder"
            set f to POSIX file "${esc(path)}" as alias
            return (comment of f) as string
          end tell
        `
        const raw = await osa(script)
        return { content: [{ type: 'text', text: JSON.stringify({ path, comment: raw }, null, 2) }] }
      },
    },

    {
      name: 'set_comment',
      description: 'Set the Finder comment on a path (overwrites any existing comment).',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          comment: { type: 'string' },
        },
        required: ['path', 'comment'],
      },
      handler: async ({ path, comment }) => {
        const script = `
          tell application "Finder"
            set f to POSIX file "${esc(path)}" as alias
            set comment of f to "${esc(comment)}"
          end tell
        `
        await osa(script)
        return { content: [{ type: 'text', text: `Set comment on ${path}` }] }
      },
    },

    {
      name: 'get_file_info',
      description: 'Get file metadata: size (bytes), kind (file/folder/alias), creation and modification timestamps.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      handler: async ({ path }) => {
        const script = `
          tell application "Finder"
            set f to POSIX file "${esc(path)}" as alias
            set kindStr to "file"
            try
              if class of f is folder then set kindStr to "folder"
            end try
            set sz to 0
            try
              set sz to size of f
            end try
            set cd to ""
            try
              set cd to (creation date of f) as string
            end try
            set md to ""
            try
              set md to (modification date of f) as string
            end try
            return kindStr & linefeed & (sz as string) & linefeed & cd & linefeed & md
          end tell
        `
        const raw = await osa(script)
        const [kind, sizeStr, created, modified] = raw.split('\n')
        return { content: [{ type: 'text', text: JSON.stringify({
          path,
          kind,
          size: parseInt(sizeStr, 10) || 0,
          created,
          modified,
        }, null, 2) }] }
      },
    },

    {
      name: 'list_folder',
      description: 'List the contents of a folder with Finder metadata (name, kind, size, tags). Non-recursive.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          limit: { type: 'number', default: 200 },
        },
        required: ['path'],
      },
      handler: async ({ path, limit = 200 }) => {
        const maxN = Math.max(1, Math.min(2000, limit))
        const script = `
          set output to ""
          set matched to 0
          tell application "Finder"
            set f to POSIX file "${esc(path)}" as alias
            repeat with item_ in (items of folder f)
              if matched ≥ ${maxN} then exit repeat
              set itemName to name of item_
              set itemKind to "file"
              try
                if class of item_ is folder then set itemKind to "folder"
              end try
              set itemSize to 0
              try
                set itemSize to size of item_
              end try
              set tagList to ""
              try
                set AppleScript's text item delimiters to ","
                set tagList to (label names of item_) as string
                set AppleScript's text item delimiters to ""
              end try
              set output to output & itemName & "\t" & itemKind & "\t" & (itemSize as string) & "\t" & tagList & linefeed
              set matched to matched + 1
            end repeat
          end tell
          return output
        `
        const raw = await osa(script, { timeout: 30_000 })
        const items = raw.split('\n').filter(Boolean).map(line => {
          const [name, kind, size, tagList] = line.split('\t')
          return {
            name,
            kind,
            size: parseInt(size, 10) || 0,
            tags: (tagList || '').split(',').map(s => s.trim()).filter(Boolean),
          }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ path, count: items.length, items }, null, 2) }] }
      },
    },

    {
      name: 'open_file',
      description: 'Open a file with its default application (equivalent to macOS `open <path>`).',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      handler: async ({ path }) => {
        await run('/usr/bin/open', [path])
        return { content: [{ type: 'text', text: `Opened ${path}` }] }
      },
    },
  ],
})
