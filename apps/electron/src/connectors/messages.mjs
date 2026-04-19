// Klaus connector: macOS Messages (iMessage)
//   - send via AppleScript (tell application "Messages")
//   - read via /usr/bin/sqlite3 over ~/Library/Messages/chat.db
//
// Reading requires Full Disk Access. If missing, the sqlite call errors with
// "unable to open database file" — we surface that as a hint.
//
// Known limitation: since macOS Ventura, many messages store their body in
// `attributedBody` (serialized NSAttributedString) rather than the plain
// `text` column. We only read `text`; missing bodies show as "[media or
// unsupported content]". Decoding attributedBody is out of scope for v1.

import { runServer, osa, esc, run } from './_mcp.mjs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CHAT_DB = join(homedir(), 'Library/Messages/chat.db')
// Cocoa epoch (2001-01-01 UTC) → Unix epoch delta in seconds
const COCOA_EPOCH_OFFSET = 978307200

async function query(sql, params = []) {
  // Use sqlite3 CLI with JSON output mode. Parameters interpolated via
  // `-cmd "param set ..."` is not universally supported; the column values
  // in our queries are either ints or already-escaped strings, so we inline
  // them via SQL string concat after escaping.
  const finalSql = params.reduce((s, v) => {
    const placeholder = s.indexOf('?')
    if (placeholder < 0) return s
    const quoted = typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
    return s.slice(0, placeholder) + quoted + s.slice(placeholder + 1)
  }, sql)
  try {
    const out = await run('/usr/bin/sqlite3', ['-json', '-readonly', CHAT_DB, finalSql], { timeout: 15_000 })
    if (!out.trim()) return []
    return JSON.parse(out)
  } catch (err) {
    const msg = String(err?.message || err)
    if (msg.includes('unable to open database file') || msg.includes('authorization denied')) {
      throw new Error('Cannot read Messages database — grant Klaus "Full Disk Access" in System Settings › Privacy & Security.')
    }
    throw err
  }
}

function fmtDate(cocoaNs) {
  if (!cocoaNs) return ''
  const unixSec = Number(cocoaNs) / 1e9 + COCOA_EPOCH_OFFSET
  return new Date(unixSec * 1000).toISOString()
}

runServer({
  name: 'klaus-macos-messages',
  tools: [
    {
      name: 'list_recent_conversations',
      description: 'List recent Messages conversations (ordered by last message time). Requires Full Disk Access. Returns chat_identifier (phone/email/group id), display_name, last message snippet, timestamp.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 20 },
        },
      },
      handler: async ({ limit = 20 }) => {
        const sql = `
          SELECT c.chat_identifier, c.display_name, m.text, m.date, m.is_from_me
          FROM chat c
          JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
          JOIN message m ON m.ROWID = cmj.message_id
          WHERE m.ROWID = (SELECT MAX(message_id) FROM chat_message_join WHERE chat_id = c.ROWID)
          ORDER BY m.date DESC
          LIMIT ${Math.max(1, Math.min(200, limit))}
        `
        const rows = await query(sql)
        const convos = rows.map(r => ({
          chat_identifier: r.chat_identifier,
          display_name: r.display_name || null,
          last_message: r.text || '[media or unsupported content]',
          from_me: !!r.is_from_me,
          timestamp: fmtDate(r.date),
        }))
        return { content: [{ type: 'text', text: JSON.stringify({ count: convos.length, conversations: convos }, null, 2) }] }
      },
    },

    {
      name: 'read_conversation',
      description: 'Read the last N messages with a contact or group. `chat_identifier` is a phone number / email / group id from list_recent_conversations. Requires Full Disk Access.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_identifier: { type: 'string' },
          limit: { type: 'number', default: 30 },
        },
        required: ['chat_identifier'],
      },
      handler: async ({ chat_identifier, limit = 30 }) => {
        const sql = `
          SELECT m.text, m.date, m.is_from_me, h.id as sender
          FROM message m
          LEFT JOIN handle h ON h.ROWID = m.handle_id
          JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
          JOIN chat c ON c.ROWID = cmj.chat_id
          WHERE c.chat_identifier = ?
          ORDER BY m.date DESC
          LIMIT ${Math.max(1, Math.min(500, limit))}
        `
        const rows = await query(sql, [chat_identifier])
        const msgs = rows.reverse().map(r => ({
          text: r.text || '[media or unsupported content]',
          from_me: !!r.is_from_me,
          sender: r.is_from_me ? 'me' : (r.sender || 'unknown'),
          timestamp: fmtDate(r.date),
        }))
        return { content: [{ type: 'text', text: JSON.stringify({ chat: chat_identifier, count: msgs.length, messages: msgs }, null, 2) }] }
      },
    },

    {
      name: 'search_messages',
      description: 'Full-text search across all Messages conversations (LIKE match on text column). Requires Full Disk Access. Returns sender, chat_identifier, text, timestamp.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 50 },
        },
        required: ['query'],
      },
      handler: async ({ query: q, limit = 50 }) => {
        const sql = `
          SELECT m.text, m.date, m.is_from_me, h.id as sender, c.chat_identifier
          FROM message m
          LEFT JOIN handle h ON h.ROWID = m.handle_id
          JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
          JOIN chat c ON c.ROWID = cmj.chat_id
          WHERE m.text LIKE ?
          ORDER BY m.date DESC
          LIMIT ${Math.max(1, Math.min(500, limit))}
        `
        const rows = await query(sql, [`%${q}%`])
        const hits = rows.map(r => ({
          chat: r.chat_identifier,
          sender: r.is_from_me ? 'me' : (r.sender || 'unknown'),
          text: r.text,
          timestamp: fmtDate(r.date),
        }))
        return { content: [{ type: 'text', text: JSON.stringify({ query: q, count: hits.length, matches: hits }, null, 2) }] }
      },
    },

    {
      name: 'send_message',
      description: 'Send an iMessage to a phone number, email, or known buddy id. Triggers the Messages app to deliver via iMessage service. Requires Automation permission for Messages.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Phone number (e.g. +11234567890), email address, or buddy id' },
          text: { type: 'string' },
        },
        required: ['to', 'text'],
      },
      handler: async ({ to, text }) => {
        const script = `
          tell application "Messages"
            set svc to 1st service whose service type = iMessage
            set b to buddy "${esc(to)}" of svc
            send "${esc(text)}" to b
          end tell
        `
        await osa(script)
        return { content: [{ type: 'text', text: `Sent iMessage to ${to}` }] }
      },
    },
  ],
})
