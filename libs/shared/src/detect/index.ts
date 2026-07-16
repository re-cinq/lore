/**
 * Detection job cores — the deterministic per-repo detectors run by the `detect`
 * assembly-line node. Facade-driven (every read/write goes through an injected
 * Project), so they run identically Floor-side (projectFor, Postgres) and in a
 * station pod (createStationProject, HTTP). Relocated here from apps/floor so the
 * lore-station image can import them without pulling the whole Floor.
 */

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
export {
  statusStalenessJob,
  type StatusStalenessOptions,
  type StaleEvidence,
  type StaleFinding,
  namedPaths,
  gatherEvidence,
  decideStale,
  formatStaleStatusReport,
  hasOpenStaleStatusIssue,
} from "./status-staleness.js";
