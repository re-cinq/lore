import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { z } from "zod";
import type { ServerRoute } from "@hapi/hapi";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

/**
 * GET /api/repos/:owner/:repo/chunks/{kind} — the vector-store chunk reads the
 * detection jobs need, served through `project.chunks` (the shared Project
 * facade, NOT direct DB queries). A station pod's ChunksHttp adapter calls this
 * so it never opens a Postgres connection (ADR-031 D7). Repo-scoped; the server
 * resolves the team schema (else org_shared) exactly as the Floor would.
 *
 *   spec           → { specs: SpecChunkRow[] }
 *   code-symbols   → { symbols: CodeSymbolRow[] }
 *   spec-ingest    → { specs: SpecChunkWithIngest[] }
 *   test-ranges    → { ranges: TestChunkRange[] }
 *   spec-backfill  → { specs: SpecChunkWithEmbedding[] }
 *   code-backfill  → { chunks: CodeChunkFull[] }
 *   has?content_type=&file_suffix=  → { has: boolean }
 *   stale?days=    → { count: number }
 */
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

        switch (kind) {
          case "spec":
            return h.response({ specs: await chunks.specChunks() });
          case "code-symbols":
            return h.response({ symbols: await chunks.codeSymbols() });
          case "spec-ingest":
            return h.response({ specs: await chunks.specChunksWithIngest() });
          case "test-ranges":
            return h.response({ ranges: await chunks.testChunkRanges() });
          case "spec-backfill":
            return h.response({ specs: await chunks.specChunksForBackfill() });
          case "code-backfill":
            return h.response({ chunks: await chunks.codeChunksForBackfill() });
          case "has": {
            const contentType = q.content_type;

            enforceTrue(contentType, apiError(400), "content_type required");

            return h.response({
              has: await chunks.hasChunk(contentType, q.file_suffix),
            });
          }
          default: {
            // stale
            const days = Number(q.days ?? "90");

            return h.response({ count: await chunks.staleChunkCount(days) });
          }
        }
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure
        // is this block's to shape.
        rethrowBoom(err);

        return h
          .response({ error: err instanceof Error ? err.message : String(err) })
          .code(500);
      }
    },
  };
}
