// Layer-3 handlers for the detection-family `cron.<job>.tick` events. A tick
// fans out one assembly-line start per target repo; targets are enumerated
// across every provisioned chunk schema (team schemas plus org_shared), since
// a repo's chunks live in its team schema when one is provisioned. Each start
// event is then claimed independently by the loop (per-repo retry +
// dead-letter), and the branch-keyed overlap guard in advanceLine defers
// concurrent duplicates (lease parity). A mid-loop failure lets the loop
// retry the whole tick — re-starting an already-started repo is acceptable
// because detection runs are idempotent and overlap-guarded.
//
// Manual trigger (documented in specs/scheduled-job-runtime-split):
//   INSERT INTO pipeline.events (event_name, source, params)
//   VALUES ('cron.spec_drift.tick', 'cron', '{"repo":"re-cinq/lore"}');
// Omit `repo` for the full fan-out.

import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { EventHandler } from "../../main-loop/types.js";
import { query } from "../../kernel/db.js";
import { assemblyLines, jobRuns } from "../../kernel/queues.js";

/** The old lease key, now the overlap-guard key (advanceLine defers duplicates). */
export function detectBranchName(definitionName: string, repo: string): string {
  return `detect/${definitionName}/${repo}`;
}

/** The definition's detect node's job_ref — the job-run name prefix. */
async function builtinJobRef(definitionName: string): Promise<string> {
  const definition = (await loadBuiltinAssemblyLines()).get(definitionName);
  const detectNode = definition?.nodes.find((n) => n.type === "detect");

  enforceTrue(
    typeof detectNode?.job_ref === "string" && detectNode.job_ref.length > 0,
    Error,
    `assembly line "${definitionName}" has no detect node with job_ref`,
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

/** One grouped UNION ALL over every chunk schema; activeOnly additionally
 *  requires a code chunk ingested inside the activity window ($1 in days). */
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

const ONBOARDED_REPOS_SQL = `
  SELECT full_name AS repo
  FROM lore.repos
  WHERE onboarding_pr_merged = true
  ORDER BY full_name`;

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

const onboardedRepos = async (): Promise<string[]> =>
  (await query<{ repo: string }>(ONBOARDED_REPOS_SQL)).map((r) => r.repo);

export interface DetectFanOutDeps {
  assemblyLines: AssemblyLinesPort;
  /** Pre-create the `<job_ref>:<repo>` pipeline.job_runs row; the walk closes it
   *  via `args.job_run_id` when the line reaches a terminal state. */
  jobRuns: {
    start(jobName: string): Promise<string>;
    fail(runId: string, reason: string): Promise<unknown>;
  };
  jobRef: () => Promise<string>;
  listTargetRepos: () => Promise<string[]>;
}

export function createDetectTickHandler(
  definitionName: string,
  deps: DetectFanOutDeps,
): EventHandler {
  return async (params) => {
    const repos =
      typeof params.repo === "string" && params.repo.length > 0
        ? [params.repo]
        : await deps.listTargetRepos();

    if (repos.length === 0) {
      console.log(
        `[detect] ${definitionName}: no target repos, nothing to start`,
      );

      return;
    }

    const jobRef = await deps.jobRef();

    for (const repo of repos) {
      const jobRunId = await deps.jobRuns.start(`${jobRef}:${repo}`);

      // start() throwing mid-loop (the case the header blesses for tick retry)
      // would orphan the just-created job_run open forever (no job_runs reaper) —
      // fail it before rethrowing so the retry's duplicate settles cleanly.
      let id: string;

      try {
        id = await deps.assemblyLines.start({
          definitionName,
          repo,
          branch: detectBranchName(definitionName, repo),
          args: { job_run_id: jobRunId },
        });
      } catch (err) {
        await deps.jobRuns
          .fail(
            jobRunId,
            `assembly_line.start failed: ${(err as Error).message}`,
          )
          .catch(() => {});
        throw err;
      }

      console.log(
        `[detect] ${definitionName}: started assembly line ${id} for ${repo}`,
      );
    }
  };
}

const productionTick =
  (
    definitionName: string,
    listTargetRepos: () => Promise<string[]>,
  ): EventHandler =>
  (params) =>
    createDetectTickHandler(definitionName, {
      assemblyLines: assemblyLines(),
      jobRuns: jobRuns(),
      jobRef: () => builtinJobRef(definitionName),
      listTargetRepos,
    })(params);

/** Composed production handlers, one per detection tick (registry layer 3). */
export const specDriftTick = productionTick("spec-drift", activeSpecRepos);

export const gapDetectionTick = productionTick("gap-detect", onboardedRepos);

export const specCoverageValidateTick = productionTick(
  "spec-coverage-validate",
  specRepos,
);

export const specCoverageBackfillTick = productionTick(
  "spec-coverage-backfill",
  activeSpecRepos,
);
