import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { CCReachClient, CCReachSearchProvider, mapCCReachResponse } from '../lib/index.js'

// Always anonymous; never read a real credential or execute any returned capability.
const options = { resolveApiKey: async () => undefined }
const signal = AbortSignal.timeout(20000)
const client = new CCReachClient(options)
const meta = await client.health(signal)
const raw = await client.search('weather', 1, signal)
const mapped = mapCCReachResponse(raw, 1)
assert.equal(new CCReachSearchProvider(options).available(), true)
assert.ok(mapped.sources.length <= 1)
assert.equal(Object.hasOwn(mapped, 'content'), false)
assert.equal(meta.retrieval.method, 'hybrid')
await writeFile('examples/ccreach-response.json', JSON.stringify(raw, null, 2) + '\n')
await writeFile('examples/mapped-result.json', JSON.stringify(mapped, null, 2) + '\n')
console.log(JSON.stringify({ health: 'passed', anonymous: true, query: raw.query, returned: mapped.sources.length, contentOmitted: true }))
