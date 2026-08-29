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

import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { detectSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
import type { EventHandler } from "../../main-loop/types.js";
import { query } from "../../kernel/db.js";
import { pipeline, settings } from "../../kernel/queues.js";

/** The line's branch: a synthetic ref no `git checkout` resolves — detect nodes
 *  read through the API and clone nothing. It used to double as the overlap-guard
 *  key; guarding now rides {@link detectSubject}, and this is only a branch. */
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

/** Every onboarded repo, through the shared settings port rather than a second
 *  copy of its SELECT. What "onboarded" means belongs in one place — with two,
 *  a new `archived`/`disabled` column would have to be found and applied twice
 *  or gap-detect fans out to repos the reindex scan has stopped considering
 *  onboarded. (Sorted here because the detect fan-out wants a stable order and
 *  the port makes no ordering promise.) */
const onboardedRepos = async (): Promise<string[]> =>
  (await settings().onboardedRepos()).map((repo) => repo.full_name).sort();

export interface DetectFanOutDeps {
  assemblyRuns: AssemblyRunsPort;
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
  blueprintName: string,
  deps: DetectFanOutDeps,
): EventHandler {
  return async (params) => {
    const repos =
      typeof params.repo === "string" && params.repo.length > 0
        ? [params.repo]
        : await deps.listTargetRepos();

    if (repos.length === 0) {
      console.log(
        `[detect] ${blueprintName}: no target repos, nothing to start`,
      );

      return;
    }

    const jobRef = await deps.jobRef();

    for (const repo of repos) {
      // Asked BEFORE the job_run is minted, not after the start comes back joined:
      // a job_run created for work that turns out to be already running has no
      // owner to close it (there is no job_runs reaper) and would sit open forever.
      const inFlight = await deps.assemblyRuns.findOpenBySubject(
        repo,
        detectSubject(blueprintName, repo),
      );

      if (inFlight) {
        console.log(
          `[detect] ${blueprintName}: ${repo} already running as ${inFlight.id}, skipping`,
        );
        continue;
      }
      const jobRunId = await deps.jobRuns.start(`${jobRef}:${repo}`);

      // start() throwing mid-loop (the case the header blesses for tick retry)
      // would orphan the just-created job_run open forever (no job_runs reaper) —
      // fail it before rethrowing so the retry's duplicate settles cleanly.
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
          .fail(
            jobRunId,
            `assembly_line.start failed: ${(err as Error).message}`,
          )
          .catch(() => {});
        throw err;
      }

      // The pre-check above closes the common case, not the race: two ticks can both
      // read "nothing in flight" before either calls start(). The loser's start()
      // JOINS the winner's run, and its job_run — already minted — has no owner to
      // close it and no reaper to find it. The run carries the job_run_id of
      // whichever tick actually started it, so a mismatch IS the join.
      const startedRun = await deps.assemblyRuns.getById(id);

      if (startedRun && startedRun.args.job_run_id !== jobRunId) {
        await deps.jobRuns
          .fail(jobRunId, `superseded — ${repo} is already running as ${id}`)
          .catch(() => {});
        console.log(
          `[detect] ${blueprintName}: ${repo} joined ${id}; job_run ${jobRunId} closed`,
        );
        continue;
      }

      console.log(
        `[detect] ${blueprintName}: started assembly line ${id} for ${repo}`,
      );
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

/** Composed production handlers, one per detection tick (registry layer 3). */
export const specDriftTick = productionTick("spec-drift", activeSpecRepos);

export const gapDetectionTick = productionTick("gap-detect", onboardedRepos);

export const specCoverageValidateTick = productionTick(
  "spec-coverage-validate",
  specRepos,
);
