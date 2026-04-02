/**
 * WebFetchTool utilities -- adapted from claude-code's WebFetchTool/utils.ts.
 * Removed: analytics, domain blocklist preflight, mcpOutputStorage,
 * settings_DEPRECATED, queryHaiku (secondary model), systemPromptType.
 * Simplified: applyPromptToMarkdown returns truncated content directly
 * (no secondary model summarization in Klaus).
 */
import axios, { type AxiosResponse } from 'axios'
import { LRUCache } from 'lru-cache'
import { AbortError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { isPreapprovedHost } from './preapproved.js'
import { makeSecondaryModelPrompt } from './prompt.js'

const MAX_URL_LENGTH = 2000
const MAX_HTTP_CONTENT_LENGTH = 10 * 1024 * 1024
const FETCH_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 10

export const MAX_MARKDOWN_LENGTH = 100_000

type CacheEntry = {
  bytes: number
  code: number
  codeText: string
  content: string
  contentType: string
}

const CACHE_TTL_MS = 15 * 60 * 1000
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024

const URL_CACHE = new LRUCache<string, CacheEntry>({
  maxSize: MAX_CACHE_SIZE_BYTES,
  ttl: CACHE_TTL_MS,
})

export function clearWebFetchCache(): void {
  URL_CACHE.clear()
}

// Lazy singleton for TurndownService (optional dependency)
let turndownServicePromise: Promise<{ turndown(html: string): string }> | undefined
function getTurndownService(): Promise<{ turndown(html: string): string }> {
  // @ts-ignore - turndown is an optional dependency
  return (turndownServicePromise ??= (import('turndown') as Promise<any>).then(
    (m: any) => {
      const Turndown = m.default || m
      return new Turndown()
    },
    () => {
      // Fallback: basic HTML tag stripping if turndown is not installed
      return {
        turndown(html: string): string {
          return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        },
      }
    },
  ))
}

function getWebFetchUserAgent(): string {
  return 'ClaudeCode/1.0 (Anthropic; +https://www.anthropic.com)'
}

export function isPreapprovedUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname)
  } catch {
    return false
  }
}

export function validateURL(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) return false

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.username || parsed.password) return false

  const hostname = parsed.hostname
  const parts = hostname.split('.')
  if (parts.length < 2) return false

  return true
}

export function isPermittedRedirect(
  originalUrl: string,
  redirectUrl: string,
): boolean {
  try {
    const parsedOriginal = new URL(originalUrl)
    const parsedRedirect = new URL(redirectUrl)

    if (parsedRedirect.protocol !== parsedOriginal.protocol) return false
    if (parsedRedirect.port !== parsedOriginal.port) return false
    if (parsedRedirect.username || parsedRedirect.password) return false

    const stripWww = (hostname: string) => hostname.replace(/^www\./, '')
    const originalHostWithoutWww = stripWww(parsedOriginal.hostname)
    const redirectHostWithoutWww = stripWww(parsedRedirect.hostname)
    return originalHostWithoutWww === redirectHostWithoutWww
  } catch {
    return false
  }
}

type RedirectInfo = {
  type: 'redirect'
  originalUrl: string
  redirectUrl: string
  statusCode: number
}

export async function getWithPermittedRedirects(
  url: string,
  signal: AbortSignal,
  redirectChecker: (originalUrl: string, redirectUrl: string) => boolean,
  depth = 0,
): Promise<AxiosResponse<ArrayBuffer> | RedirectInfo> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`)
  }
  try {
    return await axios.get(url, {
      signal,
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 0,
      responseType: 'arraybuffer',
      maxContentLength: MAX_HTTP_CONTENT_LENGTH,
      headers: {
        Accept: 'text/markdown, text/html, */*',
        'User-Agent': getWebFetchUserAgent(),
      },
    })
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response &&
      [301, 302, 307, 308].includes(error.response.status)
    ) {
      const redirectLocation = error.response.headers.location
      if (!redirectLocation) {
        throw new Error('Redirect missing Location header')
      }

      const redirectUrl = new URL(redirectLocation, url).toString()

      if (redirectChecker(url, redirectUrl)) {
        return getWithPermittedRedirects(
          redirectUrl,
          signal,
          redirectChecker,
          depth + 1,
        )
      } else {
        return {
          type: 'redirect',
          originalUrl: url,
          redirectUrl,
          statusCode: error.response.status,
        }
      }
    }
    throw error
  }
}

function isRedirectInfo(
  response: AxiosResponse<ArrayBuffer> | RedirectInfo,
): response is RedirectInfo {
  return 'type' in response && response.type === 'redirect'
}

export type FetchedContent = {
  content: string
  bytes: number
  code: number
  codeText: string
  contentType: string
}

export async function getURLMarkdownContent(
  url: string,
  abortController: AbortController,
): Promise<FetchedContent | RedirectInfo> {
  if (!validateURL(url)) {
    throw new Error('Invalid URL')
  }

  // Check cache
  const cachedEntry = URL_CACHE.get(url)
  if (cachedEntry) {
    return {
      bytes: cachedEntry.bytes,
      code: cachedEntry.code,
      codeText: cachedEntry.codeText,
      content: cachedEntry.content,
      contentType: cachedEntry.contentType,
    }
  }

  let upgradedUrl = url
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:'
      upgradedUrl = parsedUrl.toString()
    }
  } catch (e) {
    logError(e)
  }

  const response = await getWithPermittedRedirects(
    upgradedUrl,
    abortController.signal,
    isPermittedRedirect,
  )

  if (isRedirectInfo(response)) {
    return response
  }

  const rawBuffer = Buffer.from(response.data)
  ;(response as { data: unknown }).data = null
  const contentType = response.headers['content-type'] ?? ''

  const bytes = rawBuffer.length
  const htmlContent = rawBuffer.toString('utf-8')

  let markdownContent: string
  let contentBytes: number
  if (contentType.includes('text/html')) {
    markdownContent = (await getTurndownService()).turndown(htmlContent)
    contentBytes = Buffer.byteLength(markdownContent)
  } else {
    markdownContent = htmlContent
    contentBytes = bytes
  }

  const entry: CacheEntry = {
    bytes,
    code: response.status,
    codeText: response.statusText,
    content: markdownContent,
    contentType,
  }
  URL_CACHE.set(url, entry, { size: Math.max(1, contentBytes) })
  return entry
}

/**
 * In Klaus, we don't have a secondary model for summarization.
 * Instead, we truncate the content and return it directly.
 */
export async function applyPromptToMarkdown(
  prompt: string,
  markdownContent: string,
  signal: AbortSignal,
  _isNonInteractiveSession: boolean,
  isPreapprovedDomain: boolean,
): Promise<string> {
  if (signal.aborted) {
    throw new AbortError()
  }

  const truncatedContent =
    markdownContent.length > MAX_MARKDOWN_LENGTH
      ? markdownContent.slice(0, MAX_MARKDOWN_LENGTH) +
        '\n\n[Content truncated due to length...]'
      : markdownContent

  // Return the content directly with the prompt context
  return `Prompt: ${prompt}\n\n---\n\n${truncatedContent}`
}
