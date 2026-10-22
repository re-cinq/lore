// A merged spec, told to the spec-tickets line: each specs/<name>/spec.md the pull request changed gets a run that files its tickets. The retry and dead-lettering are the bus's, so a floor out of reach costs a late start and not a lost one.
import { z } from "zod";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import {
  SPEC_TICKETS_LINE,
  startSpecTicketRuns,
  type SpecMerge,
  type SpecTicketsDeps,
} from "@re-cinq/lore-shared/spec-tickets/floor-spec-tickets.js";

const PR_CLOSED = "github.pull_request.closed";

export const FLOOR_SPEC_TICKETS_EVENTS: readonly string[] = [PR_CLOSED];

export interface FloorSpecTicketsDeps {
  tickets(repo: string): Promise<SpecTicketsDeps>;
}

export function floorSpecTicketsHandlers(
  deps: FloorSpecTicketsDeps,
): Map<string, EventHandler> {
  return new Map<string, EventHandler>([[PR_CLOSED, onPrClosed(deps)]]);
}

function onPrClosed(deps: FloorSpecTicketsDeps): EventHandler {
  return async (params) => {
    const merge = specMergeOf(params);

    if (!merge) {
      return;
    }
    const summary = await startSpecTicketRuns(
      merge,
      await deps.tickets(merge.repo),
    );

    console.log(
      `[${SPEC_TICKETS_LINE}] ${merge.repo}#${merge.prNumber}: ${summary}`,
    );
  };
}

const MERGED_CLOSE = z.object({
  repo: z.string(),
  pr_number: z.number(),
  merged: z.boolean(),
  base_ref: z.string(),
  merge_commit_sha: z.string(),
});

/** A close that names no merge commit, or no pull request, is not one to ticket; whether the close was a merge is the line starter's to decide. */
export function specMergeOf(params: Record<string, unknown>): SpecMerge | null {
  const close = MERGED_CLOSE.safeParse(params);

  return close.success
    ? {
        repo: close.data.repo,
        prNumber: close.data.pr_number,
        merged: close.data.merged,
        baseRef: close.data.base_ref,
        mergeCommitSha: close.data.merge_commit_sha,
      }
    : null;
}
