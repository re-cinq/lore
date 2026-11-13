// Finds the statements of a repository's specs that have drifted (a test bound to one fails, or the projection flagged it) and hands them on as the drift brief. No model call: the traceability graph is the judge.
import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { parseGitRef } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import {
  driftBrief,
  findDrift,
  type DriftedSpec,
} from "@re-cinq/lore-shared/spec-upkeep/findings.js";
import { MAX_DRIFTED_SPECS } from "@re-cinq/lore-shared/spec-upkeep/floor-spec-upkeep.js";
import { projectFor } from "../../outbound/project-boot.js";
import { upkeepSourcesFor } from "../sources.js";

export interface LinkRotPorts {
  pulls: { list(): Promise<{ number: number }[]> };
  issues: {
    create(title: string, body: string, labels?: string[]): Promise<unknown>;
  };
}

export interface DetectDriftDeps {
  findDrift(repo: string): Promise<DriftedSpec[]>;
  project?(repo: string): Promise<LinkRotPorts>;
}

const productionDeps: DetectDriftDeps = {
  findDrift: (repo) => findDrift(upkeepSourcesFor(repo), MAX_DRIFTED_SPECS),
  project: async (repo) => projectFor(repo),
};

export function detectDriftHandle(deps: DetectDriftDeps): Handle {
  return async ({ needs }, tools) => {
    try {
      const repo = parseGitRef(needs.target).repo;
      const drifted = await deps.findDrift(repo);

      await tools.produce("drift", Buffer.from(driftBrief(drifted)));

      if (drifted.length > 0 && deps.project) {
        await openIssueWhenNoPR(await deps.project(repo), drifted.length);
      }

      return {
        outcome: "success",
        produced: { drift_count: String(drifted.length) },
      };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

export function startDetectDriftStation(): RunningStation {
  return defineStation(
    "spec-upkeep-detect-drift",
    detectDriftHandle(productionDeps),
  );
}

async function openIssueWhenNoPR(
  ports: LinkRotPorts,
  count: number,
): Promise<void> {
  const openPRs = await ports.pulls.list();

  if (openPRs.length > 0) {
    return;
  }

  await ports.issues.create(
    "Link rot detected: spec statements have drifted",
    `Lore's spec-upkeep run found ${count} spec(s) with drifted statements and no open pull request exists to fix them. Run spec-upkeep or open a PR to address the drift.`,
    ["spec-link-rot"],
  );
}
