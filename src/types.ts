/** CCReach wire vocabulary, based solely on the supplied, measured API. */
export type CCReachCategory = 'all' | 'information' | 'data' | 'development' | 'office' | 'media' | 'automation' | 'research' | 'agents'
export type CCReachKind = 'document' | 'data_source' | 'tool' | 'agent' | 'skill' | 'workflow'
export type CCReachProtocol = 'web' | 'http' | 'mcp' | 'a2a' | 'local'

export interface CCReachFilters {
  category?: CCReachCategory
  kind?: 'all' | CCReachKind
  protocol?: 'all' | CCReachProtocol
  free_only?: boolean
  executable_only?: boolean
  /** Current Harness requests have no pagination members, so these are config defaults. */
  page?: number
  snapshot_id?: string | null
  result_set_id?: string | null
}

export interface CCReachSource {
  url?: string | null
  title?: string
  checked_at?: string | null
  valid_until?: string | null
  verified_scope?: string
}

/** Ranking members are optional because the detail endpoint does not return them. */
export interface CCReachResource {
  id: string
  name: string
  summary: string
  resource_kind: CCReachKind
  category_ids: string[]
  protocols: CCReachProtocol[]
  executable: boolean
  auth_status: 'public' | 'unknown'
  aliases: string[]
  tags: string[]
  tasks: string[]
  cost: { status: string; details?: string; evidence?: unknown[] }
  sources: CCReachSource[]
  verification: {
    availability_tested?: boolean
    execution_tested?: boolean
    human_reviewed?: boolean
    status?: string
  }
  access: { docs_url?: string | null; endpoint?: string | null }
  admission?: unknown
  field_evidence?: unknown[]
  page_role?: string | null
  parser_version?: string | null
  raw_content_hash?: string | null
  rank_in_kind?: number
  matched_terms?: string[]
  reasons?: string[]
  missing_conditions?: string[]
  retrieval_evidence?: unknown
}

export interface CCReachSearchResponse {
  query: string
  total: number
  returned: number
  results: CCReachResource[]
  page: number
  page_size: number
  total_pages: number
  has_previous: boolean
  has_next: boolean
  result_set_id: string | null
  catalog_version: string
  snapshot_id: string | null
  data_version: string
  ranking_version: string
  retrieval: { method: string; status: string; [key: string]: unknown }
  notice: string
  applied_constraints: Record<string, unknown>
  filters: CCReachFilters
}

export interface CCReachMeta {
  categories: { id: string; label?: string; count?: number }[]
  kinds: { id: string; label?: string; count?: number }[]
  protocols: { id: string; label?: string; count?: number }[]
  counts: { resources: number }
  catalog_version: string
  snapshot_id: string
  retrieval: { method: string; status: string; [key: string]: unknown }
}
