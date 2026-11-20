// The composition root of the changelog's stations: per-repo Projects for the week's reads, and the changelog_weeks table.
import type { ChangelogWeeksPort } from "@re-cinq/lore-shared/project/changelog-weeks/changelog-weeks-port.js";
import { closedWorkSince } from "../outbound/closed-work.js";
import { pipeline } from "../outbound/queues.js";
import type { ChangelogCollectDeps } from "./collect/station.js";

export function collectDeps(): ChangelogCollectDeps {
  return {
    closedWork: closedWorkSince,
  };
}

/** Called when the stations start, after the pool exists. */
export function storeDeps(): ChangelogWeeksPort {
  return pipeline().changelogWeeks;
}
