import {
  chmodSync,
  readdirSync,
  readFileSync as fsReadFileSync,
  statSync,
  writeFileSync as fsWriteFileSync,
  renameSync,
  unlinkSync,
  readlinkSync,
} from 'fs'
import { realpath, stat } from 'fs/promises'
import { homedir } from 'os'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep,
} from 'path'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { isENOENT, isFsInaccessible } from './errors.js'
import { logError } from './log.js'
import { expandPath } from './path.js'

export type LineEndingType = 'CRLF' | 'LF'

export type File = {
  filename: string
  content: string
}

/**
 * Check if a path exists asynchronously.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export const MAX_OUTPUT_SIZE = 0.25 * 1024 * 1024 // 0.25MB in bytes

export function readFileSafe(filepath: string): string | null {
  try {
    return fsReadFileSync(filepath, { encoding: 'utf8' })
  } catch (error) {
    logError(error)
    return null
  }
}

/**
 * Get the normalized modification time of a file in milliseconds.
 */
export function getFileModificationTime(filePath: string): number {
  return Math.floor(statSync(filePath).mtimeMs)
}

/**
 * Async variant of getFileModificationTime.
 */
export async function getFileModificationTimeAsync(
  filePath: string,
): Promise<number> {
  const s = await stat(filePath)
  return Math.floor(s.mtimeMs)
}

/**
 * Detect file encoding by reading BOM bytes.
 */
export function detectFileEncoding(filePath: string): BufferEncoding {
  try {
    const fd = require('fs').openSync(filePath, 'r')
    const buf = Buffer.alloc(4096)
    const bytesRead = require('fs').readSync(fd, buf, 0, 4096, 0)
    require('fs').closeSync(fd)

    if (bytesRead === 0) return 'utf8'
    if (bytesRead >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le'
    if (
      bytesRead >= 3 &&
      buf[0] === 0xef &&
      buf[1] === 0xbb &&
      buf[2] === 0xbf
    )
      return 'utf8'

    return 'utf8'
  } catch {
    return 'utf8'
  }
}

/**
 * Detect line endings from file content.
 */
export function detectLineEndingsForString(content: string): LineEndingType {
  let crlfCount = 0
  let lfCount = 0

  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      if (i > 0 && content[i - 1] === '\r') {
        crlfCount++
      } else {
        lfCount++
      }
    }
  }

  return crlfCount > lfCount ? 'CRLF' : 'LF'
}

/**
 * Detect line endings from a file on disk.
 */
export function detectLineEndings(
  filePath: string,
  encoding: BufferEncoding = 'utf8',
): LineEndingType {
  try {
    const fd = require('fs').openSync(filePath, 'r')
    const buf = Buffer.alloc(4096)
    const bytesRead = require('fs').readSync(fd, buf, 0, 4096, 0)
    require('fs').closeSync(fd)

    const content = buf.toString(encoding, 0, bytesRead)
    return detectLineEndingsForString(content)
  } catch {
    return 'LF'
  }
}

export function writeTextContent(
  filePath: string,
  content: string,
  encoding: BufferEncoding,
  endings: LineEndingType,
): void {
  let toWrite = content
  if (endings === 'CRLF') {
    toWrite = content.replaceAll('\r\n', '\n').split('\n').join('\r\n')
  }

  writeFileSyncAndFlush(filePath, toWrite, { encoding })
}

export function convertLeadingTabsToSpaces(content: string): string {
  if (!content.includes('\t')) return content
  return content.replace(/^\t+/gm, _ => '  '.repeat(_.length))
}

export function getAbsoluteAndRelativePaths(path: string | undefined): {
  absolutePath: string | undefined
  relativePath: string | undefined
} {
  const absolutePath = path ? expandPath(path) : undefined
  const relativePath = absolutePath
    ? relative(getCwd(), absolutePath)
    : undefined
  return { absolutePath, relativePath }
}

export function getDisplayPath(filePath: string): string {
  const { relativePath } = getAbsoluteAndRelativePaths(filePath)
  if (relativePath && !relativePath.startsWith('..')) {
    return relativePath
  }

  const homeDir = homedir()
  if (filePath.startsWith(homeDir + sep)) {
    return '~' + filePath.slice(homeDir.length)
  }

  return filePath
}

/**
 * Find files with the same name but different extensions in the same directory.
 */
export function findSimilarFile(filePath: string): string | undefined {
  try {
    const dir = dirname(filePath)
    const fileBaseName = basename(filePath, extname(filePath))

    const entries = readdirSync(dir, { withFileTypes: true })

    const match = entries.find(
      entry =>
        basename(entry.name, extname(entry.name)) === fileBaseName &&
        resolve(dir, entry.name) !== filePath,
    )

    return match?.name
  } catch (error) {
    if (!isENOENT(error)) {
      logError(error)
    }
    return undefined
  }
}

/** Marker included in file-not-found error messages that contain a cwd note. */
export const FILE_NOT_FOUND_CWD_NOTE = 'Note: your current working directory is'

/**
 * Suggests a corrected path under the current working directory when a file/directory
 * is not found.
 */
