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

/** POST incremental CI delta ingest; state advances by CAS (base_commit is observed state). */

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
  /** "advanced" (pointer moved), "pending-chunks" (multi-part), "unrecorded" (unmigrated). */
  state: z.enum(["advanced", "pending-chunks", "unrecorded"]),
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
      projectSpecFile({ repo, filePath: path, content }, must()),
    projectAdr: (repo, path, content) =>
      projectAdrFile({ repo, filePath: path, content }, must()),
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

async function applyTestReportDelta(
  deps: IngestDeltaDeps,
  repo: string,
  body: IngestDeltaBody,
): Promise<{ testChunks: number; prunedTestFiles: number }> {
  let testChunks = 0;
  let prunedTestFiles = 0;

  if (body.report !== undefined) {
    testChunks = (await deps.ingestReport(repo, body.report)).testChunks;
  }

  if (body.deleted?.length) {
    await deps.pruneTests(repo, body.deleted);
    prunedTestFiles = body.deleted.length;
  }

  return { testChunks, prunedTestFiles };
}

async function applyDocDelta(
  deps: IngestDeltaDeps,
  repo: string,
  body: IngestDeltaBody,
): Promise<{ projected: number; deleted: number }> {
  const project = body.kind === "specs" ? deps.projectSpec : deps.projectAdr;
  const remove = body.kind === "specs" ? deps.deleteSpec : deps.deleteAdr;
  let projected = 0;
  let deleted = 0;

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

  return { projected, deleted };
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

      // Refuse stale base before projecting (race detection; CI must re-fetch and re-diff).
      const current = await storedCommit(pool, repo, body.kind);

      enforceTrue(
        current === body.base_commit,
        apiError(409, { current }),
        `stale base ${body.base_commit ?? "(none)"} — the stored commit has moved; re-fetch ingest-state and re-diff`,
      );

      let projected = 0;
      let deleted = 0;
      let testChunks = 0;
      let prunedTestFiles = 0;

      if (body.kind === "test-report") {
        ({ testChunks, prunedTestFiles } = await applyTestReportDelta(
          deps,
          repo,
          body,
        ));
      }

      if (body.kind !== "test-report") {
        ({ projected, deleted } = await applyDocDelta(deps, repo, body));
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

      // CAS advance; unmigrated state not failure (graph already absorbed delta).
      let rows: Array<{ commit_sha: string }>;

      try {
        rows = (
          await pool.query<{ commit_sha: string }>(
            `INSERT INTO pipeline.ingest_state (repo, kind, commit_sha)
             VALUES ($1, $2, $3)
             ON CONFLICT (repo, kind) DO UPDATE
               SET commit_sha = EXCLUDED.commit_sha, updated_at = now()
               WHERE pipeline.ingest_state.commit_sha IS NOT DISTINCT FROM $4
             RETURNING commit_sha`,
            [repo, body.kind, body.commit, body.base_commit],
          )
        ).rows;
      } catch (err) {
        if (!(
          err instanceof Error &&
          "code" in err &&
          err.code === UNDEFINED_TABLE
        )) {
          throw err;
        }

        return h.response({
          kind: body.kind,
          commit: body.commit,
          state: "unrecorded" as const,
          projected,
          deleted,
          test_chunks: testChunks,
          pruned_test_files: prunedTestFiles,
        });
      }

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
