// Decides whether a loop branch is on current main. A branch that lacks commits of the default branch is sent to the sync round, which rebases it; a branch that lacks none goes straight on, so an up-to-date run costs no pod.

import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface SyncCheckDeps {
  /** How many commits of the default branch the branch lacks; undefined when GitHub cannot compare them. */
  behindBy(repo: string, branch: string): Promise<number | undefined>;
}

const productionDeps: SyncCheckDeps = {
  behindBy: async (repo, branch) =>
    (await projectFor(repo)).repo.branchBehindBy(branch),
};

export function syncCheckHandle(deps: SyncCheckDeps): Handle {
  return async ({ needs }) => {
    const { repo, branch } = parseGitRef(needs.target);

    try {
      const behindBy = await deps.behindBy(repo, branch);

      if (behindBy === undefined) {
        return {
          outcome: "failed",
          error: `could not compare ${branch} with the default branch`,
        };
      }

      return {
        outcome: behindBy === 0 ? "success" : "changes_requested",
      };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

export function startSyncCheckStation(): RunningStation {
  return defineStation("loop-sync-check", syncCheckHandle(productionDeps));
}
