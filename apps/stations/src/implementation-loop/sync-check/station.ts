// Decides whether a loop branch needs the sync round, which rebases it. Once the branch has an open pull request, GitHub decides: a conflict, or a branch it calls behind (it does only when a branch rule asks for it up to date). A branch merely behind main goes straight on, because GitHub merges it as it is and rebasing it on every move of main kept a busy repository's pull requests rebasing instead of merging. Before a pull request exists, a branch lacking commits of main is rebased, so the ticket starts on current code.

import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import type { Mergeability } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface SyncCheckDeps {
  /** How many commits of the default branch the branch lacks; undefined when GitHub cannot compare them. */
  behindBy(repo: string, branch: string): Promise<number | undefined>;
  /** GitHub's mergeability for the open pull request on the branch, or null when it has none. */
  pullMergeability(repo: string, branch: string): Promise<Mergeability | null>;
}

const productionDeps: SyncCheckDeps = {
  behindBy: async (repo, branch) =>
    (await projectFor(repo)).repo.branchBehindBy(branch),
  pullMergeability: async (repo, branch) => {
    const { pulls } = await projectFor(repo);
    const open = (await pulls.list()).find(
      (pull) => pull.branch === branch && pull.state === "open",
    );

    return open ? pulls.getMergeability(open.number) : null;
  },
};

export function syncCheckHandle(deps: SyncCheckDeps): Handle {
  return async ({ needs }) => {
    const { repo, branch } = parseGitRef(needs.target);

    try {
      const pull = await deps.pullMergeability(repo, branch);

      return pull
        ? pullVerdict(pull)
        : branchVerdict(await deps.behindBy(repo, branch), branch);
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

function pullVerdict({ mergeable, state }: Mergeability) {
  return {
    outcome:
      mergeable === false || state === "behind"
        ? "changes_requested"
        : "success",
  };
}

function branchVerdict(behindBy: number | undefined, branch: string) {
  if (behindBy === undefined) {
    return {
      outcome: "failed",
      error: `could not compare ${branch} with the default branch`,
    };
  }

  return { outcome: behindBy === 0 ? "success" : "changes_requested" };
}

export function startSyncCheckStation(): RunningStation {
  return defineStation("loop-sync-check", syncCheckHandle(productionDeps));
}
