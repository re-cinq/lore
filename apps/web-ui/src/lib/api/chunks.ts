import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// Context browser's chunk reads; the UNION ALL across per-team schemas + org_shared moved to lore-api, which is what let web-ui stop holding a pool. ChunkRow aliases the OpenAPI schema (ADR-035) — content is a 300-char preview, rank computed per query.
export type ChunkRow = components["schemas"]["ChunkList"]["chunks"][number];

/** Ranked chunks (org-wide or one repo's own); returns one row past `limit` so the caller can detect a further page without a COUNT. */
export function getChunks(opts: {
  repo?: string;
  type?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<ApiResult<{ chunks: ChunkRow[] }>> {
  const params = new URLSearchParams();

  if (opts.repo) {
    params.set("repo", opts.repo);
  }

  if (opts.type) {
    params.set("type", opts.type);
  }

  if (opts.q) {
    params.set("q", opts.q);
  }
  params.set("limit", String(opts.limit ?? 50));
  params.set("offset", String(opts.offset ?? 0));

  return apiFetch("lore-api", `/api/chunks?${params}`);
}

/** Content types actually present — deliberately unfiltered by the active type so a chip never vanishes when selected. */
export function getChunkTypes(
  repo?: string,
): Promise<ApiResult<{ types: string[] }>> {
  return apiFetch(
    "lore-api",
    repo
      ? `/api/chunk-types?repo=${encodeURIComponent(repo)}`
      : "/api/chunk-types",
  );
}

/** Every chunk of one file path. Org-wide this spans repos; the caller groups. */
export function getChunksByPath(
  path: string,
  repo?: string,
): Promise<ApiResult<{ chunks: ChunkRow[] }>> {
  const params = new URLSearchParams({ path });

  if (repo) {
    params.set("repo", repo);
  }

  return apiFetch("lore-api", `/api/chunks/by-path?${params}`);
}

/** A repo's chunk count and which convention files it holds — what the overview's enrollment checklist needs. */
export function getRepoChunkSummary(
  repo: string,
): Promise<ApiResult<{ count: number; convention_files: string[] }>> {
  return apiFetch("lore-api", `/api/repos/${repo}/chunk-summary`);
}
