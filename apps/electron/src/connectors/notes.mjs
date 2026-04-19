// Klaus connector: macOS Notes (via AppleScript)
import { runServer, osa, esc } from './_mcp.mjs'

runServer({
  name: 'klaus-macos-notes',
  tools: [
    {
      name: 'list_notes',
      description: 'List notes (name + modified date). Optionally filter by folder. Results are body-free; use read_note to get content.',
      inputSchema: {
        type: 'object',
        properties: {
          folderName: { type: 'string' },
          limit: { type: 'number', default: 100 },
        },
      },
      handler: async ({ folderName, limit = 100 }) => {
        const maxN = Math.max(1, Math.min(500, limit))
        const script = folderName
          ? `
          set output to ""
          set matched to 0
          tell application "Notes"
            tell folder "${esc(folderName)}"
              set ns to every note
              repeat with n in ns
                if matched ≥ ${maxN} then exit repeat
                set output to output & (name of n) & "\t" & ((modification date of n) as string) & linefeed
                set matched to matched + 1
              end repeat
            end tell
          end tell
          return output
        `
          : `
          set output to ""
          set matched to 0
          tell application "Notes"
            repeat with f in folders
              if matched ≥ ${maxN} then exit repeat
              set fnm to name of f
              tell f
                set ns to every note
                repeat with n in ns
                  if matched ≥ ${maxN} then exit repeat
                  set output to output & fnm & "\t" & (name of n) & "\t" & ((modification date of n) as string) & linefeed
                  set matched to matched + 1
                end repeat
              end tell
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const items = raw.split('\n').filter(Boolean).map(line => {
          const parts = line.split('\t')
          if (folderName) {
            const [name, modified] = parts
            return { folder: folderName, name, modified }
          }
          const [folder, name, modified] = parts
          return { folder, name, modified }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ count: items.length, notes: items }, null, 2) }] }
      },
    },

    {
      name: 'search_notes',
      description: 'Search notes by keyword in title or body. Returns name + snippet.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 30 },
        },
        required: ['query'],
      },
      handler: async ({ query, limit = 30 }) => {
        const maxN = Math.max(1, Math.min(100, limit))
        const script = `
          set output to ""
          set matched to 0
          tell application "Notes"
            set hits to notes whose body contains "${esc(query)}" or name contains "${esc(query)}"
            repeat with n in hits
              if matched ≥ ${maxN} then exit repeat
              set bd to body of n as string
              if length of bd > 200 then
                set snippet to text 1 thru 200 of bd
              else
                set snippet to bd
              end if
              set fnm to ""
              try
                set fnm to name of container of n
              end try
              set output to output & fnm & "\t" & (name of n) & "\t" & snippet & linefeed
              set matched to matched + 1
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const items = raw.split('\n').filter(Boolean).map(line => {
          const [folder, name, snippet] = line.split('\t')
          return { folder: folder || null, name, snippet: (snippet || '').replace(/<[^>]+>/g, '').slice(0, 200) }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ query, count: items.length, notes: items }, null, 2) }] }
      },
    },

    {
      name: 'read_note',
      description: 'Read the full body of a note by title (first match). Returns plain-text (HTML stripped).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          folderName: { type: 'string', description: 'Optionally scope to a folder' },
        },
        required: ['name'],
      },
      handler: async ({ name, folderName }) => {
        const scope = folderName
          ? `tell folder "${esc(folderName)}"`
          : ''
        const script = `
          tell application "Notes"
            ${scope}
              set hits to notes whose name is "${esc(name)}"
              if (count of hits) > 0 then
                set n to item 1 of hits
                return (body of n)
              else
                return ""
              end if
            ${scope ? 'end tell' : ''}
          end tell
        `
        const raw = await osa(script)
        if (!raw) throw new Error(`Note not found: ${name}`)
        const plain = raw.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        return { content: [{ type: 'text', text: plain }] }
      },
    },

    {
      name: 'create_note',
      description: 'Create a new note. Body is plain text (line breaks preserved).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          folderName: { type: 'string' },
        },
        required: ['title', 'body'],
      },
      handler: async ({ title, body, folderName }) => {
        // Notes stores HTML; preserve line breaks by wrapping in <div> per line
        const htmlBody = `<h1>${esc(title)}</h1>` +
          body.split('\n').map(line => `<div>${esc(line).replace(/</g, '&lt;')}</div>`).join('')
        const props = `{name:"${esc(title)}", body:"${esc(htmlBody)}"}`
        const script = folderName
          ? `tell application "Notes" to tell folder "${esc(folderName)}" to make new note with properties ${props}`
          : `tell application "Notes" to make new note with properties ${props}`
        await osa(script)
        return { content: [{ type: 'text', text: `Created note: ${title}` }] }
      },
    },
  ],
})
