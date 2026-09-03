import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { z } from "zod";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import {
  createDgraphClient,
  ingestSpecTrace,
  projectAdrFile,
  projectSpecFile,
  deleteSpecSubtree,
  deleteAdrSubtree,
  pruneTestFiles,
  type SpecTraceOutcome,
  type DgraphClientPort,
} from "@re-cinq/lore-shared";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { INGEST_DELTA_KINDS } from "./ingest-kinds.js";

/**
 * `POST /api/repos/{owner}/{repo}/ingest` — the incremental CI ingest sink
 * (specs/ci-incremental-ingest FR3). CI fetched the last-ingested commit
 * (`GET …/ingest-state`), diffed against it, and posts only the DELTA as
 * JSON: changed doc contents for `specs`/`adrs`, an incremental test report
 * for `test-report`, and the deleted paths for either. The projection happens
 * HERE, in-process against the graph store — no event, no pod, no clone: the
 * runner already had the working tree and this process already has the
 * dgraph egress and the Vertex embed path.
 *
 * State advances by COMPARE-AND-SET: the update lands only while the stored
 * commit still equals the posted `base_commit`, so two merges racing cannot
 * silently skip one delta — the loser gets a 409 naming the current commit
 * and re-diffs. The check runs before projection (cheap refusal) and the
 * advance after it (a failed projection must not move the pointer past work
 * that never landed); projection itself is idempotent xid upserts, so the
 * losing side of the rare mid-flight race redoes harmless work.
 *
 * `base_commit` is the OBSERVED state — exactly what `GET …/ingest-state`
 * returned — never merely "what I diffed from". A full ingest is the same
 * POST (sent in `{seq, total}` chunks when large; the state advances only
 * with the final chunk): with `base_commit: null` when no state was
 * recorded, and with the observed commit when the state exists but is
 * unreachable in the runner's history (force-pushed main). Posting null
 * against a recorded state would 409 on every retry — a deadlock, since
 * re-fetching returns the same unreachable commit forever.
 */

const SHA = /^[0-9a-f]{7,40}$/;

const IngestDeltaBody = z.object({
  kind: z.string(),
  commit: z.string().regex(SHA, "commit must be a hex sha"),
  base_commit: z.string().regex(SHA).nullable(),
  /** Chunk envelope for a payload too large for one body; absent = 1 of 1. */
  seq: z.number().int().min(1).optional(),
  total: z.number().int().min(1).optional(),
  /** Changed doc files, content inline — the runner has the tree. */
  files: z
    .array(z.object({ path: z.string(), content: z.string() }))
    .optional(),
  /** Paths deleted (or renamed away) since base_commit. */
  deleted: z.array(z.string()).optional(),
  /** The incremental test report (`test-report` kind only). */
  report: z.unknown().optional(),
});

type IngestDeltaBody = z.infer<typeof IngestDeltaBody>;

const IngestDeltaResultSchema = z.object({
  kind: z.string(),
  commit: z.string(),
  /** `advanced` once the state pointer moved; `pending-chunks` while earlier
   *  chunks of a multi-part ingest are still being posted. */
  state: z.enum(["advanced", "pending-chunks"]),
  projected: z.number(),
  deleted: z.number(),
  test_chunks: z.number(),
  pruned_test_files: z.number(),
});

export interface IngestDeltaDeps {
  /** Availability gate + the client the default projectors close over. */
  dgraph(): DgraphClientPort | null;
  projectSpec(
    repo: string,
    path: string,
    content: string,
  ): Promise<{ projected: boolean }>;
  projectAdr(
    repo: string,
    path: string,
    content: string,
  ): Promise<{ projected: boolean }>;
  deleteSpec(repo: string, path: string): Promise<void>;
  deleteAdr(repo: string, path: string): Promise<void>;
  ingestReport(repo: string, payload: unknown): Promise<SpecTraceOutcome>;
  pruneTests(repo: string, files: string[]): Promise<{ prunedChunks: number }>;
}

const defaultDeps = (): IngestDeltaDeps => {
  let client: DgraphClientPort | null | undefined;
  const dgraph = () =>
    client === undefined ? (client = createDgraphClient()) : client;
  const must = (): DgraphClientPort => {
    const c = dgraph();

    enforceTrue(c, Error, "ingest-delta: no dgraph client");

    return c!;
  };

  return {
    dgraph,
    projectSpec: (repo, path, content) =>
      projectSpecFile(repo, path, content, must()),
    projectAdr: (repo, path, content) =>
      projectAdrFile(repo, path, content, must()),
    deleteSpec: (repo, path) => deleteSpecSubtree(must(), repo, path),
    deleteAdr: (repo, path) => deleteAdrSubtree(must(), repo, path),
    ingestReport: (repo, payload) =>
      ingestSpecTrace(must(), repo, "test-report", payload),
    pruneTests: (repo, files) => pruneTestFiles(must(), repo, files),
  };
};

