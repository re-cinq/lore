// The detection-job registry the detect node handler dispatches on (Floor-side).
// Keys are the workflow YAMLs' `job_ref` values (the historic ADR-019 job names).
// The detector cores live in @re-cinq/lore-shared/detect so a station pod can
// import them too; the Floor binds each to projectFor(repo) (Postgres), while a
// pod binds createStationProject(repo) (HTTP).

import type { DetectorFn } from "@re-cinq/lore-assembly-lines";
import {
  gapDetectJob,
  specDriftJob,
  validateSpecCoverageJob,
  specCoverageBackfillJob,
} from "@re-cinq/lore-shared/detect/index.js";
import { projectFor } from "../../composition/project-boot.js";

export const detectors: Record<string, DetectorFn> = {
  spec_drift: async ({ repo }) => specDriftJob({ repoFilter: repo, project: await projectFor(repo) }),
  gap_detection: async ({ repo }) => gapDetectJob({ repoFilter: repo, project: await projectFor(repo) }),
  spec_coverage_validate: async ({ repo }) =>
    validateSpecCoverageJob({ repoFilter: repo, project: await projectFor(repo) }),
  spec_coverage_backfill: async ({ repo }) =>
    specCoverageBackfillJob({ repoFilter: repo, project: await projectFor(repo) }),
};
