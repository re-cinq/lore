// GET /api/repos/{owner}/{repo}/spec-upkeep — the spec upkeep loop as the Loops tab shows it: its weekly runs and the pull requests they opened, in the shared loop sections.
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import type { Project } from "@re-cinq/lore-shared";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  SPEC_UPKEEP_LINE,
  UPKEEP_BRANCH_PREFIX,
} from "@re-cinq/lore-shared/spec-upkeep/floor-spec-upkeep.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { answerRepoRead, onboardedProject } from "../repos/github-read.js";
import { SpecUpkeepSchema, upkeepQueues } from "./upkeep-queues.js";

const RepoParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

/** A weekly line: a quarter's runs cover the open one and the newest settled one. */
const RUNS_READ = 12;

/** How far back Recently addressed looks for merged upkeep pull requests. */
const RECENT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    validate: { params: zodValidate(RepoParams) },
  },
  SpecUpkeepSchema,
  {
    name: "SpecUpkeep",
    description:
      "The spec upkeep loop: its weekly runs and the pull requests they opened, in the shared loop sections",
    errors: [400, 404],
  },
);

export function specUpkeepRoute(pageOf: FloorRunPageOf): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/spec-upkeep",
    options: OPTIONS,
    handler: (request, h) =>
      answerRepoRead(request, h, (fullName) => readQueues(pageOf, fullName)),
  };
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
