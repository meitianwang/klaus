/**
 * Sync file-read utilities -- encoding/line-ending detection and readFileSyncWithMetadata.
 * Extracted leaf module: only depends on Node builtins.
 */

import { openSync, readSync, closeSync, readFileSync } from 'fs'

export type LineEndingType = 'CRLF' | 'LF'

export function detectEncodingForResolvedPath(
  resolvedPath: string,
): BufferEncoding {
  const fd = openSync(resolvedPath, 'r')
  try {
    const buffer = Buffer.alloc(4096)
    const bytesRead = readSync(fd, buffer, 0, 4096, 0)

    if (bytesRead === 0) return 'utf8'
    if (bytesRead >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe)
      return 'utf16le'
    if (
      bytesRead >= 3 &&
      buffer[0] === 0xef &&
      buffer[1] === 0xbb &&
      buffer[2] === 0xbf
    )
      return 'utf8'

    return 'utf8'
  } finally {
    closeSync(fd)
  }
}

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
 * Like readFileSync but also returns the detected encoding and original line
 * ending style in one filesystem pass. Callers writing the file back (e.g.
 * FileEditTool) can reuse these instead of separate detect calls.
 */
export function readFileSyncWithMetadata(filePath: string): {
  content: string
  encoding: BufferEncoding
  lineEndings: LineEndingType
} {
  const encoding = detectEncodingForResolvedPath(filePath)
  const raw = readFileSync(filePath, { encoding })
  const lineEndings = detectLineEndingsForString(raw.slice(0, 4096))
  return {
    content: raw.replaceAll('\r\n', '\n'),
    encoding,
    lineEndings,
  }
}

export function readFileSync_(filePath: string): string {
  return readFileSyncWithMetadata(filePath).content
}
