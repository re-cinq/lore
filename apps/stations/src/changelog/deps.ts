// The composition root of the changelog's stations: per-repo Projects for the week's reads, and the changelog_weeks table.
import type { ChangelogWeeksPort } from "@re-cinq/lore-shared/project/changelog-weeks/changelog-weeks-port.js";
import { projectFor } from "../outbound/project-boot.js";
import { pipeline } from "../outbound/queues.js";
import type { ChangelogCollectDeps } from "./collect/station.js";

export function collectDeps(): ChangelogCollectDeps {
  return {
    closedWork: async (repo, { from }) => {
      const project = await projectFor(repo);
      const [merged, closed] = await Promise.all([
        project.pulls.listMergedSince(from),
        project.issues.list({ state: "closed", since: from }),
      ]);

      return { merged, closed };
    },
  };
}

/** Called when the stations start, after the pool exists. */
export function storeDeps(): ChangelogWeeksPort {
  return pipeline().changelogWeeks;
}
