// Klaus connector: macOS Mail (via AppleScript)
import { runServer, osa, esc } from './_mcp.mjs'

runServer({
  name: 'klaus-macos-mail',
  tools: [
    {
      name: 'list_mailboxes',
      description: 'List all mailboxes (across accounts). Returns account + mailbox name pairs.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const script = `
          set output to ""
          tell application "Mail"
            repeat with acc in accounts
              set accNm to name of acc
              tell acc
                repeat with mb in mailboxes
                  set output to output & accNm & "\t" & (name of mb) & linefeed
                end repeat
              end tell
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const items = raw.split('\n').filter(Boolean).map(line => {
          const [account, mailbox] = line.split('\t')
          return { account, mailbox }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ count: items.length, mailboxes: items }, null, 2) }] }
      },
    },

    {
      name: 'search_messages',
      description: 'Search mail messages by keyword in subject. Returns sender, subject, date, mailbox, and message id.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          mailbox: { type: 'string', description: 'Optional mailbox name (e.g. "INBOX")' },
          limit: { type: 'number', default: 30 },
        },
        required: ['query'],
      },
      handler: async ({ query, mailbox, limit = 30 }) => {
        const maxN = Math.max(1, Math.min(100, limit))
        const filter = `subject contains "${esc(query)}"`
        const script = mailbox
          ? `
          set output to ""
          set matched to 0
          tell application "Mail"
            repeat with acc in accounts
              if matched ≥ ${maxN} then exit repeat
              try
                tell acc
                  set mb to mailbox "${esc(mailbox)}"
                  tell mb
                    set msgs to (messages whose ${filter})
                    repeat with m in msgs
                      if matched ≥ ${maxN} then exit repeat
                      set output to output & (id of m as string) & "\t" & (sender of m) & "\t" & (subject of m) & "\t" & ((date received of m) as string) & "\t" & (name of acc) & "\t" & (name of mb) & linefeed
                      set matched to matched + 1
                    end repeat
                  end tell
                end tell
              end try
            end repeat
          end tell
          return output
        `
          : `
          set output to ""
          set matched to 0
          tell application "Mail"
            repeat with acc in accounts
              if matched ≥ ${maxN} then exit repeat
              set accNm to name of acc
              tell acc
                repeat with mb in mailboxes
                  if matched ≥ ${maxN} then exit repeat
                  set mbNm to name of mb
                  tell mb
                    try
                      set msgs to (messages whose ${filter})
                      repeat with m in msgs
                        if matched ≥ ${maxN} then exit repeat
                        set output to output & (id of m as string) & "\t" & (sender of m) & "\t" & (subject of m) & "\t" & ((date received of m) as string) & "\t" & accNm & "\t" & mbNm & linefeed
                        set matched to matched + 1
                      end repeat
                    end try
                  end tell
                end repeat
              end tell
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const items = raw.split('\n').filter(Boolean).map(line => {
          const [id, sender, subject, date, account, mailbox] = line.split('\t')
          return { id, sender, subject, date, account, mailbox }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ query, count: items.length, messages: items }, null, 2) }] }
      },
    },

    {
      name: 'read_message',
      description: 'Read a specific message body by message id (from search_messages).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Message id from search_messages' },
        },
        required: ['id'],
      },
      handler: async ({ id }) => {
        const script = `
          set output to ""
          tell application "Mail"
            repeat with acc in accounts
              tell acc
                repeat with mb in mailboxes
                  try
                    tell mb
                      set hits to messages whose id is ${Number(id) || 0}
                      if (count of hits) > 0 then
                        set m to item 1 of hits
                        set output to (sender of m) & linefeed & (subject of m) & linefeed & ((date received of m) as string) & linefeed & "---" & linefeed & (content of m)
                        exit repeat
                      end if
                    end tell
                  end try
                end repeat
              end tell
              if output is not "" then exit repeat
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        if (!raw) throw new Error(`Message not found: ${id}`)
        return { content: [{ type: 'text', text: raw }] }
      },
    },

    {
      name: 'create_draft',
      description: 'Create a new mail draft (does not send). Opens in Mail so the user can review before sending.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string' },
          body: { type: 'string' },
          cc: { type: 'string' },
          bcc: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
      },
      handler: async ({ to, subject, body, cc, bcc }) => {
        const lines = [
          'tell application "Mail"',
          '  set newMsg to make new outgoing message with properties {visible:true, subject:"' + esc(subject) + '", content:"' + esc(body) + '"}',
          '  tell newMsg',
          '    make new to recipient at end of to recipients with properties {address:"' + esc(to) + '"}',
        ]
        if (cc) lines.push('    make new cc recipient at end of cc recipients with properties {address:"' + esc(cc) + '"}')
        if (bcc) lines.push('    make new bcc recipient at end of bcc recipients with properties {address:"' + esc(bcc) + '"}')
        lines.push('  end tell')
        lines.push('end tell')
        await osa(lines.join('\n'))
        return { content: [{ type: 'text', text: `Draft created: ${subject}` }] }
      },
    },
  ],
})
