import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";

// Memory browse reads, typed once — were direct SELECTs before lore-api grew these endpoints (ADR-032); shaped per screen.
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

/** A pool and its entries; a name no pool holds is a 404 result the page renders as "not found" rather than a crash. */
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

/** Search page's lexical hits across memories/facts, ranked — distinct from `lore_search_memory`'s embedding search. */
export function searchMemory(
  q: string,
): Promise<ApiResult<{ results: Record<string, unknown>[] }>> {
  return apiFetch("lore-api", `/api/memory-search?q=${encodeURIComponent(q)}`);
}
