/**
 * Barrel for the HTTP API layer. Routes are native hapi routes registered by
 * `server/build-server.ts`; this file only re-exports the post-ingest agent
 * triggers (`./routes/helpers.ts`) that the ingest routes fire and the trigger
 * tests import.
 */

export {
  triggerAgentSpecCoverageValidate,
  triggerAgentSpecTrace,
} from "./routes/helpers.js";
