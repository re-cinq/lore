// Layer-3 handlers for the detection-family `cron.<job>.tick` events. A tick
// fans out one assembly-line start per target repo; each start event is then
// claimed independently by the loop (per-repo retry + dead-letter), and the
// branch-keyed overlap guard in advanceLine defers concurrent duplicates
// (lease parity). A mid-loop failure lets the loop retry the whole tick —
// re-starting an already-started repo is acceptable because detection runs
// are idempotent and overlap-guarded.
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

/** Repos with specs that also shipped code inside the activity window. */
const ACTIVE_SPEC_REPOS_SQL = `
  SELECT DISTINCT c.repo
  FROM org_shared.chunks c
  WHERE c.content_type = 'spec'
    AND EXISTS (
      SELECT 1 FROM org_shared.chunks a
      WHERE a.repo = c.repo
        AND a.content_type = 'code'
        AND a.ingested_at > now() - ($1 || ' days')::interval
    )
  ORDER BY c.repo`;

const SPEC_REPOS_SQL = `
  SELECT DISTINCT repo
  FROM org_shared.chunks
  WHERE content_type = 'spec'
  ORDER BY repo`;

const ONBOARDED_REPOS_SQL = `
  SELECT full_name AS repo
  FROM lore.repos
  WHERE onboarding_pr_merged = true
  ORDER BY full_name`;

const activeSpecRepos = async (): Promise<string[]> =>
  (
    await query<{ repo: string }>(ACTIVE_SPEC_REPOS_SQL, [
      String(ACTIVITY_WINDOW_DAYS),
    ])
  ).map((r) => r.repo);

const specRepos = async (): Promise<string[]> =>
  (await query<{ repo: string }>(SPEC_REPOS_SQL)).map((r) => r.repo);

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
