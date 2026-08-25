/**
 * Bind the backfill scan to this process's ports.
 *
 * Each unit is an ordinary `spec-coverage-backfill` line whose detect node
 * carries `spec_path`, so the sharding needs no new blueprint — only a narrower
 * argument to the one that already exists.
 */

import type { SweepContext } from "../lib/station.js";
import { scanForBackfill } from "./backfill-scan.js";
import { pipeline, settings } from "../../kernel/queues.js";
import { projectFor } from "../../kernel/project-boot.js";

const BLUEPRINT = "spec-coverage-backfill";

/** One run per (repo, spec): the overlap guard is per specification now. */
const subjectFor = (repo: string, specPath: string): string =>
  `${BLUEPRINT}:${repo}:${specPath}`;

export function runBackfillScan(_ctx: SweepContext): Promise<string> {
  return scanForBackfill({
    // Onboarded repos, filtered to those that actually have specs by the
    // per-repo listing below — rather than a second definition of "a repo with
    // specs" living here alongside the Floor's.
    repos: async () =>
      (await settings().onboardedRepos()).map((r) => r.full_name),
    specsFor: async (repo) =>
      (await (await projectFor(repo)).chunks.specChunksForBackfill()).map(
        (s) => s.filePath,
      ),
    startBackfill: async (repo, specPath) => {
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
    },
  });
}
