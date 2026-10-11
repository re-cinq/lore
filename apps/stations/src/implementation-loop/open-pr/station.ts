// Opens (or finds) the DRAFT pull request of a ticket the implementation loop works on. A draft, so CI has a target and the code-review line stays quiet while the rounds are still pushing.

import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { clampPrTitle, prFooter } from "@re-cinq/lore-shared";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import {
  ensurePull,
  type PullOpener,
} from "@re-cinq/lore-shared/project/pulls/ensure-pull.js";
import type {
  PullDraft,
  PullRef,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { projectFor } from "../../outbound/project-boot.js";
import { pipeline } from "../../outbound/queues.js";

export interface OpenLoopPrDeps {
  pulls(repo: string): Promise<PullOpener>;
  /** Writes the pull request onto the run's task, where the run page reads it: a value a station produces stays inside the floor. */
  recordPr(taskId: string, pr: PullRef): Promise<void>;
}

const productionDeps: OpenLoopPrDeps = {
  pulls: async (repo) => (await projectFor(repo)).pulls,
  recordPr: (taskId, pr) =>
    pipeline().taskQueue.setColumns(taskId, {
      pr_url: pr.url,
      pr_number: pr.number,
    }),
};

/** GitHub's refusal to open a pull request from a branch that holds nothing its base lacks. */
const NOTHING_TO_OPEN = /no commits between/i;

/** The needs this station reads; the issue's title and number are absent on a run started by hand. */
type LoopPrNeeds = Partial<Record<"issue_title" | "issue_number", string>> & {
  target: string;
  task_id: string;
};

export function openLoopPrHandle(deps: OpenLoopPrDeps): Handle {
  return async ({ needs }) => {
    const ticket = needs as LoopPrNeeds;
    const { repo, branch } = parseGitRef(ticket.target);

    try {
      const pulls = await deps.pulls(repo);
      const pr = await ensurePull(pulls, branch, draftOf(branch, ticket));

      await deps.recordPr(ticket.task_id, pr);

      return { outcome: "success", produced: { pr_url: pr.url } };
    } catch (err) {
      return { outcome: "failed", error: refusalOf(err, branch) };
    }
  };
}

function draftOf(branch: string, ticket: LoopPrNeeds): PullDraft {
  const issueNumber = Number(ticket.issue_number) || null;

  return {
    title: ticket.issue_title
      ? clampPrTitle(ticket.issue_title)
      : `lore: ${branch}`,
    body:
      `Opened by the Lore implementation loop from \`${branch}\`.` +
      prFooter({ issueNumber, taskId: ticket.task_id }),
    draft: true,
  };
}

function refusalOf(err: unknown, branch: string): string {
  return NOTHING_TO_OPEN.test(errorMessage(err))
    ? `the step before pushed nothing: ${branch} has no commits, so no pull request could be opened`
    : errorMessage(err);
}

export function startOpenLoopPrStation(): RunningStation {
  return defineStation("loop-open-pr", openLoopPrHandle(productionDeps));
}
