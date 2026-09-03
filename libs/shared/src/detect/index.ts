/** Detection job cores — deterministic per-repo detectors run by the `detect` assembly-line node; facade-driven so they run identically Floor-side and in a station pod, relocated here so lore-station can import them without the whole Floor. */

export { specDriftJob, type SpecDriftOptions } from "./spec-drift.js";
export { gapDetectJob, type GapDetectOptions } from "./gap-detect.js";
export {
  validateSpecCoverageJob,
  type ValidateOptions,
  resolveTestLink,
  collectBrokenLinks,
  formatBrokenLinksReport,
  hasOpenLinkRotIssue,
} from "./spec-coverage-validate.js";
export {
  specCoverageBackfillJob,
  type BackfillOptions,
} from "./spec-coverage-backfill.js";
