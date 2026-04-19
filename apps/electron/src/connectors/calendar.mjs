// Klaus connector: macOS Calendar (via AppleScript)
import { runServer, osa, esc, asDate } from './_mcp.mjs'

runServer({
  name: 'klaus-macos-calendar',
  tools: [
    {
      name: 'list_events',
      description: 'List calendar events in a date range. If calendarName is omitted, searches all calendars.',
      inputSchema: {
        type: 'object',
        properties: {
          calendarName: { type: 'string' },
          startDate: { type: 'string', description: 'ISO 8601 datetime (inclusive)' },
          endDate: { type: 'string', description: 'ISO 8601 datetime (inclusive)' },
          limit: { type: 'number', default: 100 },
        },
        required: ['startDate', 'endDate'],
      },
      handler: async ({ calendarName, startDate, endDate, limit = 100 }) => {
        const from = asDate(startDate)
        const to = asDate(endDate)
        const maxN = Math.max(1, Math.min(500, limit))
        const script = calendarName
          ? `
          set output to ""
          set matched to 0
          set maxN to ${maxN}
          set calNm to "${esc(calendarName)}"
          tell application "Calendar"
            tell calendar "${esc(calendarName)}"
              set evs to every event whose start date ≥ ${from} and start date ≤ ${to}
              repeat with e in evs
                if matched ≥ maxN then exit repeat
                set loc to ""
                try
                  set loc to location of e
                end try
                set notesTxt to ""
                try
                  set notesTxt to description of e
                end try
                set output to output & calNm & "\t" & (summary of e) & "\t" & ((start date of e) as string) & "\t" & ((end date of e) as string) & "\t" & loc & "\t" & notesTxt & linefeed
                set matched to matched + 1
              end repeat
            end tell
          end tell
          return output
        `
          : `
          set output to ""
          set matched to 0
          set maxN to ${maxN}
          tell application "Calendar"
            repeat with cal in calendars
              if matched ≥ maxN then exit repeat
              set calNm to name of cal
              tell cal
                set evs to every event whose start date ≥ ${from} and start date ≤ ${to}
                repeat with e in evs
                  if matched ≥ maxN then exit repeat
                  set loc to ""
                  try
                    set loc to location of e
                  end try
                  set notesTxt to ""
                  try
                    set notesTxt to description of e
                  end try
                  set output to output & calNm & "\t" & (summary of e) & "\t" & ((start date of e) as string) & "\t" & ((end date of e) as string) & "\t" & loc & "\t" & notesTxt & linefeed
                  set matched to matched + 1
                end repeat
              end tell
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const items = raw.split('\n').filter(Boolean).map(line => {
          const [calendar, summary, start, end, location, notes] = line.split('\t')
          return { calendar, summary, start, end, location: location || null, notes: notes || null }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ count: items.length, events: items }, null, 2) }] }
      },
    },

    {
      name: 'search_events',
      description: 'Search calendar events by keyword in summary or notes, optionally bounded by a date range.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          limit: { type: 'number', default: 50 },
        },
        required: ['query'],
      },
      handler: async ({ query, startDate, endDate, limit = 50 }) => {
        // Default to +/- 365 days if no range given
        const now = new Date()
        const from = startDate
          ? asDate(startDate)
          : asDate(new Date(now.getTime() - 365 * 86400_000).toISOString())
        const to = endDate
          ? asDate(endDate)
          : asDate(new Date(now.getTime() + 365 * 86400_000).toISOString())
        const script = `
          set output to ""
          set matched to 0
          set maxN to ${Math.max(1, Math.min(200, limit))}
          tell application "Calendar"
            repeat with cal in calendars
              if matched ≥ maxN then exit repeat
              set calNm to name of cal
              tell cal
                set evs to every event whose start date ≥ ${from} and start date ≤ ${to}
                repeat with e in evs
                  if matched ≥ maxN then exit repeat
                  set sm to summary of e
                  set notesTxt to ""
                  try
                    set notesTxt to description of e
                  end try
                  set hay to (sm & " " & notesTxt) as string
                  ignoring case
                    if hay contains "${esc(query)}" then
                      set output to output & calNm & "\t" & sm & "\t" & ((start date of e) as string) & "\t" & ((end date of e) as string) & "\t" & notesTxt & linefeed
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
          const [calendar, summary, start, end, notes] = line.split('\t')
          return { calendar, summary, start, end, notes: notes || null }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ query, count: items.length, events: items }, null, 2) }] }
      },
    },

    {
      name: 'create_event',
      description: 'Create a new calendar event. `calendarName` defaults to the first calendar.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          startDate: { type: 'string', description: 'ISO 8601 datetime' },
          endDate: { type: 'string', description: 'ISO 8601 datetime' },
          calendarName: { type: 'string' },
          location: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['title', 'startDate', 'endDate'],
      },
      handler: async ({ title, startDate, endDate, calendarName, location, notes }) => {
        const props = [
          `summary:"${esc(title)}"`,
          `start date:${asDate(startDate)}`,
          `end date:${asDate(endDate)}`,
        ]
        if (location) props.push(`location:"${esc(location)}"`)
        if (notes) props.push(`description:"${esc(notes)}"`)
        const propStr = '{' + props.join(', ') + '}'
        const script = calendarName
          ? `tell application "Calendar" to tell calendar "${esc(calendarName)}" to make new event with properties ${propStr}`
          : `tell application "Calendar" to tell first calendar to make new event with properties ${propStr}`
        await osa(script)
        return { content: [{ type: 'text', text: `Created event: ${title}` }] }
      },
    },

    {
      name: 'delete_event',
      description: 'Delete a calendar event by exact title match on a given start date.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          startDate: { type: 'string', description: 'ISO 8601 datetime of the event to delete' },
        },
        required: ['title', 'startDate'],
      },
      handler: async ({ title, startDate }) => {
        const script = `
          set deleted to 0
          tell application "Calendar"
            repeat with cal in calendars
              tell cal
                set evs to every event whose summary is "${esc(title)}" and start date is ${asDate(startDate)}
                repeat with e in evs
                  delete e
                  set deleted to deleted + 1
                end repeat
              end tell
            end repeat
          end tell
          return deleted as string
        `
        const raw = await osa(script)
        const n = parseInt(raw, 10) || 0
        if (n === 0) throw new Error(`No matching event titled "${title}" at ${startDate}`)
        return { content: [{ type: 'text', text: `Deleted ${n} event(s)` }] }
      },
    },
  ],
})
