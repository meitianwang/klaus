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

    {
      name: 'send_message',
      description: 'Send an email directly (skips the draft step). The message is delivered immediately through the sender\'s configured Mail account.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string' },
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
          '  set newMsg to make new outgoing message with properties {visible:false, subject:"' + esc(subject) + '", content:"' + esc(body) + '"}',
          '  tell newMsg',
          '    make new to recipient at end of to recipients with properties {address:"' + esc(to) + '"}',
        ]
        if (cc) lines.push('    make new cc recipient at end of cc recipients with properties {address:"' + esc(cc) + '"}')
        if (bcc) lines.push('    make new bcc recipient at end of bcc recipients with properties {address:"' + esc(bcc) + '"}')
        lines.push('    send')
        lines.push('  end tell')
        lines.push('end tell')
        await osa(lines.join('\n'))
        return { content: [{ type: 'text', text: `Sent to ${to}: ${subject}` }] }
      },
    },

    {
      name: 'mark_read',
      description: 'Mark a specific message as read or unread (by id from search_messages).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          read: { type: 'boolean', description: 'true = mark read, false = mark unread', default: true },
        },
        required: ['id'],
      },
      handler: async ({ id, read = true }) => {
        const script = `
          set updated to false
          tell application "Mail"
            repeat with acc in accounts
              tell acc
                repeat with mb in mailboxes
                  try
                    tell mb
                      set hits to messages whose id is ${Number(id) || 0}
                      if (count of hits) > 0 then
                        set read status of item 1 of hits to ${read ? 'true' : 'false'}
                        set updated to true
                        exit repeat
                      end if
                    end tell
                  end try
                end repeat
              end tell
              if updated then exit repeat
            end repeat
          end tell
          if updated then return "ok"
          return "not_found"
        `
        const r = await osa(script)
        if (r === 'not_found') throw new Error(`Message not found: ${id}`)
        return { content: [{ type: 'text', text: `Message ${id} marked ${read ? 'read' : 'unread'}` }] }
      },
    },

    {
      name: 'move_message',
      description: 'Move a message to a different mailbox (e.g. to Archive or a user folder). Pass message id + target mailbox name and account.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          targetAccount: { type: 'string', description: 'Destination account name' },
          targetMailbox: { type: 'string', description: 'Destination mailbox name (e.g. "Archive")' },
        },
        required: ['id', 'targetAccount', 'targetMailbox'],
      },
      handler: async ({ id, targetAccount, targetMailbox }) => {
        const script = `
          set moved to false
          tell application "Mail"
            set dest to mailbox "${esc(targetMailbox)}" of account "${esc(targetAccount)}"
            repeat with acc in accounts
              tell acc
                repeat with mb in mailboxes
                  try
                    tell mb
                      set hits to messages whose id is ${Number(id) || 0}
                      if (count of hits) > 0 then
                        move item 1 of hits to dest
                        set moved to true
                        exit repeat
                      end if
                    end tell
                  end try
                end repeat
              end tell
              if moved then exit repeat
            end repeat
          end tell
          if moved then return "ok"
          return "not_found"
        `
        const r = await osa(script)
        if (r === 'not_found') throw new Error(`Message not found: ${id}`)
        return { content: [{ type: 'text', text: `Moved message ${id} to ${targetAccount}/${targetMailbox}` }] }
      },
    },

    {
      name: 'delete_message',
      description: 'Delete a message (moves to the account\'s Trash / Deleted Messages mailbox).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      handler: async ({ id }) => {
        const script = `
          set deleted to false
          tell application "Mail"
            repeat with acc in accounts
              tell acc
                repeat with mb in mailboxes
                  try
                    tell mb
                      set hits to messages whose id is ${Number(id) || 0}
                      if (count of hits) > 0 then
                        delete item 1 of hits
                        set deleted to true
                        exit repeat
                      end if
                    end tell
                  end try
                end repeat
              end tell
              if deleted then exit repeat
            end repeat
          end tell
          if deleted then return "ok"
          return "not_found"
        `
        const r = await osa(script)
        if (r === 'not_found') throw new Error(`Message not found: ${id}`)
        return { content: [{ type: 'text', text: `Deleted message ${id}` }] }
      },
    },
  ],
})
