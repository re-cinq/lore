// Layer-3 handlers for the detection-family `cron.<job>.tick` events: fans out one assembly-line start per target repo across every provisioned chunk schema; idempotent + overlap-guarded, so a mid-loop retry is safe (specs/scheduled-job-runtime-split for the manual-trigger SQL).

import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { detectSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
import type { EventHandler } from "../../main-loop/types.js";
import { query } from "../../kernel/db.js";
import { pipeline, settings } from "../../kernel/queues.js";

/** Synthetic ref — detect nodes read through the API and clone nothing. No longer the overlap-guard key ({@link detectSubject} is). */
export function detectBranchName(blueprintName: string, repo: string): string {
  return `detect/${blueprintName}/${repo}`;
}

/** The definition's detect node's job_ref — the job-run name prefix. */
async function builtinJobRef(blueprintName: string): Promise<string> {
  const definition = (await loadBuiltinAssemblyLines()).get(blueprintName);
  const detectNode = definition?.nodes.find((n) => n.type === "detect");

  enforceTrue(
    typeof detectNode?.job_ref === "string" && detectNode.job_ref.length > 0,
    Error,
    `assembly line "${blueprintName}" has no detect node with job_ref`,
  );

  return detectNode.job_ref;
}

/** Days since the last code-chunk ingest for a repo to count as active. */
const ACTIVITY_WINDOW_DAYS = 7;

/** Injection gate for schema names interpolated into UNION ALL SQL. */
const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;

const CHUNK_SCHEMAS_SQL = `
  SELECT table_schema
  FROM information_schema.tables
  WHERE table_name = 'chunks'
    AND table_schema IN (SELECT team FROM lore.repos WHERE team IS NOT NULL)`;

type QueryFn = <T>(text: string, params?: unknown[]) => Promise<T[]>;

/** Every provisioned chunk schema (team schemas ∪ org_shared), RE-validated. */
export async function chunkSchemas(q: QueryFn = query): Promise<string[]> {
  const rows = await q<{ table_schema: string }>(CHUNK_SCHEMAS_SQL);
  const teamSchemas = rows
    .map((r) => r.table_schema)
    .filter((s) => SCHEMA_RE.test(s));

  return [...new Set(["org_shared", ...teamSchemas])];
}

/** UNION ALL over chunk schemas; activeOnly filters to activity window ($1 in days). */
export function specReposSql(
  schemas: string[],
  opts: { activeOnly: boolean },
): string {
  const safeSchemas = schemas.filter((s) => SCHEMA_RE.test(s));

  enforceTrue(
    safeSchemas.length > 0,
    Error,
    "specReposSql needs at least one valid chunk schema",
  );

  const chunkFilter = opts.activeOnly
    ? `content_type IN ('spec', 'code')`
    : `content_type = 'spec'`;
  const union = safeSchemas
    .map(
      (s) =>
        `SELECT repo, content_type, ingested_at FROM ${s}.chunks WHERE ${chunkFilter}`,
    )
    .join("\n    UNION ALL\n    ");
  const activityGate = opts.activeOnly
    ? `
  HAVING bool_or(content_type = 'spec')
    AND bool_or(content_type = 'code' AND ingested_at > now() - ($1 || ' days')::interval)`
    : "";

  return `
  SELECT repo FROM (
    ${union}
  ) c
  WHERE repo IS NOT NULL
  GROUP BY repo${activityGate}
  ORDER BY repo`;
}

export const activeSpecRepos = async (
  q: QueryFn = query,
): Promise<string[]> => {
  const schemas = await chunkSchemas(q);
  const rows = await q<{ repo: string }>(
    specReposSql(schemas, { activeOnly: true }),
    [String(ACTIVITY_WINDOW_DAYS)],
  );

  return rows.map((r) => r.repo);
};

export const specRepos = async (q: QueryFn = query): Promise<string[]> => {
  const schemas = await chunkSchemas(q);
  const rows = await q<{ repo: string }>(
    specReposSql(schemas, { activeOnly: false }),
  );

  return rows.map((r) => r.repo);
};

/** Through the shared settings port, not a second copy of its SELECT — "onboarded" belongs in one place. Sorted here since the port makes no ordering promise. */
const onboardedRepos = async (): Promise<string[]> =>
  (await settings().onboardedRepos()).map((repo) => repo.full_name).sort();

export interface DetectFanOutDeps {
  assemblyRuns: AssemblyRunsPort;
  /** Pre-create the `<job_ref>:<repo>` job_runs row; the walk closes it via `args.job_run_id` at a terminal state. */
  jobRuns: {
    start(jobName: string): Promise<string>;
    fail(runId: string, reason: string): Promise<unknown>;
  };
  jobRef: () => Promise<string>;
  listTargetRepos: () => Promise<string[]>;
}

async function resolveTargetRepos(
  params: Record<string, unknown>,
  deps: DetectFanOutDeps,
): Promise<string[]> {
  return typeof params.repo === "string" && params.repo.length > 0
    ? [params.repo]
    : deps.listTargetRepos();
}

/** Starts (or joins) the detect run for one repo; never throws for a "superseded" join, only for a genuine `assembly_line.start` failure. */
async function processDetectRepo(
  blueprintName: string,
  repo: string,
  jobRef: string,
  deps: DetectFanOutDeps,
): Promise<void> {
  // Asked BEFORE the job_run is minted — one created for already-running work has no owner to close it (no job_runs reaper).
  const inFlight = await deps.assemblyRuns.findOpenBySubject(
    repo,
    detectSubject(blueprintName, repo),
  );

  if (inFlight) {
    console.log(
      `[detect] ${blueprintName}: ${repo} already running as ${inFlight.id}, skipping`,
    );

    return;
  }
  const jobRunId = await deps.jobRuns.start(`${jobRef}:${repo}`);

  // start() throwing mid-loop would orphan the job_run (no reaper) — fail it before rethrowing so the retry settles cleanly.
  let id: string;

  try {
    id = await deps.assemblyRuns.start({
      blueprintName,
      repo,
      branch: detectBranchName(blueprintName, repo),
      subjectKey: detectSubject(blueprintName, repo),
      args: { job_run_id: jobRunId },
    });
  } catch (err) {
    await deps.jobRuns
      .fail(jobRunId, `assembly_line.start failed: ${(err as Error).message}`)
      .catch(() => {});
    throw err;
  }

  // The race: two ticks can both read "nothing in flight"; the loser's start() JOINS the winner's run — a job_run_id mismatch IS the join.
  const startedRun = await deps.assemblyRuns.getById(id);

  if (startedRun && startedRun.args.job_run_id !== jobRunId) {
    await deps.jobRuns
      .fail(jobRunId, `superseded — ${repo} is already running as ${id}`)
      .catch(() => {});
    console.log(
      `[detect] ${blueprintName}: ${repo} joined ${id}; job_run ${jobRunId} closed`,
    );

    return;
  }

  console.log(
    `[detect] ${blueprintName}: started assembly line ${id} for ${repo}`,
  );
}

export function createDetectTickHandler(
  blueprintName: string,
  deps: DetectFanOutDeps,
): EventHandler {
  return async (params) => {
    const repos = await resolveTargetRepos(params, deps);

    if (repos.length === 0) {
      console.log(
        `[detect] ${blueprintName}: no target repos, nothing to start`,
      );

      return;
    }

    const jobRef = await deps.jobRef();

    for (const repo of repos) {
      await processDetectRepo(blueprintName, repo, jobRef, deps);
    }
  };
}

const productionTick =
  (
    blueprintName: string,
    listTargetRepos: () => Promise<string[]>,
  ): EventHandler =>
  (params) =>
    createDetectTickHandler(blueprintName, {
      assemblyRuns: pipeline().assemblyRuns,
      jobRuns: pipeline().jobRuns,
      jobRef: () => builtinJobRef(blueprintName),
      listTargetRepos,
    })(params);

// Composed production handlers, one per detection tick (registry layer 3).
export const specDriftTick = productionTick("spec-drift", activeSpecRepos);

export const gapDetectionTick = productionTick("gap-detect", onboardedRepos);

export const specCoverageValidateTick = productionTick(
  "spec-coverage-validate",
  specRepos,
);
