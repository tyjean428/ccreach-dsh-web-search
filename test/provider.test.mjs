import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import * as plugin from '../lib/index.js'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { CCReachClient, CCReachSearchProvider, mapCCReachResource, mapCCReachResponse, normalizedCheckedAt, resolveProviderOptions, apply } from '../lib/index.js'
import { jsonResponse, resource, response } from './fixtures.mjs'

const errorCode = code => error => error.code === code
const provider = options => new CCReachSearchProvider({ resolveApiKey: async () => undefined, ...options })

test('mock has exactly all enumerated resource fields and top-level envelope', () => {
  assert.deepEqual(Object.keys(resource()).sort(), ['id', 'name', 'summary', 'resource_kind', 'category_ids', 'protocols', 'executable', 'auth_status', 'aliases', 'tags', 'tasks', 'cost', 'sources', 'verification', 'access', 'admission', 'field_evidence', 'page_role', 'parser_version', 'raw_content_hash', 'rank_in_kind', 'matched_terms', 'reasons', 'missing_conditions', 'retrieval_evidence'].sort())
  assert.equal(Object.keys(response()).length, 18)
})
test('maps docs URL, name, summary, checked date and all required annotations; omits content', () => {
  const result = mapCCReachResponse(response())
  assert.equal(result.sources[0].url, 'https://provider.example/docs')
  assert.equal(result.sources[0].title, 'Weather API')
  assert.equal(result.sources[0].publishedAt, '2026-10-07T00:00:00Z')
  assert.match(result.sources[0].snippet, /^Forecast capability for agents\./)
  for (const value of ['resource_kind=tool', 'protocols=http,mcp', 'cost.status=free_tier', 'auth_status=unknown', 'executable=true', 'Authentication needs confirmation']) assert.ok(result.sources[0].snippet.includes(value))
  assert.equal(Object.hasOwn(result, 'content'), false)
  assert.equal(result.truncated, false)
})
test('blank or absent docs URL uses sources[0] URL', () => {
  for (const access of [{ docs_url: '  ' }, {}, undefined]) assert.equal(mapCCReachResource(resource({ access })).url, 'https://provider.example/source')
})
test('both URLs absent drops only that resource', () => {
  const result = mapCCReachResponse(response([resource({ access: {}, sources: [] }), resource()]))
  assert.equal(result.sources.length, 1)
})
test('only first source is mapped; does not substitute execution endpoint', () => {
  assert.equal(mapCCReachResource(resource({ access: { endpoint: 'https://provider.example/execute' }, sources: [{ url: '' }, { url: 'https://provider.example/second' }] })), undefined)
})
test('date normalization accepts leap dates, rejects impossible dates and missing dates', () => {
  assert.equal(normalizedCheckedAt('2024-02-29'), '2024-02-29T00:00:00Z')
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-07T12:00:00Z', null, '']) assert.equal(normalizedCheckedAt(date), undefined)
  assert.equal(Object.hasOwn(mapCCReachResource(resource({ sources: [{ url: 'https://example.com', checked_at: null }] })), 'publishedAt'), false)
})
test('unknown costs and permissions remain unknown, not free or verified', () => {
  const source = mapCCReachResource(resource({ cost: { status: 'unknown' }, executable: false, missing_conditions: [] }))
  assert.match(source.snippet, /cost.status=unknown/)
  assert.match(source.snippet, /executable=false/)
  assert.doesNotMatch(source.snippet, /execution_tested=true|is_free=true/)
})
test('maps live-style records without unused optional fields or rankings', () => {
  const value = resource()
  for (const key of ['admission', 'field_evidence', 'page_role', 'parser_version', 'raw_content_hash', 'rank_in_kind', 'matched_terms', 'reasons', 'missing_conditions', 'retrieval_evidence']) delete value[key]
  assert.ok(mapCCReachResource(value))
})
test('anonymous available is synchronous and does no networking or credential reads', () => {
  let reads = 0
  const p = provider({ fetch: () => { reads++; throw Error('must not fetch') }, resolveApiKey: () => { reads++; throw Error('must not resolve') } })
  assert.equal(p.id, 'ccreach')
  assert.equal(p.available(), true)
  assert.equal(reads, 0)
})
test('unusable URL/config reports unavailable locally', () => {
  for (const options of [{ baseURL: 'invalid' }, { baseURL: 'file:///tmp' }, { baseURL: 'https://user:secret@example.com' }, { baseURL: 'https://example.com/?secret=x' }, { count: 0 }, { count: 51 }, { category: 'made-up' }, { page: 0 }, { free_only: 'false' }, { result_set_id: 'invalid' }]) assert.equal(provider(options).available(), false)
})
test('query Unicode, maxResults and all config filters are passed; no key by default', async () => {
  let captured
  const p = provider({ category: 'data', kind: 'tool', protocol: 'http', free_only: false, executable_only: true, page: 2, snapshot_id: 'a'.repeat(64), result_set_id: 'b'.repeat(64), fetch: async (url, init) => { captured = [url, init]; return jsonResponse(response()) } })
  await p.search({ query: '杭州 天气 & ? #', maxResults: 7 })
  assert.equal(captured[0].pathname, '/api/search')
  for (const [key, value] of Object.entries({ q: '杭州 天气 & ? #', limit: '7', category: 'data', kind: 'tool', protocol: 'http', free_only: 'false', executable_only: 'true', page: '2', snapshot_id: 'a'.repeat(64), result_set_id: 'b'.repeat(64) })) assert.equal(captured[0].searchParams.get(key), value)
  assert.equal(captured[1].method, 'GET')
  assert.equal(captured[1].redirect, 'error')
  assert.equal(captured[1].headers.Authorization, undefined)
})
test('default count is 10 and configured count is used without maxResults', async () => {
  for (const [config, expected] of [[{}, 10], [{ count: 4 }, 4]]) {
    const p = provider({ ...config, fetch: async url => { assert.equal(url.searchParams.get('limit'), String(expected)); return jsonResponse(response()) } })
    await p.search({ query: 'x' })
  }
})
test('maxResults > 50 caps transport and returned sources at 50', async () => {
  const p = provider({ fetch: async url => { assert.equal(url.searchParams.get('limit'), '50'); return jsonResponse(response(Array.from({ length: 55 }, (_, i) => resource({ id: String(i) })))) } })
  const result = await p.search({ query: 'x', maxResults: 100 })
  assert.equal(result.sources.length, 50)
  assert.equal(result.truncated, true)
})
test('server over-return is bounded after URL-less rows removed', async () => {
  const result = await provider({ fetch: async () => jsonResponse(response([resource({ access: {}, sources: [] }), resource(), resource()])) }).search({ query: 'x', maxResults: 1 })
  assert.equal(result.sources.length, 1)
  assert.equal(result.truncated, true)
})
test('has_next does not incorrectly mark source-bound truncation', () => {
  assert.equal(mapCCReachResponse({ ...response(), has_next: true, total: 200 }, 10).truncated, false)
})
test('null snapshot and result set config are omitted; no implicit pagination loop', async () => {
  let calls = 0
  await provider({ snapshot_id: null, result_set_id: null, fetch: async url => { calls++; assert.equal(url.searchParams.has('snapshot_id'), false); assert.equal(url.searchParams.has('result_set_id'), false); return jsonResponse({ ...response(), has_next: true }) } }).search({ query: 'x' })
  assert.equal(calls, 1)
})
test('invalid counts/filters fail as provider errors before network', async () => {
  const p = provider({ fetch: async () => { assert.fail('no network') } })
  for (const maxResults of [0, -1, NaN, Infinity, 1.5]) await assert.rejects(p.search({ query: 'x', maxResults }), errorCode('WEB_PROVIDER_ERROR'))
  await assert.rejects(provider({ kind: 'invented' }).search({ query: 'x' }), errorCode('WEB_PROVIDER_ERROR'))
})
test('optional key is resolved once per operation and can rotate', async () => {
  let reads = 0
  let calls = 0
  const p = provider({ resolveApiKey: async () => `test-key-${++reads}`, fetch: async (_, init) => { assert.equal(init.headers.Authorization, `Bearer test-key-${++calls}`); return jsonResponse(response()) } })
  await p.search({ query: 'x' }); await p.search({ query: 'y' })
  assert.equal(reads, 2)
})
test('explicit authenticated mode uses missing-credential standard error', async () => {
  const p = provider({ requireApiKey: true, fetch: async () => assert.fail('no network') })
  assert.equal(p.available(), true) // A configured resolver may supply a key at operation time.
  await assert.rejects(p.search({ query: 'x' }), errorCode('WEB_PROVIDER_CREDENTIAL_MISSING'))
})
test('credential failure is generic and never exposes the thrown secret', async () => {
  await assert.rejects(provider({ resolveApiKey: async () => { throw Error('sensitive-value') } }).search({ query: 'x' }), error => error.code === 'WEB_PROVIDER_ERROR' && !String(error).includes('sensitive-value'))
})
test('all non-200 statuses, including 201 and redirects, are provider errors', async () => {
  for (const status of [201, 301, 400, 401, 429, 500]) await assert.rejects(provider({ fetch: async () => jsonResponse({ message: 'sensitive body' }, status) }).search({ query: 'x' }), error => error.code === 'WEB_PROVIDER_ERROR' && !String(error).includes('sensitive body'))
})
test('network errors and invalid JSON are provider errors', async () => {
  for (const fetcher of [async () => { throw new TypeError('fetch failed') }, async () => new Response('not JSON')]) await assert.rejects(provider({ fetch: fetcher }).search({ query: 'x' }), errorCode('WEB_PROVIDER_ERROR'))
})
test('malformed envelope and metadata are provider errors', async () => {
  for (const body of [null, [], {}, { results: null }, { results: {} }, response([resource({ protocols: 'http' })]), response([resource({ summary: null })]), response([resource({ missing_conditions: [1] })])]) await assert.rejects(provider({ fetch: async () => jsonResponse(body) }).search({ query: 'x' }), errorCode('WEB_PROVIDER_ERROR'))
})
test('pre-aborted request does not resolve credentials or fetch', async () => {
  const controller = new AbortController(); controller.abort('custom reason')
  await assert.rejects(provider({ resolveApiKey: async () => assert.fail('no credential lookup'), fetch: async () => assert.fail('no fetch') }).search({ query: 'x' }, controller.signal), errorCode('WEB_ABORTED'))
})
test('abort while resolving a credential ends promptly', async () => {
  const controller = new AbortController()
  const operation = provider({ resolveApiKey: () => new Promise(() => {}), fetch: async () => assert.fail('no fetch') }).search({ query: 'x' }, controller.signal)
  controller.abort('custom reason')
  await assert.rejects(operation, errorCode('WEB_ABORTED'))
})
test('signal is forwarded and non-DOM AbortError is normalized', async () => {
  const controller = new AbortController()
  await assert.rejects(provider({ fetch: async (_, init) => { assert.equal(init.signal, controller.signal); throw Object.assign(Error('aborted'), { name: 'AbortError' }) } }).search({ query: 'x' }, controller.signal), errorCode('WEB_ABORTED'))
})
test('custom cancellation during transport or JSON parse is WEB_ABORTED', async () => {
  for (const phase of ['transport', 'body']) {
    const controller = new AbortController()
    const p = provider({ fetch: async () => {
      if (phase === 'transport') { controller.abort('custom'); throw Error('not AbortError') }
      return { status: 200, json: async () => { controller.abort('custom'); throw Error('not AbortError') } }
    } })
    await assert.rejects(p.search({ query: 'x' }, controller.signal), errorCode('WEB_ABORTED'))
  }
})
test('health uses GET /api/meta, validates response and is explicit', async () => {
  const meta = { categories: [], kinds: [], protocols: [], counts: { resources: 40000 }, catalog_version: 'test', snapshot_id: 'a'.repeat(64), retrieval: { method: 'hybrid', status: 'ready' } }
  const p = provider({ fetch: async url => { assert.equal(url.pathname, '/api/meta'); assert.equal(url.search, ''); return jsonResponse(meta) } })
  assert.deepEqual(await p.health(), meta)
  await assert.rejects(provider({ fetch: async () => jsonResponse({}) }).health(), errorCode('WEB_PROVIDER_ERROR'))
})
test('Cordis integration registers a real provider and credentials-service key resolution', async () => {
  let registered
  const ctx = { web: { registerSearchProvider: p => { registered = p } }, get: name => name === 'credentials' ? { resolve: async ref => { assert.equal(ref, 'CCREACH_API_KEY'); return { value: 'test-file-key', source: 'file' } } } : undefined }
  apply(ctx, {})
  assert.equal(registered.id, 'ccreach')
  assert.equal(registered.available(), true)
  assert.equal(await resolveProviderOptions(ctx, {}).resolveApiKey(), 'test-file-key')
})
test('without credentials service, launch environment supplies optional key', async () => {
  const snapshot = createLaunchEnvironmentSnapshot([{ source: 'process', values: { CCREACH_API_KEY: 'test-launch-key' } }])
  const ctx = { get: name => name === DSH_LAUNCH_ENVIRONMENT_KEY ? snapshot : undefined }
  assert.equal(await resolveProviderOptions(ctx, {}).resolveApiKey(), 'test-launch-key')
})
test('real Cordis fiber routes through ccreach and unregisters provider on disposal', async () => {
  const ctx = new Context()
  ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]))
  await ctx.plugin(WebRuntime, { searchProvider: 'ccreach' })
  const fiber = ctx.plugin(plugin, {})
  await fiber
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_, init) => { assert.equal(init.headers.Authorization, undefined); return jsonResponse(response()) }
  try {
    const result = await ctx.web.search({ query: 'weather', maxResults: 1 })
    assert.equal(result.sources[0].title, 'Weather API')
    await fiber.dispose()
    await assert.rejects(ctx.web.search({ query: 'weather' }), errorCode('WEB_PROVIDER_CONFIGURED_MISSING'))
  } finally {
    globalThis.fetch = originalFetch
    await ctx.fiber.dispose()
  }
})
test('actual Harness credentials document is resolved, can rotate, and inherited env wins', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ccreach-dsh-credentials-'))
  const filename = join(directory, '.credentials.yaml')
  await writeFile(filename, 'CCREACH_API_KEY: test-document-key\n', { mode: 0o600 })
  const ctx = new Context()
  ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]))
  try {
    await ctx.plugin(LocalCredentialProvider, { dshHome: directory, watch: false })
    const options = resolveProviderOptions(ctx, {})
    assert.equal(await options.resolveApiKey(), 'test-document-key')
    await ctx.credentials.set('CCREACH_API_KEY', 'test-rotated-key')
    assert.equal(await options.resolveApiKey(), 'test-rotated-key')
    const inheritedContext = new Context()
    inheritedContext.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: { CCREACH_API_KEY: 'test-env-key' } }]))
    try {
      await inheritedContext.plugin(LocalCredentialProvider, { dshHome: directory, watch: false })
      assert.equal(await resolveProviderOptions(inheritedContext, {}).resolveApiKey(), 'test-env-key')
    } finally { await inheritedContext.fiber.dispose() }
  } finally {
    await ctx.fiber.dispose()
    await unlink(filename)
    await rmdir(directory)
  }
})
