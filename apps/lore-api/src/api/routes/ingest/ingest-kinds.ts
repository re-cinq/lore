/** The kinds the incremental CI ingest handshake speaks — the two doc
 *  projections plus the test report. One declaration for both routes. */
export const INGEST_DELTA_KINDS: ReadonlySet<string> = new Set([
  "specs",
  "adrs",
  "test-report",
]);
