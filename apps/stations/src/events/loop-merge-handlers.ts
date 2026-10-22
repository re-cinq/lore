// A loop ticket's pull request merging is the loop's own definition of success, whoever merged it (#2875-followup). The retry and dead-lettering are the bus's, so a floor out of reach costs a late settle and not a lost one.
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import {
  settleMergedLoopTicket,
  type MergeSuccessDeps,
} from "@re-cinq/lore-shared/backlog/loop-merge-success.js";

export interface LoopMergeDeps {
  settle: MergeSuccessDeps;
}

const PR_CLOSED = "github.pull_request.closed";

export const LOOP_MERGE_EVENTS: readonly string[] = [PR_CLOSED];

export function loopMergeHandlers(
  deps: LoopMergeDeps,
): Map<string, EventHandler> {
  return new Map<string, EventHandler>([[PR_CLOSED, onPullRequestClosed(deps)]]);
}

function onPullRequestClosed(deps: LoopMergeDeps): EventHandler {
  return async (params) => {
    const { repo, branch, merged } = params as {
      repo?: string;
      branch?: string;
      merged?: boolean;
    };

    if (!repo || !branch || !merged) {
      return;
    }
    const outcome = await settleMergedLoopTicket(deps.settle, repo, branch);

    console.log(`[stations] loop-merge: ${repo} ${branch}: ${outcome}`);
  };
}
