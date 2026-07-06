// The detection-job registry the detect node handler dispatches on. Keys are
// the workflow YAMLs' `job_ref` values (the historic ADR-019 job names); each
// detector is the existing job function bound to one repo via repoFilter.

import type { DetectorFn } from "@re-cinq/lore-assembly-lines";
import { gapDetectJob } from "../context-jobs/gap-detect/index.js";
import { specDriftJob } from "../spec-trace/spec-drift/index.js";
import { specCoverageBackfillJob } from "../spec-trace/spec-coverage-backfill/index.js";
import { validateSpecCoverageJob } from "../spec-trace/spec-coverage-validate.js";

export const detectors: Record<string, DetectorFn> = {
  spec_drift: ({ repo }) => specDriftJob({ repoFilter: repo }),
  gap_detection: ({ repo }) => gapDetectJob({ repoFilter: repo }),
  spec_coverage_validate: ({ repo }) => validateSpecCoverageJob({ repoFilter: repo }),
  spec_coverage_backfill: ({ repo }) => specCoverageBackfillJob({ repoFilter: repo }),
};
