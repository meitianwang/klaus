import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, existsSync, readFileSync, appendFileSync, unlinkSync, readdirSync, statSync } from 'fs'

const TRANSCRIPTS_DIR = join(homedir(), '.klaus', 'transcripts')

interface TranscriptEntry {
  type: 'session' | 'message'
  sessionKey?: string
  createdAt?: number
  role?: 'user' | 'assistant'
  content?: string | any[]
  ts?: number
}

export interface TranscriptMessage {
  role: 'user' | 'assistant'
  content: string | any[]
  ts: number
}

export interface SessionSummary {
  sessionKey: string
  title: string
  createdAt: number
  updatedAt: number
}

export class MessageStore {
  private dir: string
  private maxFiles: number
  private maxAgeDays: number
  private writeLocks = new Set<string>()

  constructor(config?: { transcriptsDir?: string; maxFiles?: number; maxAgeDays?: number }) {
    this.dir = config?.transcriptsDir ?? TRANSCRIPTS_DIR
    this.maxFiles = config?.maxFiles ?? 200
    this.maxAgeDays = config?.maxAgeDays ?? 30
    mkdirSync(this.dir, { recursive: true })
  }

  private filePath(sessionKey: string): string {
    const safe = sessionKey.replace(/:/g, '__').replace(/\.\./g, '_')
    return join(this.dir, `${safe}.jsonl`)
  }

  async append(sessionKey: string, role: 'user' | 'assistant', content: string | any[]): Promise<void> {
    const fp = this.filePath(sessionKey)

    // Write session header on first message
    if (!existsSync(fp)) {
      const header: TranscriptEntry = { type: 'session', sessionKey, createdAt: Date.now() }
      appendFileSync(fp, JSON.stringify(header) + '\n')
    }

    const entry: TranscriptEntry = { type: 'message', role, content, ts: Date.now() }
    appendFileSync(fp, JSON.stringify(entry) + '\n')
  }

  async readHistory(sessionKey: string): Promise<TranscriptMessage[]> {
    const fp = this.filePath(sessionKey)
    if (!existsSync(fp)) return []

    const lines = readFileSync(fp, 'utf-8').split('\n').filter(Boolean)
    const messages: TranscriptMessage[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as TranscriptEntry
        if (entry.type === 'message' && entry.role && entry.content !== undefined) {
          messages.push({ role: entry.role, content: entry.content, ts: entry.ts ?? 0 })
        }
      } catch {}
    }

    return messages
  }

  async listSessions(): Promise<SessionSummary[]> {
    if (!existsSync(this.dir)) return []

    const files = readdirSync(this.dir).filter(f => f.endsWith('.jsonl'))
    const summaries: SessionSummary[] = []

    for (const file of files) {
      const fp = join(this.dir, file)
      try {
        const stat = statSync(fp)
        const firstLine = readFileSync(fp, 'utf-8').split('\n')[0]
        if (!firstLine) continue
        const header = JSON.parse(firstLine)
        const sessionKey = header.sessionKey ?? file.replace('.jsonl', '').replace(/__/g, ':')
        summaries.push({
          sessionKey,
          title: sessionKey.split(':').pop() ?? 'Chat',
          createdAt: header.createdAt ?? stat.birthtimeMs,
          updatedAt: stat.mtimeMs,
        })
      } catch {}
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  deleteSession(sessionKey: string): boolean {
    const fp = this.filePath(sessionKey)
    if (existsSync(fp)) {
      unlinkSync(fp)
      return true
    }
    return false
  }

  prune(): number {
    if (!existsSync(this.dir)) return 0

    const files = readdirSync(this.dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, path: join(this.dir, f), mtime: statSync(join(this.dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    const cutoff = Date.now() - this.maxAgeDays * 24 * 60 * 60 * 1000
    let removed = 0

    for (let i = 0; i < files.length; i++) {
      if (i >= this.maxFiles || files[i]!.mtime < cutoff) {
        unlinkSync(files[i]!.path)
        removed++
      }
    }

    return removed
  }
}
