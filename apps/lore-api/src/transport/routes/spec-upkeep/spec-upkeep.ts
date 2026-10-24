// GET /api/repos/{owner}/{repo}/spec-upkeep — the spec upkeep loop as the Loops tab shows it: its weekly runs and the pull requests they opened, in the shared loop sections.
import type { ServerRoute } from "@hapi/hapi";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  SPEC_UPKEEP_LINE,
  UPKEEP_BRANCH_PREFIX,
} from "@re-cinq/lore-shared/spec-upkeep/floor-spec-upkeep.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";
import { onboardedProject } from "../repos/github-read.js";
import { loopReadRoute } from "../loops/loop-read-route.js";
import { loopPullReads, type LoopPullReads } from "../loops/loop-pull-reads.js";
import { SpecUpkeepSchema, upkeepQueues } from "./upkeep-queues.js";

/** A weekly line: a quarter's runs cover the open one and the newest settled one. */
const RUNS_READ = 12;

export function specUpkeepRoute(
  pageOf: FloorRunPageOf,
  reads: LoopPullReads = loopPullReads(),
): ServerRoute {
  return loopReadRoute({
    segment: "spec-upkeep",
    schema: SpecUpkeepSchema,
    name: "SpecUpkeep",
    description:
      "The spec upkeep loop: its weekly runs and the pull requests they opened, in the shared loop sections",
    read: (fullName) => readQueues({ pageOf, reads }, fullName),
  });
}

async function readQueues(
  { pageOf, reads }: { pageOf: FloorRunPageOf; reads: LoopPullReads },
  fullName: string,
) {
  const project = await onboardedProject(fullName);
  const [open, merged, page] = await Promise.all([
    reads.openPulls(fullName, project.pulls),
    reads.mergedThisWeek(fullName, project.pulls),
    pageOf({ repo: fullName, line: SPEC_UPKEEP_LINE, limit: RUNS_READ }),
  ]);

  return upkeepQueues({
    runs: page.runs,
    open: open.filter(onUpkeepBranch),
    merged: merged.filter(onUpkeepBranch),
  });
}

function onUpkeepBranch(pull: PullRef): boolean {
  return pull.branch.startsWith(UPKEEP_BRANCH_PREFIX);
}