const UNDEFINED_TABLE = "42P01";

/** The stored commit, with a pre-migration cluster reading as "no state". */
async function storedCommit(
  pool: Pool,
  repo: string,
  kind: string,
): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ commit_sha: string }>(
      `SELECT commit_sha FROM pipeline.ingest_state
        WHERE repo = $1 AND kind = $2`,
      [repo, kind],
    );

    return rows[0]?.commit_sha ?? null;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === UNDEFINED_TABLE) {
      return null;
    }

    throw err;
  }
}

export function ingestDeltaRoute(
  getPool: () => Pool | null,
  deps: IngestDeltaDeps = defaultDeps(),
): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/ingest",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(IngestDeltaBody) },
      },
      IngestDeltaResultSchema,
      {
        name: "IngestDeltaResult",
        description: "What one incremental ingest delta changed in the graph",
        errors: [400, 409],
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const body = request.payload as IngestDeltaBody;
      const repo = `${request.params.owner}/${request.params.repo}`;

      enforceTrue(
        INGEST_DELTA_KINDS.has(body.kind),
        apiError(400),
        `unknown kind "${body.kind}" — expected one of ${[...INGEST_DELTA_KINDS].join(", ")}`,
      );
      enforceTrue(
        deps.dgraph(),
        apiError(503),
        "no graph store configured — LORE_DGRAPH_HTTP is unset on this deployment",
      );
      const finalChunk =
        body.seq === undefined ||
        body.total === undefined ||
        body.seq >= body.total;

      // Refuse a stale base BEFORE projecting: two merges raced, this delta
      // was diffed from a commit the state has moved past, and applying it
      // could skip the other merge's changes forever. Only the final chunk
      // checks — earlier chunks' projection is idempotent either way.
      if (finalChunk) {
        const current = await storedCommit(pool, repo, body.kind);

        // Strict equality, null included: a null stored state under a
        // non-null claimed base means the recorded state is gone (fresh or
        // re-migrated cluster) and this delta may miss earlier changes — the
        // refusal makes CI re-fetch, see null, and send a full ingest.
        enforceTrue(
          current === body.base_commit,
          apiError(409, { current }),
          `stale base ${body.base_commit ?? "(none)"} — the stored commit has moved; re-fetch ingest-state and re-diff`,
        );
      }

      let projected = 0;
      let deleted = 0;
      let testChunks = 0;
      let prunedTestFiles = 0;

      if (body.kind === "test-report") {
        if (body.report !== undefined) {
          testChunks = (await deps.ingestReport(repo, body.report)).testChunks;
        }

        if (body.deleted?.length) {
          await deps.pruneTests(repo, body.deleted);
          prunedTestFiles = body.deleted.length;
        }
      }

      if (body.kind !== "test-report") {
        const project =
          body.kind === "specs" ? deps.projectSpec : deps.projectAdr;
        const remove = body.kind === "specs" ? deps.deleteSpec : deps.deleteAdr;

        for (const file of body.files ?? []) {
          const outcome = await project(repo, file.path, file.content);

          if (outcome.projected) {
            projected += 1;
          }
        }

        for (const path of body.deleted ?? []) {
          await remove(repo, path);
          deleted += 1;
        }
      }

      if (!finalChunk) {
        return h.response({
          kind: body.kind,
          commit: body.commit,
          state: "pending-chunks" as const,
          projected,
          deleted,
          test_chunks: testChunks,
          pruned_test_files: prunedTestFiles,
        });
      }

      // The advance is a compare-and-set, not a blind write: it lands only
      // while the stored commit still equals the base this delta diffed from.
      const { rows } = await pool.query<{ commit_sha: string }>(
        `INSERT INTO pipeline.ingest_state (repo, kind, commit_sha)
         VALUES ($1, $2, $3)
         ON CONFLICT (repo, kind) DO UPDATE
           SET commit_sha = EXCLUDED.commit_sha, updated_at = now()
           WHERE pipeline.ingest_state.commit_sha IS NOT DISTINCT FROM $4
         RETURNING commit_sha`,
        [repo, body.kind, body.commit, body.base_commit],
      );

      enforceTrue(
        rows.length > 0,
        apiError(409, { current: await storedCommit(pool, repo, body.kind) }),
        "the stored commit moved during projection — re-fetch ingest-state and re-diff",
      );

      return h.response({
        kind: body.kind,
        commit: body.commit,
        state: "advanced" as const,
        projected,
        deleted,
        test_chunks: testChunks,
        pruned_test_files: prunedTestFiles,
      });
    },
  };
}
