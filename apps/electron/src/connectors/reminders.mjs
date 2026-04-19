// Klaus connector: macOS Reminders (via AppleScript)
import { runServer, osa, esc, asDate } from './_mcp.mjs'

runServer({
  name: 'klaus-macos-reminders',
  tools: [
    {
      name: 'list_reminders',
      description: 'List reminders in a given list. If listName is omitted, returns the names of all reminder lists instead. `completed=false` (default) skips completed items.',
      inputSchema: {
        type: 'object',
        properties: {
          listName: { type: 'string', description: 'Reminder list name (optional)' },
          completed: { type: 'boolean', description: 'Include completed reminders', default: false },
          limit: { type: 'number', description: 'Max reminders to return', default: 100 },
        },
      },
      handler: async ({ listName, completed = false, limit = 100 }) => {
        if (!listName) {
          // Return list names (newline-separated) — caller can pick one and re-query
          const script = `tell application "Reminders" to get name of lists`
          const raw = await osa(script)
          const names = raw.split(', ').map(s => s.trim()).filter(Boolean)
          return { content: [{ type: 'text', text: JSON.stringify({ lists: names }, null, 2) }] }
        }
        const filter = completed
          ? ''
          : ' whose completed is false'
        const script = `
          set output to ""
          tell application "Reminders"
            tell list "${esc(listName)}"
              set rems to (reminders${filter})
              set maxN to ${Math.max(1, Math.min(500, limit))}
              if (count of rems) < maxN then set maxN to (count of rems)
              repeat with i from 1 to maxN
                set r to item i of rems
                set dueStr to ""
                try
                  set dueStr to (due date of r) as string
                end try
                set bodyStr to ""
                try
                  set bodyStr to body of r
                end try
                set output to output & (name of r) & "\t" & dueStr & "\t" & bodyStr & "\t" & (completed of r as string) & linefeed
              end repeat
            end tell
          end tell
          return output
        `
        const raw = await osa(script)
        const items = raw.split('\n').filter(Boolean).map(line => {
          const [name, due, body, done] = line.split('\t')
          return { name, due: due || null, body: body || null, completed: done === 'true' }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ list: listName, count: items.length, items }, null, 2) }] }
      },
    },

    {
      name: 'search_reminders',
      description: 'Search reminders across all lists by case-insensitive keyword match on name or body.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keyword' },
          completed: { type: 'boolean', description: 'Include completed reminders', default: false },
          limit: { type: 'number', default: 50 },
        },
        required: ['query'],
      },
      handler: async ({ query, completed = false, limit = 50 }) => {
        const filter = completed ? '' : ' whose completed is false'
        const script = `
          set output to ""
          set kw to "${esc(query).toLowerCase()}"
          set matched to 0
          set maxN to ${Math.max(1, Math.min(200, limit))}
          tell application "Reminders"
            repeat with lst in lists
              if matched ≥ maxN then exit repeat
              set lname to name of lst
              tell lst
                set rems to (reminders${filter})
                repeat with r in rems
                  if matched ≥ maxN then exit repeat
                  set nm to name of r
                  set bd to ""
                  try
                    set bd to body of r
                  end try
                  set hay to (nm & " " & bd) as string
                  ignoring case
                    if hay contains "${esc(query)}" then
                      set dueStr to ""
                      try
                        set dueStr to (due date of r) as string
                      end try
                      set output to output & lname & "\t" & nm & "\t" & dueStr & "\t" & bd & linefeed
                      set matched to matched + 1
                    end if
                  end ignoring
                end repeat
              end tell
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const items = raw.split('\n').filter(Boolean).map(line => {
          const [list, name, due, body] = line.split('\t')
          return { list, name, due: due || null, body: body || null }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ query, count: items.length, items }, null, 2) }] }
      },
    },

    {
      name: 'create_reminder',
      description: 'Create a new reminder. `listName` defaults to the default list; `dueDate` is an ISO-8601 string (optional).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          listName: { type: 'string' },
          dueDate: { type: 'string', description: 'ISO 8601 datetime, e.g. 2026-04-20T09:00:00' },
          body: { type: 'string', description: 'Note / body text' },
        },
        required: ['name'],
      },
      handler: async ({ name, listName, dueDate, body }) => {
        const props = [`name:"${esc(name)}"`]
        if (body) props.push(`body:"${esc(body)}"`)
        if (dueDate) props.push(`due date:${asDate(dueDate)}`)
        const propStr = '{' + props.join(', ') + '}'
        const script = listName
          ? `tell application "Reminders" to tell list "${esc(listName)}" to make new reminder with properties ${propStr}`
          : `tell application "Reminders" to make new reminder with properties ${propStr}`
        await osa(script)
        return { content: [{ type: 'text', text: `Created reminder: ${name}` }] }
      },
    },

    {
      name: 'complete_reminder',
      description: 'Mark a reminder as completed. Matches the first reminder with the given name in the specified list.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          listName: { type: 'string' },
        },
        required: ['name'],
      },
      handler: async ({ name, listName }) => {
        const scope = listName
          ? `tell list "${esc(listName)}"`
          : ''
        const script = `
          tell application "Reminders"
            ${scope}
              set rems to reminders whose name is "${esc(name)}" and completed is false
              if (count of rems) > 0 then
                set completed of item 1 of rems to true
                return "ok"
              else
                return "not_found"
              end if
            ${scope ? 'end tell' : ''}
          end tell
        `
        const result = await osa(script)
        if (result === 'not_found') throw new Error(`No incomplete reminder named "${name}"`)
        return { content: [{ type: 'text', text: `Completed: ${name}` }] }
      },
    },

    {
      name: 'delete_reminder',
      description: 'Delete a reminder by name. Matches the first reminder with the given name in the specified list.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          listName: { type: 'string' },
        },
        required: ['name'],
      },
      handler: async ({ name, listName }) => {
        const scope = listName
          ? `tell list "${esc(listName)}"`
          : ''
        const script = `
          tell application "Reminders"
            ${scope}
              set rems to reminders whose name is "${esc(name)}"
              if (count of rems) > 0 then
                delete item 1 of rems
                return "ok"
              else
                return "not_found"
              end if
            ${scope ? 'end tell' : ''}
          end tell
        `
        const result = await osa(script)
        if (result === 'not_found') throw new Error(`No reminder named "${name}"`)
        return { content: [{ type: 'text', text: `Deleted: ${name}` }] }
      },
    },
  ],
})
