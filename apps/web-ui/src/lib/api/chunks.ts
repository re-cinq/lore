import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";

// The context browser's chunk reads. Chunks live in per-team schemas plus
// `org_shared`, and the UNION ALL across them moved to lore-api along with the
// schema catalog it depends on — which is what let web-ui stop holding a pool.

export interface ChunkRow {
  id: string;
  file_path?: string;
  content_type: string;
  repo: string | null;
  metadata: Record<string, unknown> | null;
  content: string;
  ingested_at?: string;
  rank?: number;
}

/** Ranked chunks: org-wide across every schema, or one repo's own. Returns one
 *  row past `limit` so the caller can detect a further page without a COUNT. */
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

/** The content types actually present — the chip set, deliberately unfiltered
 *  by the active type so a chip never vanishes when selected. */
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

/** A repo's chunk count and which convention files it holds — the two figures
 *  the repo overview's enrollment checklist needs. */
export function getRepoChunkSummary(
  repo: string,
): Promise<ApiResult<{ count: number; convention_files: string[] }>> {
  return apiFetch("lore-api", `/api/repos/${repo}/chunk-summary`);
}
