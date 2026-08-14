import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";

// The memory browse reads, typed once. Each was a direct SELECT in a page body
// before lore-api grew the endpoints (ADR-032). Shaped per screen: the graph
// explorer's four reads arrive together because one page renders all four.

export function getGraphBrowse(opts: {
  entity?: string;
  type?: string;
  showInvalid?: boolean;
}): Promise<
  ApiResult<{
    stats: Record<string, number>;
    entity_types: { entity_type: string; cnt: number }[];
    entities: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  }>
> {
  const params = new URLSearchParams();

  if (opts.entity) {
    params.set("entity", opts.entity);
  }

  if (opts.type) {
    params.set("type", opts.type);
  }

  if (opts.showInvalid) {
    params.set("show_invalid", "true");
  }

  return apiFetch("lore-api", `/api/graph-browse?${params}`);
}

export function listPools(): Promise<
  ApiResult<{ pools: Record<string, unknown>[] }>
> {
  return apiFetch("lore-api", "/api/pools");
}

/** A pool and its entries. A name no pool holds is a 404 result, which the page
 *  renders as its own "not found" state rather than a crash. */
export function getPool(name: string): Promise<
  ApiResult<{
    pool: Record<string, unknown>;
    entries: Record<string, unknown>[];
  }>
> {
  return apiFetch("lore-api", `/api/pools/${encodeURIComponent(name)}`);
}

export function listEpisodes(opts: {
  source?: string;
  agent?: string;
  limit?: number;
  offset?: number;
}): Promise<ApiResult<{ episodes: Record<string, unknown>[]; total: number }>> {
  const params = new URLSearchParams();

  if (opts.source) {
    params.set("source", opts.source);
  }

  if (opts.agent) {
    params.set("agent", opts.agent);
  }
  params.set("limit", String(opts.limit ?? 50));
  params.set("offset", String(opts.offset ?? 0));

  return apiFetch("lore-api", `/api/episodes?${params}`);
}

/** An agent's live memories, each with its version history and extracted facts. */
export function listMemories(
  agent: string,
  limit = 100,
): Promise<ApiResult<{ memories: Record<string, unknown>[] }>> {
  const params = new URLSearchParams({
    agent,
    limit: String(limit),
  });

  return apiFetch("lore-api", `/api/memories?${params}`);
}

/** The search page's lexical hits across memories and facts, ranked. Distinct
 *  from `lore_search_memory`, which is the embedding search. */
export function searchMemory(
  q: string,
): Promise<ApiResult<{ results: Record<string, unknown>[] }>> {
  return apiFetch("lore-api", `/api/memory-search?q=${encodeURIComponent(q)}`);
}
