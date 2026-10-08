import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { CCReachClient, boundedCount, isRecord, nonBlank, throwIfAborted, usableOptions } from './client.js'
import type { CCReachClientOptions } from './client.js'
import type { CCReachResource, CCReachSearchResponse } from './types.js'

export const CCREACH_PROVIDER_ID = 'ccreach'
export type CCReachSearchProviderOptions = CCReachClientOptions

/** checked_at is a source check date, not an asserted publication date. */
export function normalizedCheckedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const iso = `${value}T00:00:00Z`
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? iso : undefined
}

/** Copy only measured source fields; metadata does not claim that a capability ran. */
export function mapCCReachResource(resource: CCReachResource): WebSearchSource | undefined {
  if (!isRecord(resource) || typeof resource.name !== 'string' || typeof resource.summary !== 'string') {
    throw new WebError('CCReach returned an invalid resource', 'WEB_PROVIDER_ERROR')
  }
  const access = resource.access
  if (access !== undefined && access !== null && !isRecord(access)) throw new WebError('CCReach returned invalid access data', 'WEB_PROVIDER_ERROR')
  if (resource.sources !== undefined && !Array.isArray(resource.sources)) throw new WebError('CCReach returned invalid source data', 'WEB_PROVIDER_ERROR')
  const firstSource = resource.sources?.[0]
  if (firstSource !== undefined && !isRecord(firstSource)) throw new WebError('CCReach returned invalid source data', 'WEB_PROVIDER_ERROR')
  const url = nonBlank(access?.docs_url) ?? nonBlank(firstSource?.url)
  if (url === undefined) return undefined
  if (typeof resource.resource_kind !== 'string' || !Array.isArray(resource.protocols)
    || !resource.protocols.every(protocol => typeof protocol === 'string')
    || !isRecord(resource.cost) || typeof resource.cost.status !== 'string'
    || typeof resource.auth_status !== 'string' || typeof resource.executable !== 'boolean'
    || (resource.missing_conditions !== undefined && (!Array.isArray(resource.missing_conditions)
      || !resource.missing_conditions.every(condition => typeof condition === 'string')))) {
    throw new WebError('CCReach returned invalid capability metadata', 'WEB_PROVIDER_ERROR')
  }
  const publishedAt = normalizedCheckedAt(firstSource?.checked_at)
  const metadata = `[CCReach capability metadata] resource_kind=${resource.resource_kind}; protocols=${resource.protocols.join(',')}; cost.status=${resource.cost.status}; auth_status=${resource.auth_status}; executable=${String(resource.executable)}; missing_conditions=${JSON.stringify(resource.missing_conditions ?? [])}`
  return {
    url,
    title: resource.name,
    snippet: `${resource.summary}\n${metadata}`,
    ...(publishedAt === undefined ? {} : { publishedAt }),
  }
}

/** Result pagination describes the backend; truncated only means local bound removal. */
export function mapCCReachResponse(response: CCReachSearchResponse, maxResults = 50): WebSearchResult {
  if (!isRecord(response) || !Array.isArray(response.results)) {
    throw new WebError('CCReach returned an invalid search response', 'WEB_PROVIDER_ERROR')
  }
  const limit = boundedCount(maxResults)
  const sources = response.results.map(mapCCReachResource).filter((source): source is WebSearchSource => source !== undefined)
  return { sources: sources.slice(0, limit), truncated: sources.length > limit }
}

/** Registers under ccreach; anonymous public search is the default. */
export class CCReachSearchProvider implements WebSearchProvider {
  readonly id = CCREACH_PROVIDER_ID
  constructor(private readonly resolveOptions: (() => CCReachSearchProviderOptions) | CCReachSearchProviderOptions = {}) {}
  private options(): CCReachSearchProviderOptions {
    return typeof this.resolveOptions === 'function' ? this.resolveOptions() : this.resolveOptions
  }
  /** Official DSH contract forbids network operations here; use health() explicitly. */
  available(): boolean {
    try { return usableOptions(this.options()) } catch { return false }
  }
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    throwIfAborted(signal)
    let options: CCReachSearchProviderOptions
    try { options = { ...this.options() } }
    catch { throw new WebError('CCReach configuration could not be resolved', 'WEB_PROVIDER_ERROR') }
    if (typeof request.query !== 'string') throw new WebError('CCReach query must be a string', 'WEB_PROVIDER_ERROR')
    const limit = boundedCount(request.maxResults, options.count)
    const response = await new CCReachClient(options).search(request.query, limit, signal)
    throwIfAborted(signal)
    return mapCCReachResponse(response, limit)
  }
  /** Health/readiness verification via the keyless, read-only /api/meta endpoint. */
  async health(signal?: AbortSignal) {
    throwIfAborted(signal)
    return await new CCReachClient({ ...this.options() }).health(signal)
  }
}
