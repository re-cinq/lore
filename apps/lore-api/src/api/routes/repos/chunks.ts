import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { z } from "zod";
import type { ServerRoute } from "@hapi/hapi";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

// Vector-store chunk reads for detection jobs, via `project.chunks` (not direct DB) so a station pod's ChunksHttp adapter never opens Postgres (ADR-031 D7); body shape varies by {kind}.
const CHUNK_KINDS = new Set([
  "spec",
  "code-symbols",
  "spec-ingest",
  "test-ranges",
  "spec-backfill",
  "code-backfill",
  "has",
  "stale",
]);

/** One route per chunk KIND; the body is whichever collection the kind names. */
const RepoChunksSchema = z.record(z.unknown());

type ChunksProject = Awaited<ReturnType<typeof projectFor>>["chunks"];
type ChunkQuery = Record<string, string | undefined>;

async function hasChunkResult(chunks: ChunksProject, q: ChunkQuery) {
  const contentType = q.content_type;

  enforceTrue(contentType, apiError(400), "content_type required");

  return { has: await chunks.hasChunk(contentType, q.file_suffix) };
}

async function staleChunkResult(chunks: ChunksProject, q: ChunkQuery) {
  const days = Number(q.days ?? "90");

  return { count: await chunks.staleChunkCount(days) };
}

const CHUNK_COLLECTION_BY_KIND: Record<
  string,
  (chunks: ChunksProject, q: ChunkQuery) => Promise<Record<string, unknown>>
> = {
  spec: async (chunks) => ({ specs: await chunks.specChunks() }),
  "code-symbols": async (chunks) => ({
    symbols: await chunks.codeSymbols(),
  }),
  "spec-ingest": async (chunks) => ({
    specs: await chunks.specChunksWithIngest(),
  }),
  "test-ranges": async (chunks) => ({
    ranges: await chunks.testChunkRanges(),
  }),
  "spec-backfill": async (chunks) => ({
    specs: await chunks.specChunksForBackfill(),
  }),
  "code-backfill": async (chunks) => ({
    chunks: await chunks.codeChunksForBackfill(),
  }),
  has: hasChunkResult,
};

async function chunkCollection(
  kind: string,
  chunks: ChunksProject,
  q: ChunkQuery,
): Promise<Record<string, unknown>> {
  const resolve = CHUNK_COLLECTION_BY_KIND[kind] ?? staleChunkResult;

  return resolve(chunks, q);
}

export function chunksRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/chunks/{kind}",
    options: zodResponse(bearerScope("read"), RepoChunksSchema, {
      name: "RepoChunks",
      description: "A chunk collection, shaped by {kind}",
      errors: [400],
    }),
    handler: async (request, h) => {
      const kind = request.params.kind;

      enforceTrue(CHUNK_KINDS.has(kind), apiError(404), "not found");
      const q = request.query as Record<string, string | undefined>;

      try {
        const chunks = (
          await projectFor(`${request.params.owner}/${request.params.repo}`)
        ).chunks;

        return h.response(await chunkCollection(kind, chunks, q));
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        return h
          .response({ error: err instanceof Error ? err.message : String(err) })
          .code(500);
      }
    },
  };
}
