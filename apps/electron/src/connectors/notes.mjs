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

    {
      name: 'update_note',
      description: 'Update a note: change its title, body, or move it to another folder. Matches first note with the given title (optionally scoped to `folderName`). Pass any combination of newTitle/newBody/newFolder.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Current title of the note to update' },
          folderName: { type: 'string', description: 'Optional: restrict search to this folder' },
          newTitle: { type: 'string' },
          newBody: { type: 'string', description: 'Plain text (line breaks preserved) — replaces the entire body' },
          newFolder: { type: 'string', description: 'Move the note to this folder' },
        },
        required: ['title'],
      },
      handler: async ({ title, folderName, newTitle, newBody, newFolder }) => {
        if (newTitle === undefined && newBody === undefined && newFolder === undefined) {
          throw new Error('Provide at least one of newTitle / newBody / newFolder')
        }
        const scope = folderName ? `tell folder "${esc(folderName)}"` : ''
        const scopeEnd = folderName ? 'end tell' : ''
        // AppleScript can't atomically move-and-update; do it in two steps:
        // 1. locate note, mutate name/body in place; 2. if newFolder, move.
        const mutations = []
        if (newTitle !== undefined) mutations.push(`set name of n to "${esc(newTitle)}"`)
        if (newBody !== undefined) {
          const finalTitle = newTitle !== undefined ? newTitle : title
          const htmlBody = `<h1>${esc(finalTitle)}</h1>` +
            newBody.split('\n').map(line => `<div>${esc(line).replace(/</g, '&lt;')}</div>`).join('')
          mutations.push(`set body of n to "${esc(htmlBody)}"`)
        }
        const moveStep = newFolder
          ? `move n to folder "${esc(newFolder)}"`
          : ''
        const script = `
          tell application "Notes"
            ${scope}
              set hits to notes whose name is "${esc(title)}"
              if (count of hits) = 0 then error "not_found"
              set n to item 1 of hits
              ${mutations.join('\n              ')}
            ${scopeEnd}
            ${moveStep}
          end tell
          return "ok"
        `
        try {
          await osa(script)
        } catch (err) {
          if (String(err?.message || '').includes('not_found')) {
            throw new Error(`Note not found: ${title}${folderName ? ` (in folder "${folderName}")` : ''}`)
          }
          throw err
        }
        const changes = [
          newTitle !== undefined ? `title → ${newTitle}` : null,
          newBody !== undefined ? 'body updated' : null,
          newFolder ? `moved to ${newFolder}` : null,
        ].filter(Boolean).join(', ')
        return { content: [{ type: 'text', text: `Updated note "${title}": ${changes}` }] }
      },
    },

    {
      name: 'delete_note',
      description: 'Delete a note by title. Matches the first note with the given title (optionally scoped to `folderName`). The note is permanently removed (not moved to a recoverable trash — Notes.app has no per-note trash).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          folderName: { type: 'string' },
        },
        required: ['title'],
      },
      handler: async ({ title, folderName }) => {
        const scope = folderName ? `tell folder "${esc(folderName)}"` : ''
        const scopeEnd = folderName ? 'end tell' : ''
        const script = `
          tell application "Notes"
            ${scope}
              set hits to notes whose name is "${esc(title)}"
              if (count of hits) = 0 then return "not_found"
              delete item 1 of hits
              return "ok"
            ${scopeEnd}
          end tell
        `
        const r = await osa(script)
        if (r === 'not_found') throw new Error(`Note not found: ${title}`)
        return { content: [{ type: 'text', text: `Deleted note: ${title}` }] }
      },
    },

    {
      name: 'append_to_note',
      description: 'Append content to the end of an existing note (does not overwrite). Adds a line break before the new content. Matches the first note with the given title.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string', description: 'Plain text to append' },
          folderName: { type: 'string' },
        },
        required: ['title', 'content'],
      },
      handler: async ({ title, content, folderName }) => {
        const scope = folderName ? `tell folder "${esc(folderName)}"` : ''
        const scopeEnd = folderName ? 'end tell' : ''
        // Append a <br> + each line wrapped in <div>. Notes accepts HTML body.
        const htmlAppend = '<br>' + content.split('\n').map(line =>
          `<div>${esc(line).replace(/</g, '&lt;')}</div>`
        ).join('')
        const script = `
          tell application "Notes"
            ${scope}
              set hits to notes whose name is "${esc(title)}"
              if (count of hits) = 0 then error "not_found"
              set n to item 1 of hits
              set body of n to (body of n) & "${esc(htmlAppend)}"
            ${scopeEnd}
          end tell
          return "ok"
        `
        try { await osa(script) }
        catch (err) {
          if (String(err?.message || '').includes('not_found')) throw new Error(`Note not found: ${title}`)
          throw err
        }
        return { content: [{ type: 'text', text: `Appended to "${title}"` }] }
      },
    },

    {
      name: 'list_folders',
      description: 'List all Notes folders (including nested) across accounts. Returns folder name + parent path.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const script = `
          set output to ""
          tell application "Notes"
            repeat with acc in accounts
              set accNm to name of acc
              tell acc
                repeat with f in folders
                  set output to output & accNm & "\t" & (name of f) & linefeed
                end repeat
              end tell
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const folders = raw.split('\n').filter(Boolean).map(line => {
          const [account, name] = line.split('\t')
          return { account, name }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ count: folders.length, folders }, null, 2) }] }
      },
    },

    {
      name: 'create_folder',
      description: 'Create a new Notes folder. If `accountName` is omitted, creates in the default account (usually iCloud).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          accountName: { type: 'string', description: 'iCloud / On My Mac / account name (optional)' },
        },
        required: ['name'],
      },
      handler: async ({ name, accountName }) => {
        const target = accountName
          ? `account "${esc(accountName)}"`
          : 'default account'
        const script = `tell application "Notes" to make new folder at ${target} with properties {name:"${esc(name)}"}`
        await osa(script)
        return { content: [{ type: 'text', text: `Created folder: ${name}` }] }
      },
    },

    {
      name: 'rename_folder',
      description: 'Rename a Notes folder.',
      inputSchema: {
        type: 'object',
        properties: {
          oldName: { type: 'string' },
          newName: { type: 'string' },
        },
        required: ['oldName', 'newName'],
      },
      handler: async ({ oldName, newName }) => {
        const script = `
          tell application "Notes"
            set hits to folders whose name is "${esc(oldName)}"
            if (count of hits) = 0 then error "not_found"
            set name of item 1 of hits to "${esc(newName)}"
          end tell
          return "ok"
        `
        try { await osa(script) }
        catch (err) {
          if (String(err?.message || '').includes('not_found')) throw new Error(`Folder not found: ${oldName}`)
          throw err
        }
        return { content: [{ type: 'text', text: `Renamed "${oldName}" → "${newName}"` }] }
      },
    },

    {
      name: 'delete_folder',
      description: 'Delete a folder and all notes inside it. Irreversible.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      handler: async ({ name }) => {
        const script = `
          tell application "Notes"
            set hits to folders whose name is "${esc(name)}"
            if (count of hits) = 0 then return "not_found"
            delete item 1 of hits
            return "ok"
          end tell
        `
        const r = await osa(script)
        if (r === 'not_found') throw new Error(`Folder not found: ${name}`)
        return { content: [{ type: 'text', text: `Deleted folder: ${name}` }] }
      },
    },

    {
      name: 'list_attachments',
      description: 'List attachments on a note (name, creation date, content identifier). Use save_attachment to export one.',
      inputSchema: {
        type: 'object',
        properties: {
          noteTitle: { type: 'string' },
          folderName: { type: 'string' },
        },
        required: ['noteTitle'],
      },
      handler: async ({ noteTitle, folderName }) => {
        const scope = folderName ? `tell folder "${esc(folderName)}"` : ''
        const scopeEnd = folderName ? 'end tell' : ''
        const script = `
          set output to ""
          tell application "Notes"
            ${scope}
              set hits to notes whose name is "${esc(noteTitle)}"
              if (count of hits) = 0 then error "not_found"
              set n to item 1 of hits
              repeat with att in attachments of n
                set an to ""
                try
                  set an to name of att
                end try
                set ad to ""
                try
                  set ad to (creation date of att) as string
                end try
                set output to output & an & "\t" & ad & linefeed
              end repeat
            ${scopeEnd}
          end tell
          return output
        `
        try {
          const raw = await osa(script)
          const atts = raw.split('\n').filter(Boolean).map(line => {
            const [name, created] = line.split('\t')
            return { name, created }
          })
          return { content: [{ type: 'text', text: JSON.stringify({ note: noteTitle, count: atts.length, attachments: atts }, null, 2) }] }
        } catch (err) {
          if (String(err?.message || '').includes('not_found')) throw new Error(`Note not found: ${noteTitle}`)
          throw err
        }
      },
    },

    {
      name: 'save_attachment',
      description: 'Save an attachment from a note to a local file path. Matches attachment by name (first match).',
      inputSchema: {
        type: 'object',
        properties: {
          noteTitle: { type: 'string' },
          attachmentName: { type: 'string' },
          savePath: { type: 'string', description: 'Absolute path where the file will be written' },
          folderName: { type: 'string' },
        },
        required: ['noteTitle', 'attachmentName', 'savePath'],
      },
      handler: async ({ noteTitle, attachmentName, savePath, folderName }) => {
        const scope = folderName ? `tell folder "${esc(folderName)}"` : ''
        const scopeEnd = folderName ? 'end tell' : ''
        const script = `
          tell application "Notes"
            ${scope}
              set hits to notes whose name is "${esc(noteTitle)}"
              if (count of hits) = 0 then error "note_not_found"
              set n to item 1 of hits
              set ahits to (attachments of n whose name is "${esc(attachmentName)}")
              if (count of ahits) = 0 then error "att_not_found"
              save item 1 of ahits in (POSIX file "${esc(savePath)}")
            ${scopeEnd}
          end tell
          return "ok"
        `
        try { await osa(script) }
        catch (err) {
          const msg = String(err?.message || '')
          if (msg.includes('note_not_found')) throw new Error(`Note not found: ${noteTitle}`)
          if (msg.includes('att_not_found')) throw new Error(`Attachment not found: ${attachmentName}`)
          throw err
        }
        return { content: [{ type: 'text', text: `Saved attachment "${attachmentName}" → ${savePath}` }] }
      },
    },
  ],
})
