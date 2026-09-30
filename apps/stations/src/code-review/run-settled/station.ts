// The run-settled service station: started by the floor's own `internal.run.settled` event, it is how Lore hears that a run ended.
import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import type { RunView } from "@re-cinq/floor-client";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { projectFor } from "../../outbound/project-boot.js";
import { brokenReviewCheck, reviewBroke, startValueOf } from "./run-settled.js";

export interface SettledProject {
  pullHead(prNumber: number): Promise<Pick<PullRef, "headSha"> | null>;
  upsertCheckRun(input: CheckRunInput): Promise<void>;
}

export interface RunSettledDeps {
  run(runId: string): Promise<RunView | null>;
  project(repo: string): Promise<SettledProject>;
}

const SETTLED: Report = { outcome: "success" };

export function runSettledHandle(deps: RunSettledDeps): Handle {
  return async ({ needs }) => {
    if (!reviewBroke(needs.line_id, needs.outcome)) {
      return SETTLED;
    }
    const run = await deps.run(needs.run_id);
    const prUrl = run && startValueOf(run, "pr_url");

    if (prUrl) {
      await publishBrokenReview(deps, run, prUrl);
    }

    return SETTLED;
  };
}

async function publishBrokenReview(
  deps: RunSettledDeps,
  run: RunView,
  prUrl: string,
): Promise<void> {
  const { repo, prNumber } = parsePullRequestUrl(prUrl);
  const project = await deps.project(repo);
  const headSha =
    startValueOf(run, "head_sha") ??
    (await project.pullHead(prNumber))?.headSha;

  if (headSha) {
    await project.upsertCheckRun(brokenReviewCheck(headSha, run));
  }
}

const productionDeps: RunSettledDeps = {
  run: async (runId) => (await floorClient().runs.get(runId))?.run ?? null,
  project: async (repo) => {
    const { pulls, repo: repository } = await projectFor(repo);

    return {
      pullHead: (prNumber) => pulls.get(prNumber),
      upsertCheckRun: (input) => repository.upsertCheckRun(input),
    };
  },
};

export function startRunSettledStation(): RunningStation {
  return defineStation("run-settled", runSettledHandle(productionDeps));
}
