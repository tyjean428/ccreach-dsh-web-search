import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import { CCREACH_DEFAULT_API_KEY_ENV, CCREACH_DEFAULT_BASE_URL, CCREACH_DEFAULT_COUNT } from './client.js'
import { CCReachSearchProvider } from './provider.js'
import type { CCReachClientOptions } from './client.js'
import type { CCReachCategory, CCReachFilters, CCReachKind, CCReachProtocol } from './types.js'

export * from './types.js'
export { CCReachClient, CCREACH_DEFAULT_API_KEY_ENV, CCREACH_DEFAULT_BASE_URL, CCREACH_DEFAULT_COUNT, CCREACH_MAX_COUNT } from './client.js'
export type { CCReachClientOptions, FetchLike } from './client.js'
export { CCReachSearchProvider, CCREACH_PROVIDER_ID, mapCCReachResource, mapCCReachResponse, normalizedCheckedAt } from './provider.js'
export type { CCReachSearchProviderOptions } from './provider.js'

export const name = 'web-search-ccreach'
export const inject = ['web']

/** Optional keys preserve anonymous defaults and are resolved once per operation. */
export interface Config extends CCReachFilters {
  baseURL?: string
  count?: number
  apiKeyEnv?: string
  requireApiKey?: boolean
}

export const Config: z<Config> = z.object({
  baseURL: z.string().default(CCREACH_DEFAULT_BASE_URL),
  count: z.number().step(1).min(1).max(50).default(CCREACH_DEFAULT_COUNT),
  apiKeyEnv: z.string().role('credential-ref').default(CCREACH_DEFAULT_API_KEY_ENV),
  requireApiKey: z.boolean().default(false),
  category: z.union(['all', 'information', 'data', 'development', 'office', 'media', 'automation', 'research', 'agents']) as z<CCReachCategory>,
  kind: z.union(['all', 'document', 'data_source', 'tool', 'agent', 'skill', 'workflow']) as z<'all' | CCReachKind>,
  protocol: z.union(['all', 'web', 'http', 'mcp', 'a2a', 'local']) as z<'all' | CCReachProtocol>,
  free_only: z.boolean(),
  executable_only: z.boolean(),
  page: z.number().step(1).min(1),
  snapshot_id: z.string().pattern(/^[a-fA-F0-9]{64}$/),
  result_set_id: z.string().pattern(/^[a-fA-F0-9]{64}$/),
})

/** DSH credentials service covers $DSH_HOME/.credentials.yaml and launch env. */
export function resolveProviderOptions(ctx: Context, config: Config = {}): CCReachClientOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? CCREACH_DEFAULT_API_KEY_ENV)
  return {
    ...config,
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      return launchEnvironmentOf(ctx).get(apiKeyEnv)?.value
    },
  }
}

/** Cordis owns the registration disposer's fiber lifecycle, as with built-in providers. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.web.registerSearchProvider(new CCReachSearchProvider(() => resolveProviderOptions(ctx, config)))
}
