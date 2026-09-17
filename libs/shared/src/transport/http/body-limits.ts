/** The request-body ceilings every hapi server in the repo shares, so a relay refuses exactly what the far end would have refused rather than buffering a body nobody will accept. */

/** Server-wide default for the bus front doors (Floor, event-router): large enough for a batched NDJSON post, small enough that one caller cannot exhaust the heap. */
export const MAX_SERVER_BODY_BYTES = 25 * 1024 * 1024;

/** The agent-telemetry sink cap, shared by the Floor's own ingress and the cluster-agent relay that forwards to it. */
export const MAX_AGENT_EVENTS_BODY_BYTES = 8 * 1024 * 1024;

/** The REST default for lore-api: a JSON document, not a stream. */
export const MAX_JSON_BODY_BYTES = 1_048_576;

/** Writes that legitimately carry a document (spec bodies, feature payloads). */
export const MAX_DOCUMENT_BODY_BYTES = 2 * 1_048_576;
