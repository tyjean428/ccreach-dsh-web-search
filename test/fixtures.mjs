/** Includes every listed resource key (the supplied list enumerates 25, labeled 26). */
export function resource(overrides = {}) {
  return {
    id: 'weather-tool', name: 'Weather API', summary: 'Forecast capability for agents.',
    resource_kind: 'tool', category_ids: ['data'], protocols: ['http', 'mcp'],
    executable: true, auth_status: 'unknown', aliases: ['forecast'], tags: ['weather'],
    tasks: ['forecast'], cost: { status: 'free_tier', details: 'Quota applies.', evidence: [] },
    sources: [{ url: 'https://provider.example/source', title: 'Weather documentation', checked_at: '2026-10-07', valid_until: null, verified_scope: 'documentation' }],
    verification: { availability_tested: false, execution_tested: false, human_reviewed: false, status: 'provider_declared' },
    access: { docs_url: 'https://provider.example/docs', endpoint: 'https://provider.example/api' },
    admission: { status: 'admitted' }, field_evidence: [], page_role: 'documentation',
    parser_version: 'example.1', raw_content_hash: 'a'.repeat(64), rank_in_kind: 1,
    matched_terms: ['weather'], reasons: ['Task match'], missing_conditions: ['Authentication needs confirmation'],
    retrieval_evidence: { similarity_is_confidence: false }, ...overrides,
  }
}

export function response(results = [resource()]) {
  return {
    query: 'weather', total: results.length, returned: results.length, results,
    page: 1, page_size: 12, total_pages: 1, has_previous: false, has_next: false,
    result_set_id: 'b'.repeat(64), catalog_version: 'sample.1', snapshot_id: 'c'.repeat(64),
    data_version: 'c'.repeat(64), ranking_version: 'hybrid.1',
    retrieval: { method: 'hybrid', status: 'ready' }, notice: 'Unknown cost is not free.',
    applied_constraints: {}, filters: { category: 'all', kind: 'all', protocol: 'all', free_only: false, executable_only: false },
  }
}

export const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
