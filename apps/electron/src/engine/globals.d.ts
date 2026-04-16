/**
 * Build-time constants injected by Bun bundler.
 * In Klaus (running via tsx/Node), these are shimmed at runtime.
 */
declare const MACRO: {
  VERSION: string
  BUILD_TIME: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL?: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  VERSION_CHANGELOG?: string
  IS_CI: boolean
}

/**
 * Bun runtime global — only present when running under Bun.
 * Typed loosely so that `typeof Bun` checks compile without @types/bun.
 */
declare const Bun: {
  which: (name: string) => string | null
  listen: <T>(opts: unknown) => { stop: () => void; hostname: string; port: number }
  embeddedFiles: unknown[]
  generateHeapSnapshot: (...args: unknown[]) => ArrayBuffer
  gc: (full?: boolean) => void
  hash: ((data: string | ArrayBuffer | Uint8Array, seed?: number) => number) & {
    wyhash: (data: string | ArrayBuffer | Uint8Array, seed?: bigint) => bigint
    adler32: (data: string | ArrayBuffer | Uint8Array) => number
    crc32: (data: string | ArrayBuffer | Uint8Array) => number
    cityHash32: (data: string | ArrayBuffer | Uint8Array) => number
    cityHash64: (data: string | ArrayBuffer | Uint8Array) => bigint
    murmur32v3: (data: string | ArrayBuffer | Uint8Array, seed?: number) => number
    murmur64v2: (data: string | ArrayBuffer | Uint8Array, seed?: bigint) => bigint
  }
  semver: {
    satisfies: (version: string, range: string) => boolean
    order: (a: string, b: string) => -1 | 0 | 1
  }
  JSONL: { parseChunk: (...args: unknown[]) => unknown }
  YAML: { parse: (text: string) => unknown; stringify: (value: unknown) => string }
  password: { hash: (pw: string, opts?: unknown) => Promise<string>; verify: (pw: string, hash: string) => Promise<boolean> }
  file: (path: string) => unknown
  write: (path: string, data: unknown) => Promise<number>
  spawn: (cmd: string[], opts?: unknown) => { stdout: ReadableStream; stderr: ReadableStream; exited: Promise<number>; kill: () => void; pid: number }
  [key: string]: unknown
}

/** Module declarations for untyped packages. */
declare module 'picomatch' {
  function picomatch(glob: string | string[], options?: Record<string, unknown>): (input: string) => boolean
  namespace picomatch {
    function isMatch(str: string, pattern: string | string[], options?: Record<string, unknown>): boolean
    function makeRe(pattern: string, options?: Record<string, unknown>): RegExp
  }
  export = picomatch
}
declare module 'semver' {
  export function satisfies(version: string, range: string, options?: unknown): boolean
  export function valid(version: string | null): string | null
  export function gte(v1: string, v2: string, options?: unknown): boolean
  export function gt(v1: string, v2: string, options?: unknown): boolean
  export function lt(v1: string, v2: string, options?: unknown): boolean
  export function lte(v1: string, v2: string, options?: unknown): boolean
  export function compare(v1: string, v2: string, options?: unknown): -1 | 0 | 1
  export function coerce(version: string | null): { version: string; compare: (other: string) => -1 | 0 | 1; major: number; minor: number; patch: number } | null
  export function parse(version: string): { major: number; minor: number; patch: number } | null
}
declare module 'proper-lockfile' {
  export interface LockOptions { stale?: number; realpath?: boolean; retries?: number | { retries?: number; minTimeout?: number; maxTimeout?: number }; [key: string]: unknown }
  export interface UnlockOptions { realpath?: boolean; [key: string]: unknown }
  export interface CheckOptions { stale?: number; realpath?: boolean; [key: string]: unknown }
  export function lock(path: string, options?: LockOptions): Promise<() => Promise<void>>
  export function lockSync(path: string, options?: LockOptions): () => void
  export function unlock(path: string, options?: UnlockOptions): Promise<void>
  export function check(path: string, options?: CheckOptions): Promise<boolean>
}

/**
 * Polyfill type for Promise.withResolvers() (ES2024).
 * Node 18 doesn't have this natively.
 */
interface PromiseWithResolvers<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}
