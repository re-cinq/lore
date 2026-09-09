/** Incremental CI ingest kinds: specs, adrs, test-report. */
export const INGEST_DELTA_KINDS: ReadonlySet<string> = new Set([
  "specs",
  "adrs",
  "test-report",
]);
