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
import { upkeepSourcesFor } from "../sources.js";

export interface DetectDriftDeps {
  findDrift(repo: string): Promise<DriftedSpec[]>;
}

const productionDeps: DetectDriftDeps = {
  findDrift: (repo) => findDrift(upkeepSourcesFor(repo), MAX_DRIFTED_SPECS),
};

export function detectDriftHandle(deps: DetectDriftDeps): Handle {
  return async ({ needs }, tools) => {
    try {
      const drifted = await deps.findDrift(parseGitRef(needs.target).repo);

      await tools.produce("drift", Buffer.from(driftBrief(drifted)));

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
