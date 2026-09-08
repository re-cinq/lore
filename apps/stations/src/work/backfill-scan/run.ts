// Binds the backfill scan to this process's ports — each unit is an ordinary `spec-coverage-backfill` line whose detect node carries `spec_path`, so sharding needs no new blueprint.

import type { SweepContext } from "../lib/station.js";
import { scanForBackfill } from "./backfill-scan.js";
import { pipeline, settings } from "../../outbound/queues.js";
import { projectFor } from "../../outbound/project-boot.js";

const BLUEPRINT = "spec-coverage-backfill";

/** One run per (repo, spec): the overlap guard is per specification now. */
const subjectFor = (repo: string, specPath: string): string =>
  `${BLUEPRINT}:${repo}:${specPath}`;

// Starts one spec's backfill, or hands back the run already doing it. The subject key is per (repo, spec), so two specs of the same repo do not block each other while one spec cannot be started twice.
async function startBackfill(repo: string, specPath: string): Promise<string> {
  const subjectKey = subjectFor(repo, specPath);
  const open = await pipeline().assemblyRuns.findOpenBySubject(
    repo,
    subjectKey,
  );

  if (open) {
    return open.id;
  }

  return pipeline().assemblyRuns.start({
    blueprintName: BLUEPRINT,
    repo,
    branch: `detect/${BLUEPRINT}/${specPath}`,
    subjectKey,
    args: { spec_path: specPath },
  });
}

export function runBackfillScan(_ctx: SweepContext): Promise<string> {
  return scanForBackfill({
    // Onboarded repos, filtered to those with specs by the per-repo listing below, rather than a second definition of "a repo with specs" living here alongside the Floor's.
    repos: async () =>
      (await settings().onboardedRepos()).map((r) => r.full_name),
    specsFor: async (repo) =>
      (await (await projectFor(repo)).chunks.specChunksForBackfill()).map(
        (s) => s.filePath,
      ),
    startBackfill,
  });
}
