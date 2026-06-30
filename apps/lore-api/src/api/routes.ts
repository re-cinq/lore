/**
 * Barrel for the HTTP API routing layer. The implementation lives under
 * `./routes/` — split by area into thin controllers (one module per
 * route group) plus shared `http`/`auth`/`helpers` modules and the
 * dispatcher in `./routes/index.ts`. This file preserves the public
 * import surface (`handleApiRoute`, `triggerAgentSpecCoverageValidate`)
 * so `index.ts` and the test suite need no import changes.
 */

export { handleApiRoute } from "./routes/index.js";
export { triggerAgentSpecCoverageValidate, triggerAgentSpecTrace } from "./routes/helpers.js";
