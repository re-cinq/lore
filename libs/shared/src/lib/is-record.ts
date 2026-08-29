/**
 * The one "is this a JSON object?" guard.
 *
 * Arrays are EXCLUDED. `typeof [] === "object"` is true, so the looser form
 * admits an array as a record and every subsequent `value.someKey` reads
 * `undefined` off it rather than rejecting the input — which is how the same
 * NDJSON line could be accepted by one ingest parser and dropped by another,
 * depending on which of the five private copies that parser happened to hold.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
