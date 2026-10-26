// Decides whether a loop branch needs the sync round, which rebases it. Once the branch has an open pull request, GitHub decides: a conflict, or a branch it calls behind (it does only when a branch rule asks for it up to date). A branch merely behind main goes straight on, because GitHub merges it as it is and rebasing it on every move of main kept a busy repository's pull requests rebasing instead of merging. A clean pull request GitHub calls behind is rebased by GitHub itself here, so only a conflict costs a pod (specs/external-floor FR12.8b). Before a pull request exists, a branch lacking commits of main is rebased, so the ticket starts on current code.

import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import type {
  BranchUpdate,
  Mergeability,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface SyncCheckDeps {
  /** How many commits of the default branch the branch lacks; undefined when GitHub cannot compare them. */
  behindBy(repo: string, branch: string): Promise<number | undefined>;
  /** GitHub's mergeability for the open pull request on the branch, or null when it has none. */
  pullMergeability(repo: string, branch: string): Promise<Mergeability | null>;
  /** Has GitHub rebase the branch's open pull request onto its base, expecting the head it read. */
  rebaseOnGitHub(repo: string, branch: string): Promise<BranchUpdate>;
}

/** The open pull request on the branch, read through the repository's facade, or undefined. */
async function openPullOn(repo: string, branch: string) {
  const { pulls } = await projectFor(repo);
  const open = (await pulls.list()).find(
    (pull) => pull.branch === branch && pull.state === "open",
  );

  return { pulls, open };
}

const productionDeps: SyncCheckDeps = {
  behindBy: async (repo, branch) =>
    (await projectFor(repo)).repo.branchBehindBy(branch),
  pullMergeability: async (repo, branch) => {
    const { pulls, open } = await openPullOn(repo, branch);

    return open ? pulls.getMergeability(open.number) : null;
  },
  rebaseOnGitHub: async (repo, branch) => {
    const { pulls, open } = await openPullOn(repo, branch);

    return open?.headSha
      ? pulls.updateBranch(open.number, open.headSha)
      : { updated: false, reason: "no open pull request with a head" };
  },
};

export function syncCheckHandle(deps: SyncCheckDeps): Handle {
  return async ({ needs }) => {
    const { repo, branch } = parseGitRef(needs.target);

    try {
      const pull = await deps.pullMergeability(repo, branch);

      return pull
        ? await pullVerdict(pull, () => deps.rebaseOnGitHub(repo, branch))
        : branchVerdict(await deps.behindBy(repo, branch), branch);
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

/** A conflict is the sync round's; a clean pull request GitHub calls behind is GitHub's to rebase, and the round's only when GitHub refuses. */
async function pullVerdict(
  { mergeable, state }: Mergeability,
  rebase: () => Promise<BranchUpdate>,
): Promise<{ outcome: string; error?: string }> {
  if (mergeable === false) {
    return { outcome: "changes_requested" };
  }

  if (state !== "behind") {
    return { outcome: "success" };
  }
  const rebased = await rebase();

  return rebased.updated
    ? { outcome: "success" }
    : {
        outcome: "changes_requested",
        error: `GitHub could not rebase it: ${rebased.reason}`,
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
