/**
 * BashTool — simplified from claude-code's BashTool/BashTool.tsx.
 * Stripped: React/Ink rendering, bash AST analysis, command semantics,
 *           sed validation, destructive warnings, code indexing, LSP diagnostics,
 *           sandbox, background tasks, auto-backgrounding, structured content,
 *           image output, large output persistence, file history tracking.
 * Preserved: core call() with child_process spawn, timeout, stdout/stderr capture,
 *            progress reporting, input schema, prompt, description.
 */

import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { spawn } from 'child_process'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { BashProgress } from '../../types/tools.js'
import { getCwd } from '../../utils/cwd.js'
import { ShellError } from '../../utils/errors.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getDefaultTimeoutMs, getMaxTimeoutMs, getSimplePrompt } from './prompt.js'

export const BASH_TOOL_NAME = 'Bash'

const EOL = '\n'

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z.string().describe('The command to execute'),
    timeout: z
      .number()
      .optional()
      .describe(
        `Optional timeout in milliseconds (max ${getMaxTimeoutMs()})`,
      ),
    description: z
      .string()
      .optional()
      .describe(
        'Clear, concise description of what this command does in active voice.',
      ),
    run_in_background: z
      .boolean()
      .optional()
      .describe(
        'Set to true to run this command in the background. Use TaskOutput to read the output later.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export type BashToolInput = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    stdout: z.string().describe('The standard output of the command'),
    stderr: z.string().describe('The standard error output of the command'),
    interrupted: z
      .boolean()
      .describe('Whether the command was interrupted'),
    backgroundTaskId: z
      .string()
      .optional()
      .describe(
        'ID of the background task if command is running in background',
      ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Out = z.infer<OutputSchema>

/**
 * Execute a shell command and collect output.
 * Uses child_process.spawn with merged stdout+stderr.
 */
async function execCommand(
  command: string,
  signal: AbortSignal,
  timeoutMs: number,
  cwd: string,
  onProgress?: (output: string, elapsed: number) => void,
): Promise<{
  stdout: string
  stderr: string
  code: number
  interrupted: boolean
}> {
  return new Promise((resolve, reject) => {
    // Determine shell from env
    const shell = process.env.SHELL || '/bin/bash'

    const child = spawn(shell, ['-c', command], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // No need to spread process.env — inherits automatically
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let interrupted = false
    let settled = false

    // 8KB cap on stderr accumulation
    const MAX_STDERR_BYTES = 8 * 1024
    let stderrBytes = 0

    const timer = setTimeout(() => {
      interrupted = true
      child.kill('SIGTERM')
      // Give it a moment, then force kill
      setTimeout(() => child.kill('SIGKILL'), 2000).unref()
    }, timeoutMs)
    timer.unref()

    const onAbort = () => {
      interrupted = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2000).unref()
    }
    signal.addEventListener('abort', onAbort, { once: true })

    // Progress reporting
    let progressTimer: ReturnType<typeof setInterval> | undefined
    if (onProgress) {
      const startTime = Date.now()
      progressTimer = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000
        const output = Buffer.concat(stdoutChunks).toString('utf-8')
        onProgress(output, elapsed)
      }, 2000)
      progressTimer.unref()
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes < MAX_STDERR_BYTES) {
        stderrChunks.push(chunk)
        stderrBytes += chunk.length
      }
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (progressTimer) clearInterval(progressTimer)
      signal.removeEventListener('abort', onAbort)

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
      const stderr = Buffer.concat(stderrChunks).toString('utf-8')
      resolve({
        stdout,
        stderr,
        code: code ?? 1,
        interrupted,
      })
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (progressTimer) clearInterval(progressTimer)
      signal.removeEventListener('abort', onAbort)
      reject(err)
    })

    // Close stdin so the child doesn't hang waiting for input
    child.stdin?.end()
  })
}

export const BashTool = buildTool({
  name: BASH_TOOL_NAME,
  searchHint: 'execute shell commands',
  maxResultSizeChars: 30_000,
  strict: true,

  async description({ description }: BashToolInput) {
    return description || 'Run shell command'
  },

  async prompt() {
    return getSimplePrompt()
  },

  isConcurrencySafe(input: BashToolInput) {
    return this.isReadOnly?.(input) ?? false
  },

  isReadOnly(_input: BashToolInput) {
    // Simplified: no AST analysis, always assume read-write
    return false
  },

  toAutoClassifierInput(input: BashToolInput) {
    return input.command
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  userFacingName(_input?: Partial<BashToolInput>) {
    return 'Bash'
  },

  getToolUseSummary(input?: Partial<BashToolInput>) {
    if (!input?.command) return null
    if (input.description) return input.description
    const maxLen = 80
    return input.command.length > maxLen
      ? input.command.slice(0, maxLen - 1) + '…'
      : input.command
  },

  getActivityDescription(input?: Partial<BashToolInput>) {
    if (!input?.command) return 'Running command'
    const desc =
      input.description ??
      (input.command.length > 80
        ? input.command.slice(0, 79) + '…'
        : input.command)
    return `Running ${desc}`
  },

  extractSearchText({ stdout, stderr }: Out) {
    return stderr ? `${stdout}\n${stderr}` : stdout
  },

  mapToolResultToToolResultBlockParam(
    { interrupted, stdout, stderr, backgroundTaskId }: Out,
    toolUseID: string,
  ): ToolResultBlockParam {
    let processedStdout = stdout
    if (stdout) {
      processedStdout = stdout.replace(/^(\s*\n)+/, '').trimEnd()
    }

    let errorMessage = stderr.trim()
    if (interrupted) {
      if (stderr) errorMessage += EOL
      errorMessage += '<error>Command was aborted before completion</error>'
    }

    let backgroundInfo = ''
    if (backgroundTaskId) {
      backgroundInfo = `Command running in background with ID: ${backgroundTaskId}.`
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [processedStdout, errorMessage, backgroundInfo]
        .filter(Boolean)
        .join('\n'),
      is_error: interrupted,
    }
  },

  async call(
    input: BashToolInput,
    toolUseContext,
    _canUseTool?,
    _parentMessage?,
    onProgress?,
  ) {
    const { abortController } = toolUseContext
    const { command, timeout } = input
    const timeoutMs = timeout
      ? Math.min(timeout, getMaxTimeoutMs())
      : getDefaultTimeoutMs()
    const cwd = getCwd()

    let progressCounter = 0

    const result = await execCommand(
      command,
      abortController.signal,
      timeoutMs,
      cwd,
      onProgress
        ? (output, elapsed) => {
            onProgress({
              toolUseID: `bash-progress-${progressCounter++}`,
              data: {
                type: 'bash' as const,
                stdout: output,
              },
            })
          }
        : undefined,
    )

    const { stdout, stderr, code, interrupted } = result

    // If the command failed with non-zero exit code, throw a ShellError
    if (code !== 0 && !interrupted) {
      const fullStderr = stderr || stdout
      throw new ShellError(stdout, fullStderr, code, interrupted)
    }

    const data: Out = {
      stdout: stdout.trimEnd() + EOL,
      stderr: stderr.trim(),
      interrupted,
    }

    return { data }
  },

  isResultTruncated(output: Out): boolean {
    return (
      output.stdout.includes('[output truncated]') ||
      output.stderr.includes('[output truncated]')
    )
  },
} satisfies ToolDef<InputSchema, Out, BashProgress>)
