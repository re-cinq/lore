import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { z } from "zod";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { bearerScope } from "../../http/bearer-scope.js";
import { INGEST_DELTA_KINDS } from "./ingest-kinds.js";
import { defaultDeps, type IngestDeltaDeps } from "./ingest-delta-deps.js";
import {
  advanceStoredCommit,
  storedCommit,
  type DeltaCommit,
} from "./ingest-delta-state.js";
import { withPool } from "../with-pool.js";

export type { IngestDeltaDeps } from "./ingest-delta-deps.js";

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

// eslint-disable-next-line re-lint/declare-near-use -- response schema belongs beside the request schema it answers
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

/** The CAS input this delta carries, named the way the state store reads it. */
function deltaCommit(repo: string, body: IngestDeltaBody): DeltaCommit {
  return {
    repo,
    kind: body.kind,
    commit: body.commit,
    baseCommit: body.base_commit,
  };
}

async function applyTestReportDelta(
  deps: IngestDeltaDeps,
  repo: string,
  body: IngestDeltaBody,
): Promise<{ test_chunks: number; pruned_test_files: number }> {
  let testChunks = 0;
  let prunedTestFiles = 0;

  if (body.report !== undefined) {
    testChunks = (await deps.ingestReport(repo, body.report)).testChunks;
  }

  if (body.deleted?.length) {
    await deps.pruneTests(repo, body.deleted);
    prunedTestFiles = body.deleted.length;
  }

  return { test_chunks: testChunks, pruned_test_files: prunedTestFiles };
}

function docFunctions(
  deps: IngestDeltaDeps,
  kind: string,
): {
  project: IngestDeltaDeps["projectSpec"];
  remove: IngestDeltaDeps["deleteSpec"];
} {
  return kind === "specs"
    ? { project: deps.projectSpec, remove: deps.deleteSpec }
    : { project: deps.projectAdr, remove: deps.deleteAdr };
}

async function projectFiles(
  project: IngestDeltaDeps["projectSpec"],
  repo: string,
  files: IngestDeltaBody["files"],
): Promise<number> {
  let projected = 0;

  for (const file of files ?? []) {
    const outcome = await project(repo, file.path, file.content);

    if (outcome.projected) {
      projected += 1;
    }
  }

  return projected;
}

async function removeFiles(
  remove: IngestDeltaDeps["deleteSpec"],
  repo: string,
  paths: IngestDeltaBody["deleted"],
): Promise<number> {
  for (const path of paths ?? []) {
    await remove(repo, path);
  }

  return paths?.length ?? 0;
}

async function applyDocDelta(
  deps: IngestDeltaDeps,
  repo: string,
  body: IngestDeltaBody,
): Promise<{ projected: number; deleted: number }> {
  const { project, remove } = docFunctions(deps, body.kind);
  const projected = await projectFiles(project, repo, body.files);
  const deleted = await removeFiles(remove, repo, body.deleted);

  return { projected, deleted };
}

const INGEST_DELTA_OPTIONS = zodResponse(
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
);

/** A kind this deployment can actually project, into a graph store that exists. */
function assertDeltaSupported(deps: IngestDeltaDeps, kind: string): void {
  enforceTrue(
    INGEST_DELTA_KINDS.has(kind),
    apiError(400),
    `unknown kind "${kind}" — expected one of ${[...INGEST_DELTA_KINDS].join(", ")}`,
  );
  enforceTrue(
    deps.dgraph(),
    apiError(503),
    "no graph store configured — LORE_DGRAPH_HTTP is unset on this deployment",
  );
}

/** Every reason to refuse a delta BEFORE projecting any of it. The stale-base check is the race detection: two CI runs diffing the same base would each project against a commit the other has moved past, so the loser must re-fetch and re-diff. */
async function assertDeltaAcceptable(
  pool: Pool,
  deps: IngestDeltaDeps,
  repo: string,
  body: IngestDeltaBody,
): Promise<void> {
  assertDeltaSupported(deps, body.kind);

  const current = await storedCommit(pool, repo, body.kind);

  enforceTrue(
    current === body.base_commit,
    apiError(409, { current }),
    `stale base ${body.base_commit ?? "(none)"} — the stored commit has moved; re-fetch ingest-state and re-diff`,
  );
}

/** Whether this body completes its upload — an absent envelope is one part of one. */
function isFinalChunk(body: IngestDeltaBody): boolean {
  return (
    body.seq === undefined || body.total === undefined || body.seq >= body.total
  );
}

/** What this delta did to the STORED commit, once its chunks have been projected. A partial upload projects its share but must NOT advance the commit — the next chunk still needs the same base — and an unmigrated `ingest_state` is not a failure either, because the graph has already absorbed the delta. Only a commit that moved under us is a conflict. */
async function settleDelta(
  pool: Pool,
  repo: string,
  body: IngestDeltaBody,
): Promise<"pending-chunks" | "unrecorded" | "advanced"> {
  if (!isFinalChunk(body)) {
    return "pending-chunks";
  }
  const advanced = await advanceStoredCommit(pool, deltaCommit(repo, body));

  if (advanced === "unrecorded") {
    return "unrecorded";
  }

  enforceTrue(
    advanced,
    apiError(409, { current: await storedCommit(pool, repo, body.kind) }),
    "the stored commit moved during projection — re-fetch ingest-state and re-diff",
  );

  return "advanced";
}

/** Project one delta into the graph. A test report and a doc delta touch different parts of it, so each reports its own counts and leaves the other's at zero. */
async function applyDelta(
  deps: IngestDeltaDeps,
  repo: string,
  body: IngestDeltaBody,
): Promise<{
  projected: number;
  deleted: number;
  test_chunks: number;
  pruned_test_files: number;
}> {
  if (body.kind === "test-report") {
    const counts = await applyTestReportDelta(deps, repo, body);

    return { projected: 0, deleted: 0, ...counts };
  }
  const { projected, deleted } = await applyDocDelta(deps, repo, body);

  return { projected, deleted, test_chunks: 0, pruned_test_files: 0 };
}

/** Guard, project, then settle the stored pointer — in that order, so a refused delta writes nothing. */
async function serveIngestDelta(
  pool: Pool,
  deps: IngestDeltaDeps,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const body = request.payload as IngestDeltaBody;
  const repo = `${request.params.owner}/${request.params.repo}`;

  await assertDeltaAcceptable(pool, deps, repo, body);

  const counts = await applyDelta(deps, repo, body);

  return h.response({
    kind: body.kind,
    commit: body.commit,
    state: await settleDelta(pool, repo, body),
    ...counts,
  });
}

export function ingestDeltaRoute(
  getPool: () => Pool | null,
  deps: IngestDeltaDeps = defaultDeps(),
): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/ingest",
    options: INGEST_DELTA_OPTIONS,
    handler: withPool(getPool, (pool, request, h) =>
      serveIngestDelta(pool, deps, request, h),
    ),
  };
}
