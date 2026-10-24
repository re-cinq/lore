// GET /api/repos/{owner}/{repo}/spec-upkeep — the spec upkeep loop as the Loops tab shows it: its weekly runs and the pull requests they opened, in the shared loop sections.
import type { ServerRoute } from "@hapi/hapi";
import type { Project } from "@re-cinq/lore-shared";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  SPEC_UPKEEP_LINE,
  UPKEEP_BRANCH_PREFIX,
} from "@re-cinq/lore-shared/spec-upkeep/floor-spec-upkeep.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";
import { onboardedProject } from "../repos/github-read.js";
import { loopReadRoute } from "../loops/loop-read-route.js";
import { SpecUpkeepSchema, upkeepQueues } from "./upkeep-queues.js";

/** A weekly line: a quarter's runs cover the open one and the newest settled one. */
const RUNS_READ = 12;

/** How far back Recently addressed looks for merged upkeep pull requests. */
const RECENT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function specUpkeepRoute(pageOf: FloorRunPageOf): ServerRoute {
  return loopReadRoute({
    segment: "spec-upkeep",
    schema: SpecUpkeepSchema,
    name: "SpecUpkeep",
    description:
      "The spec upkeep loop: its weekly runs and the pull requests they opened, in the shared loop sections",
    read: (fullName) => readQueues(pageOf, fullName),
  });
}

async function readQueues(pageOf: FloorRunPageOf, fullName: string) {
  const project = await onboardedProject(fullName);
  const [open, merged, page] = await Promise.all([
    project.pulls.list(),
    mergedThisWeek(project),
    pageOf({ repo: fullName, line: SPEC_UPKEEP_LINE, limit: RUNS_READ }),
  ]);

  return upkeepQueues({
    runs: page.runs,
    open: open.filter(onUpkeepBranch),
    merged: merged.filter(onUpkeepBranch),
  });
}

function mergedThisWeek(project: Project): Promise<PullRef[]> {
  const since = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString();

  return project.pulls.listMergedSince(since);
}

function onUpkeepBranch(pull: PullRef): boolean {
  return pull.branch.startsWith(UPKEEP_BRANCH_PREFIX);
}
