// Layer-3 handlers for the detection-family `cron.<job>.tick` events. A tick
// fans out one assembly-line start per target repo; each start event is then
// claimed independently by the loop (per-repo retry + dead-letter), and the
// per-run branch lease dedupes concurrent duplicates. A mid-loop failure lets
// the loop retry the whole tick — re-starting an already-started repo is
// acceptable because detection runs are idempotent and lease-guarded.
//
// Manual trigger (documented in specs/scheduled-job-runtime-split):
//   INSERT INTO pipeline.events (event_name, source, params)
//   VALUES ('cron.spec_drift.tick', 'cron', '{"repo":"re-cinq/lore"}');
// Omit `repo` for the full fan-out.

import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import type { EventHandler } from "../../main-loop/types.js";
import { query } from "../../kernel/db.js";
import { assemblyLines } from "../../kernel/queues.js";

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

    for (const repo of repos) {
      const id = await deps.assemblyLines.start({ definitionName, repo });

      console.log(
        `[detect] ${definitionName}: started assembly line ${id} for ${repo}`,
      );
    }
  };
}

/** Composed production handlers, one per detection tick (registry layer 3). */
export const specDriftTick: EventHandler = (params) =>
  createDetectTickHandler("spec-drift", {
    assemblyLines: assemblyLines(),
    listTargetRepos: activeSpecRepos,
  })(params);

export const gapDetectionTick: EventHandler = (params) =>
  createDetectTickHandler("gap-detect", {
    assemblyLines: assemblyLines(),
    listTargetRepos: onboardedRepos,
  })(params);

export const specCoverageValidateTick: EventHandler = (params) =>
  createDetectTickHandler("spec-coverage-validate", {
    assemblyLines: assemblyLines(),
    listTargetRepos: specRepos,
  })(params);

export const specCoverageBackfillTick: EventHandler = (params) =>
  createDetectTickHandler("spec-coverage-backfill", {
    assemblyLines: assemblyLines(),
    listTargetRepos: activeSpecRepos,
  })(params);
