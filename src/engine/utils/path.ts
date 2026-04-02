import { homedir } from 'os'
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from 'path'
import { statSync } from 'fs'
import { getCwd } from './cwd.js'

/**
 * Expands a path that may contain tilde notation (~) to an absolute path.
 *
 * @param path - The path to expand, may contain ~ or be relative
 * @param baseDir - The base directory for resolving relative paths (defaults to cwd)
 * @returns The expanded absolute path
 */
export function expandPath(path: string, baseDir?: string): string {
  const actualBaseDir = baseDir ?? getCwd()

  if (typeof path !== 'string') {
    throw new TypeError(`Path must be a string, received ${typeof path}`)
  }

  // Security: Check for null bytes
  if (path.includes('\0') || actualBaseDir.includes('\0')) {
    throw new Error('Path contains null bytes')
  }

  const trimmedPath = path.trim()
  if (!trimmedPath) {
    return normalize(actualBaseDir).normalize('NFC')
  }

  // Handle home directory notation
  if (trimmedPath === '~') {
    return homedir().normalize('NFC')
  }

  if (trimmedPath.startsWith('~/')) {
    return join(homedir(), trimmedPath.slice(2)).normalize('NFC')
  }

  // Handle absolute paths
  if (isAbsolute(trimmedPath)) {
    return normalize(trimmedPath).normalize('NFC')
  }

  // Handle relative paths
  return resolve(actualBaseDir, trimmedPath).normalize('NFC')
}

/**
 * Converts an absolute path to a relative path from cwd, to save tokens in
 * tool output. If the path is outside cwd (relative path would start with ..),
 * returns the absolute path unchanged so it stays unambiguous.
 */
export function toRelativePath(absolutePath: string): string {
  const relativePath = relative(getCwd(), absolutePath)
  return relativePath.startsWith('..') ? absolutePath : relativePath
}

/**
 * Gets the directory path for a given file or directory path.
 * If the path is a directory, returns the path itself.
 * If the path is a file or doesn't exist, returns the parent directory.
 */
export function getDirectoryForPath(path: string): string {
  const absolutePath = expandPath(path)
  try {
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) {
      return absolutePath
    }
  } catch {
    // Path doesn't exist or can't be accessed
  }
  return dirname(absolutePath)
}

/**
 * Checks if a path contains directory traversal patterns that navigate to parent directories.
 */
export function containsPathTraversal(path: string): boolean {
  return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path)
}
