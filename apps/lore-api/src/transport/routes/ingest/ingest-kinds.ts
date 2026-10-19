/** Incremental CI ingest kinds: specs, adrs, code, test-report. */
export const INGEST_DELTA_KINDS: ReadonlySet<string> = new Set([
  "specs",
  "adrs",
  "code",
  "test-report",
]);
