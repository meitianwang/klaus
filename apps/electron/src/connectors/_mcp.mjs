// Minimal MCP stdio server for Klaus built-in connectors.
// Speaks JSON-RPC 2.0 over newline-delimited stdio, implementing just the
// three methods we need: initialize, tools/list, tools/call.
//
// Why not @modelcontextprotocol/sdk? Each connector is a single-process,
// single-purpose script — pulling the SDK just to answer three methods
// doubles the bundle and the cold-start time.

import process from 'node:process'
import readline from 'node:readline'

/**
 * Start a stdio MCP server.
 * @param {object} opts
 * @param {string} opts.name           - server name (e.g. 'klaus-macos-reminders')
 * @param {string} [opts.version]      - server version
 * @param {Array<{
 *   name: string,
 *   description: string,
 *   inputSchema: object,
 *   handler: (args: object) => Promise<{ content: Array<{type:string,text?:string}> }>
 * }>} opts.tools
 */
export function runServer({ name, version = '0.1.0', tools }) {
  const toolIndex = new Map(tools.map(t => [t.name, t]))

  const rl = readline.createInterface({ input: process.stdin })

  rl.on('line', (line) => {
    line = line.trim()
    if (!line) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return // malformed line — drop
    }
    void handle(msg)
  })

  rl.on('close', () => process.exit(0))

  async function handle(msg) {
    // Notifications have no id → don't respond
    const isNotification = msg.id === undefined || msg.id === null
    try {
      const result = await dispatch(msg.method, msg.params ?? {})
      if (!isNotification) respond({ jsonrpc: '2.0', id: msg.id, result })
    } catch (err) {
      if (!isNotification) {
        respond({
          jsonrpc: '2.0',
          id: msg.id,
          error: {
            code: -32000,
            message: err?.message ?? String(err),
          },
        })
      }
    }
  }

  async function dispatch(method, params) {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name, version },
        }

      case 'notifications/initialized':
        return null

      case 'tools/list':
        return {
          tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        }

      case 'tools/call': {
        const t = toolIndex.get(params.name)
        if (!t) throw new Error(`Unknown tool: ${params.name}`)
        const out = await t.handler(params.arguments ?? {})
        // Normalize: if handler returned a string, wrap into content[]
        if (typeof out === 'string') {
          return { content: [{ type: 'text', text: out }] }
        }
        if (out && Array.isArray(out.content)) return out
        return { content: [{ type: 'text', text: JSON.stringify(out) }] }
      }

      default:
        throw new Error(`Method not implemented: ${method}`)
    }
  }

  function respond(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n')
  }
}

/**
 * Execute an AppleScript via osascript and return trimmed stdout.
 * Throws with a clean message on non-zero exit or timeout.
 */
export async function osa(script, { timeout = 30_000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  const { execFile } = await import('node:child_process')
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      ['-e', script],
      { timeout, maxBuffer },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || '').trim()
          reject(new Error(msg || `osascript failed: ${err.code}`))
          return
        }
        resolve(stdout.trim())
      },
    )
  })
}

/**
 * Run an arbitrary command (non-AppleScript) and collect stdout.
 * @param {string} cmd Absolute path or command on PATH
 * @param {string[]} args
 * @param {{ timeout?: number, maxBuffer?: number, stdin?: string }} [opts]
 */
export async function run(cmd, args, opts = {}) {
  const { timeout = 30_000, maxBuffer = 8 * 1024 * 1024, stdin } = opts
  const { execFile } = await import('node:child_process')
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, maxBuffer }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || '').trim()
        reject(new Error(msg || `${cmd} failed: ${err.code}`))
        return
      }
      resolve(stdout)
    })
    if (stdin !== undefined) {
      child.stdin?.write(stdin)
      child.stdin?.end()
    }
  })
}

/**
 * Escape a string for safe embedding into an AppleScript double-quoted literal.
 * AppleScript string literals use " and escape via \" and \\.
 */
export function esc(s) {
  if (s === null || s === undefined) return ''
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Convert an ISO8601 date string to AppleScript's `date "..."` form.
 * AppleScript accepts many formats; we emit YYYY-MM-DD HH:MM:SS which works
 * reliably in English and Chinese locales alike.
 */
export function asDate(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`)
  const pad = (n) => String(n).padStart(2, '0')
  const s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `date "${s}"`
}
