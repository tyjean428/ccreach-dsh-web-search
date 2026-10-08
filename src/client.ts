import { WebError } from '@deepseek-ai/dsh-web'
import type { CCReachFilters, CCReachMeta, CCReachSearchResponse } from './types.js'

export const CCREACH_DEFAULT_BASE_URL = 'https://ccreach.com'
export const CCREACH_DEFAULT_COUNT = 10
export const CCREACH_MAX_COUNT = 50
export const CCREACH_DEFAULT_API_KEY_ENV = 'CCREACH_API_KEY'
export type FetchLike = typeof fetch

export interface CCReachClientOptions extends CCReachFilters {
  baseURL?: string
  count?: number
  apiKey?: string
  resolveApiKey?: () => Promise<string | undefined>
  apiKeyEnv?: string
  /** Optional future authenticated mode; false keeps today's public API anonymous. */
  requireApiKey?: boolean
  /** Override transport for tests/embedding, never loaded from a Cordis config. */
  fetch?: FetchLike
}

const categories = new Set(['all', 'information', 'data', 'development', 'office', 'media', 'automation', 'research', 'agents'])
const kinds = new Set(['all', 'document', 'data_source', 'tool', 'agent', 'skill', 'workflow'])
const protocols = new Set(['all', 'web', 'http', 'mcp', 'a2a', 'local'])

export function usableOptions(options: CCReachClientOptions): boolean {
  try {
    baseURL(options.baseURL)
    validateFilters(options)
    return typeof (options.fetch ?? globalThis.fetch) === 'function'
      && validCount(options.count ?? CCREACH_DEFAULT_COUNT)
      && (options.requireApiKey !== true || nonBlank(options.apiKey) !== undefined || options.resolveApiKey !== undefined)
  } catch { return false }
}

export function boundedCount(requested: number | undefined, configured = CCREACH_DEFAULT_COUNT): number {
  const value = requested ?? configured
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new WebError('CCReach result count must be a positive integer', 'WEB_PROVIDER_ERROR')
  }
  return Math.min(value, CCREACH_MAX_COUNT)
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WebError('CCReach request aborted', 'WEB_ABORTED')
}

function aborted(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
}

export function nonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function validCount(value: number): boolean { return Number.isInteger(value) && value >= 1 && value <= 50 }

function baseURL(value = CCREACH_DEFAULT_BASE_URL): URL {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid CCReach baseURL')
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/'
  return url
}

function validateFilters(options: CCReachFilters): void {
  for (const [key, allowed] of [['category', categories], ['kind', kinds], ['protocol', protocols]] as const) {
    if (options[key] !== undefined && !allowed.has(options[key])) throw new Error(`Invalid CCReach ${key}`)
  }
  for (const key of ['free_only', 'executable_only'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new Error(`Invalid CCReach ${key}`)
  }
  if (options.page !== undefined && (!Number.isInteger(options.page) || options.page < 1)) throw new Error('Invalid CCReach page')
  for (const key of ['snapshot_id', 'result_set_id'] as const) {
    if (options[key] != null && !/^[a-fA-F0-9]{64}$/.test(options[key])) throw new Error(`Invalid CCReach ${key}`)
  }
}

/** Race a credentials lookup against cancellation without caching the credential. */
async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  if (!signal) return operation
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(new WebError('CCReach request aborted', 'WEB_ABORTED')) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      error => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

/** HTTP client for the public API; never follows redirects with credentials. */
export class CCReachClient {
  constructor(private readonly options: CCReachClientOptions = {}) {}

  async search(query: string, limit: number, signal?: AbortSignal): Promise<CCReachSearchResponse> {
    throwIfAborted(signal)
    let url: URL
    try {
      validateFilters(this.options)
      url = new URL('api/search', baseURL(this.options.baseURL))
      url.searchParams.set('q', query)
      url.searchParams.set('limit', String(boundedCount(limit)))
      for (const key of ['category', 'kind', 'protocol', 'free_only', 'executable_only', 'page', 'snapshot_id', 'result_set_id'] as const) {
        const value = this.options[key]
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
      }
    } catch { throw new WebError('Invalid CCReach search configuration', 'WEB_PROVIDER_ERROR') }
    return await this.request(url, signal) as CCReachSearchResponse
  }

  /** Explicit live health check; available() remains synchronous and local. */
  async health(signal?: AbortSignal): Promise<CCReachMeta> {
    throwIfAborted(signal)
    let url: URL
    try { url = new URL('api/meta', baseURL(this.options.baseURL)) }
    catch { throw new WebError('Invalid CCReach baseURL', 'WEB_PROVIDER_ERROR') }
    const value = await this.request(url, signal)
    if (!isRecord(value) || !Array.isArray(value.categories) || !Array.isArray(value.kinds)
      || !Array.isArray(value.protocols) || !isRecord(value.counts)
      || typeof value.counts.resources !== 'number' || !isRecord(value.retrieval)
      || typeof value.retrieval.method !== 'string' || typeof value.retrieval.status !== 'string') {
      throw new WebError('CCReach returned an invalid meta response', 'WEB_PROVIDER_ERROR')
    }
    return value as unknown as CCReachMeta
  }

  private async credential(signal?: AbortSignal): Promise<string | undefined> {
    throwIfAborted(signal)
    let key = nonBlank(this.options.apiKey)
    if (key === undefined) {
      try {
        key = nonBlank(await abortable(this.options.resolveApiKey?.() ?? Promise.resolve(process.env[this.options.apiKeyEnv ?? CCREACH_DEFAULT_API_KEY_ENV]), signal))
      } catch (error) {
        if (aborted(error, signal) || (error instanceof WebError && error.code === 'WEB_ABORTED')) {
          throw new WebError('CCReach request aborted', 'WEB_ABORTED')
        }
        throw new WebError('CCReach credential resolution failed', 'WEB_PROVIDER_ERROR')
      }
    }
    throwIfAborted(signal)
    if (key === undefined && this.options.requireApiKey === true) {
      throw new WebError('CCReach authenticated mode requires a configured credential', 'WEB_PROVIDER_CREDENTIAL_MISSING')
    }
    return key
  }

  private async request(url: URL, signal?: AbortSignal): Promise<unknown> {
    const key = await this.credential(signal)
    throwIfAborted(signal)
    try {
      const response = await (this.options.fetch ?? globalThis.fetch)(url, {
        method: 'GET', redirect: 'error',
        headers: { accept: 'application/json', 'user-agent': 'ccreach-dsh-web-search/0.1.0', ...(key === undefined ? {} : { Authorization: `Bearer ${key}` }) },
        ...(signal === undefined ? {} : { signal }),
      })
      throwIfAborted(signal)
      if (response.status !== 200) throw new WebError(`CCReach HTTP ${response.status}`, 'WEB_PROVIDER_ERROR')
      const body: unknown = await response.json()
      throwIfAborted(signal)
      return body
    } catch (error) {
      if (aborted(error, signal)) throw new WebError('CCReach request aborted', 'WEB_ABORTED')
      if (error instanceof WebError) throw error
      // Do not expose server bodies, fetch messages, URLs with credentials, or resolver errors.
      throw new WebError('CCReach request failed or returned invalid JSON', 'WEB_PROVIDER_ERROR')
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
