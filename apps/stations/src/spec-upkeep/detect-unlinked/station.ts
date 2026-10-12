// Finds the testable statements no test validates and hands them on as the unlinked brief. When neither this station nor the drift one found anything, the run ends here: no branch, no agent pod, no pull request.
import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import { ensureBranch } from "@re-cinq/lore-shared/project/repo/ensure-branch.js";
import {
  findUnlinked,
  unlinkedBrief,
  type UnlinkedSpec,
} from "@re-cinq/lore-shared/spec-upkeep/findings.js";
import { MAX_UNLINKED_STATEMENTS } from "@re-cinq/lore-shared/spec-upkeep/floor-spec-upkeep.js";
import { projectFor } from "../../outbound/project-boot.js";
import { upkeepSourcesFor } from "../sources.js";

export interface DetectUnlinkedDeps {
  findUnlinked(repo: string): Promise<UnlinkedSpec[]>;
  ensureBranch(repo: string, branch: string): Promise<void>;
}

const productionDeps: DetectUnlinkedDeps = {
  findUnlinked: (repo) =>
    findUnlinked(upkeepSourcesFor(repo), MAX_UNLINKED_STATEMENTS),
  ensureBranch: async (repo, branch) =>
    ensureBranch((await projectFor(repo)).repo, branch),
};

const NOTHING_TO_DO: Report = { outcome: "nothing" };

export function detectUnlinkedHandle(deps: DetectUnlinkedDeps): Handle {
  return async ({ needs }, tools) => {
    const { repo, branch } = parseGitRef(needs.target);

    try {
      const unlinked = await deps.findUnlinked(repo);
      const count = statementsIn(unlinked);

      if (count === 0 && Number(needs.drift_count) === 0) {
        return NOTHING_TO_DO;
      }
      await tools.produce("unlinked", Buffer.from(unlinkedBrief(unlinked)));
      // Cut only now that there is work: the agent's visit clones this branch.
      await deps.ensureBranch(repo, branch);

      return {
        outcome: "success",
        produced: { unlinked_count: String(count) },
      };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

function statementsIn(unlinked: readonly UnlinkedSpec[]): number {
  return unlinked.reduce((sum, spec) => sum + spec.statements.length, 0);
}

export function startDetectUnlinkedStation(): RunningStation {
  return defineStation(
    "spec-upkeep-detect-unlinked",
    detectUnlinkedHandle(productionDeps),
  );
}
