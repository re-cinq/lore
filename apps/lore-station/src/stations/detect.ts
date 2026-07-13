import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
// The detect station: run one deterministic detection job (spec_drift /
// gap_detection / spec_coverage_validate / spec_coverage_backfill) against one
// repo, entirely over HTTP. The detector cores live in @re-cinq/lore-shared/
// detect (facade-driven); the pod composes createStationProject(repo) so every
// read/write goes through the Lore API — no Postgres, Dgraph, or GitHub App in
// the pod (ADR-031 D6/D7). The node's `job_ref` selects the detector.

import {
  specDriftJob,
  gapDetectJob,
  validateSpecCoverageJob,
  specCoverageBackfillJob,
} from "@re-cinq/lore-shared/detect/index.js";
import { createStationProject, type Project } from "@re-cinq/lore-shared";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "../input.js";
import type { StationEnv } from "./validate.js";

const DETECT_SUMMARY_MAX = 200;

type Detector = (repo: string, project: Project) => Promise<string>;

const detectors: Record<string, Detector> = {
  spec_drift: (repo, project) => specDriftJob({ repoFilter: repo, project }),
  gap_detection: (repo, project) => gapDetectJob({ repoFilter: repo, project }),
  spec_coverage_validate: (repo, project) =>
    validateSpecCoverageJob({ repoFilter: repo, project }),
  spec_coverage_backfill: (repo, project) =>
    specCoverageBackfillJob({ repoFilter: repo, project }),
};

export async function runDetectStation(
  input: StationInput,
  _env?: StationEnv,
  makeProject: (repo: string) => Project = (repo) => createStationProject(repo),
): Promise<NodeResult> {
  const jobRef = input.params.job_ref;
  const detector = jobRef ? detectors[jobRef] : undefined;
  enforceTrue(
    detector,
    new Error(`detect station: no detector for job_ref "${jobRef}"`),
  );
  const summary = await detector(input.repo, makeProject(input.repo));
  return {
    outcome: "success",
    extras: { "Lore-Detect-Summary": summary.slice(0, DETECT_SUMMARY_MAX) },
  };
}
