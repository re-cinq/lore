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
import { eventLine, type NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";
import type { StationEnv } from "../lib/station.js";

const DETECT_SUMMARY_MAX = 200;

/** `specPath` narrows a detector to ONE specification. Only the backfill honours
 *  it today; the others are already short enough to run whole-repo. */
type Detector = (
  repo: string,
  project: Project,
  specPath?: string,
) => Promise<string>;

const detectors: Record<string, Detector> = {
  spec_drift: (repo, project) => specDriftJob({ repoFilter: repo, project }),
  gap_detection: (repo, project) => gapDetectJob({ repoFilter: repo, project }),
  spec_coverage_validate: (repo, project) =>
    validateSpecCoverageJob({ repoFilter: repo, project }),
  // The long one: an LLM judge over every candidate statement, at a 30-minute
  // budget. `specPathFilter` was declared and never set by anything, which is
  // the seam that lets one node do one specification.
  spec_coverage_backfill: (repo, project, specPath) =>
    specCoverageBackfillJob({
      repoFilter: repo,
      project,
      specPathFilter: specPath,
    }),
};

export async function runDetectStation(
  input: StationInput,
  _env?: StationEnv,
  makeProject: (repo: string) => Project = (repo) => createStationProject(repo),
  registry: Record<string, Detector> = detectors,
): Promise<NodeResult> {
  const jobRef = input.params.job_ref;
  const detector = jobRef ? registry[jobRef] : undefined;

  enforceTrue(
    detector,
    Error,
    `detect station: no detector for job_ref "${jobRef}"`,
  );
  console.log(
    eventLine(
      `detect ${jobRef} on ${input.repo}${input.params.spec_path ? ` (${input.params.spec_path})` : ""}`,
    ),
  );
  const specPath = input.params.spec_path;
  const summary = await detector(input.repo, makeProject(input.repo), specPath);

  console.log(eventLine(summary.slice(0, DETECT_SUMMARY_MAX)));

  return {
    outcome: "success",
    extras: { "Lore-Detect-Summary": summary.slice(0, DETECT_SUMMARY_MAX) },
  };
}