export async function suggestPathUnderCwd(
  requestedPath: string,
): Promise<string | undefined> {
  const cwd = getCwd()
  const cwdParent = dirname(cwd)

  let resolvedPath = requestedPath
  try {
    const resolvedDir = await realpath(dirname(requestedPath))
    resolvedPath = resolve(resolvedDir, basename(requestedPath))
  } catch {
    // Parent directory doesn't exist, use the original path
  }

  const cwdParentPrefix = cwdParent === sep ? sep : cwdParent + sep
  if (
    !resolvedPath.startsWith(cwdParentPrefix) ||
    resolvedPath.startsWith(cwd + sep) ||
    resolvedPath === cwd
  ) {
    return undefined
  }

  const relFromParent = relative(cwdParent, resolvedPath)
  const correctedPath = resolve(cwd, relFromParent)
  try {
    await stat(correctedPath)
    return correctedPath
  } catch {
    return undefined
  }
}

/**
 * Adds cat -n style line numbers to the content.
 * Uses compact format (N\t) to save tokens.
 */
export function addLineNumbers({
  content,
  startLine,
}: {
  content: string
  /** 1-indexed */
  startLine: number
}): string {
  if (!content) {
    return ''
  }

  const lines = content.split(/\r?\n/)

  return lines
    .map((line, index) => `${index + startLine}\t${line}`)
    .join('\n')
}

/**
 * Inverse of addLineNumbers -- strips the `N->` or `N\t` prefix from a single line.
 */
export function stripLineNumberPrefix(line: string): string {
  const match = line.match(/^\s*\d+[\u2192\t](.*)$/)
  return match?.[1] ?? line
}

/**
 * Checks if a directory is empty.
 */
export function isDirEmpty(dirPath: string): boolean {
  try {
    const entries = readdirSync(dirPath)
    return entries.length === 0
  } catch (e) {
    return isENOENT(e)
  }
}

/**
 * Validates that a file size is within the specified limit.
 */
export function isFileWithinReadSizeLimit(
  filePath: string,
  maxSizeBytes: number = MAX_OUTPUT_SIZE,
): boolean {
  try {
    const stats = statSync(filePath)
    return stats.size <= maxSizeBytes
  } catch {
    return false
  }
}

/**
 * Normalize a file path for comparison, handling platform differences.
 */
export function normalizePathForComparison(filePath: string): string {
  return normalize(filePath)
}

/**
 * Compare two file paths for equality.
 */
export function pathsEqual(path1: string, path2: string): boolean {
  return normalizePathForComparison(path1) === normalizePathForComparison(path2)
}

/**
 * Like readFileSync but also returns the detected encoding and original line
 * ending style in one pass. Used by FileEditTool to preserve encoding/endings.
 */
export function readFileSyncWithMetadata(filePath: string): {
  content: string
  encoding: BufferEncoding
  lineEndings: LineEndingType
} {
  const encoding = detectFileEncoding(filePath)
  const raw = fsReadFileSync(filePath, { encoding })
  const lineEndings = detectLineEndingsForString(raw.slice(0, 4096))
  return {
    content: raw.replaceAll('\r\n', '\n'),
    encoding,
    lineEndings,
  }
}

/**
 * Writes a file atomically (temp + rename), falling back to direct write.
 */
export function writeFileSyncAndFlush(
  filePath: string,
  content: string,
  options: { encoding: BufferEncoding; mode?: number } = { encoding: 'utf-8' },
): void {
  // Check if the target file is a symlink to preserve it
  let targetPath = filePath
  try {
    const linkTarget = readlinkSync(filePath)
    targetPath = isAbsolute(linkTarget)
      ? linkTarget
      : resolve(dirname(filePath), linkTarget)
    logForDebugging(`Writing through symlink: ${filePath} -> ${targetPath}`)
  } catch {
    // Not a symlink or doesn't exist
  }

  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`

  let targetMode: number | undefined
  let targetExists = false
  try {
    targetMode = statSync(targetPath).mode
    targetExists = true
  } catch (e) {
    if (!isENOENT(e)) throw e
    if (options.mode !== undefined) {
      targetMode = options.mode
    }
  }

  try {
    const writeOptions: {
      encoding: BufferEncoding
      flush: boolean
      mode?: number
    } = {
      encoding: options.encoding,
      flush: true,
    }
    if (!targetExists && options.mode !== undefined) {
      writeOptions.mode = options.mode
    }

    fsWriteFileSync(tempPath, content, writeOptions)

    if (targetExists && targetMode !== undefined) {
      chmodSync(tempPath, targetMode)
    }

    renameSync(tempPath, targetPath)
  } catch {
    // Clean up temp file on error
    try {
      unlinkSync(tempPath)
    } catch {
      // ignore cleanup errors
    }

    // Fallback to non-atomic write
    const fallbackOptions: {
      encoding: BufferEncoding
      flush: boolean
      mode?: number
    } = {
      encoding: options.encoding,
      flush: true,
    }
    if (!targetExists && options.mode !== undefined) {
      fallbackOptions.mode = options.mode
    }

    fsWriteFileSync(targetPath, content, fallbackOptions)
  }
}
