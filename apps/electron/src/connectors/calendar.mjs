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

    {
      name: 'list_calendars',
      description: 'List all calendars on this Mac (name + account).',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const script = `
          set output to ""
          tell application "Calendar"
            repeat with c in calendars
              set output to output & (name of c) & linefeed
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const names = raw.split('\n').map(s => s.trim()).filter(Boolean)
        return { content: [{ type: 'text', text: JSON.stringify({ count: names.length, calendars: names }, null, 2) }] }
      },
    },

    {
      name: 'get_event',
      description: 'Get the full details of a single event by title + start date (first match). Returns all fields: calendar, summary, start/end, location, notes, attendees (by email), all-day flag.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          startDate: { type: 'string', description: 'ISO 8601 datetime' },
        },
        required: ['title', 'startDate'],
      },
      handler: async ({ title, startDate }) => {
        const script = `
          set output to ""
          tell application "Calendar"
            repeat with cal in calendars
              tell cal
                set evs to every event whose summary is "${esc(title)}" and start date is ${asDate(startDate)}
                if (count of evs) > 0 then
                  set e to item 1 of evs
                  set calNm to name of cal
                  set loc to ""
                  try
                    set loc to location of e
                  end try
                  set notesTxt to ""
                  try
                    set notesTxt to description of e
                  end try
                  set allDay to "false"
                  try
                    if allday event of e then set allDay to "true"
                  end try
                  set atts to ""
                  try
                    repeat with a in attendees of e
                      set atts to atts & (email of a) & ","
                    end repeat
                  end try
                  set output to calNm & linefeed & (summary of e) & linefeed & ((start date of e) as string) & linefeed & ((end date of e) as string) & linefeed & loc & linefeed & notesTxt & linefeed & allDay & linefeed & atts
                  exit repeat
                end if
              end tell
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        if (!raw) throw new Error(`Event not found: "${title}" at ${startDate}`)
        const [calendar, summary, start, end, location, notes, allDay, attsStr] = raw.split('\n')
        const attendees = (attsStr || '').split(',').map(s => s.trim()).filter(Boolean)
        return { content: [{ type: 'text', text: JSON.stringify({ calendar, summary, start, end, location: location || null, notes: notes || null, allDay: allDay === 'true', attendees }, null, 2) }] }
      },
    },

    {
      name: 'update_event',
      description: 'Update a calendar event: change title, time, location, or notes. Matches by current title + start date. Pass any combination of new* fields.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Current title' },
          startDate: { type: 'string', description: 'Current start date (ISO 8601) — used to locate the event' },
          newTitle: { type: 'string' },
          newStart: { type: 'string', description: 'ISO 8601' },
          newEnd: { type: 'string', description: 'ISO 8601' },
          newLocation: { type: 'string' },
          newNotes: { type: 'string' },
        },
        required: ['title', 'startDate'],
      },
      handler: async ({ title, startDate, newTitle, newStart, newEnd, newLocation, newNotes }) => {
        if (newTitle === undefined && newStart === undefined && newEnd === undefined && newLocation === undefined && newNotes === undefined) {
          throw new Error('Provide at least one new* field')
        }
        const mutations = []
        if (newTitle !== undefined) mutations.push(`set summary of e to "${esc(newTitle)}"`)
        if (newStart !== undefined) mutations.push(`set start date of e to ${asDate(newStart)}`)
        if (newEnd !== undefined) mutations.push(`set end date of e to ${asDate(newEnd)}`)
        if (newLocation !== undefined) mutations.push(`set location of e to "${esc(newLocation)}"`)
        if (newNotes !== undefined) mutations.push(`set description of e to "${esc(newNotes)}"`)
        const script = `
          set updated to 0
          tell application "Calendar"
            repeat with cal in calendars
              tell cal
                set evs to every event whose summary is "${esc(title)}" and start date is ${asDate(startDate)}
                if (count of evs) > 0 then
                  set e to item 1 of evs
                  ${mutations.join('\n                  ')}
                  set updated to 1
                  exit repeat
                end if
              end tell
              if updated > 0 then exit repeat
            end repeat
          end tell
          return updated as string
        `
        const raw = await osa(script)
        if (raw === '0') throw new Error(`Event not found: "${title}" at ${startDate}`)
        return { content: [{ type: 'text', text: `Updated event "${title}"` }] }
      },
    },
  ],
})
