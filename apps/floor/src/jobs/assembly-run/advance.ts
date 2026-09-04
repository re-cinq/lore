// Shared IO orchestration for the event-driven walk (spec 6-dark-factory FR6): re-derives "what happens next" purely from persisted node rows; no walker process, so duplicate advancers converge on the unique (line, node, iteration) row.

export type { AdvanceDeps } from "./advance-deps.js";
export { lineOutcomeFromVisits } from "./line-outcome.js";
export { taskFromAssemblyRun, collectPriorNodeFailures } from "./walk-state.js";
export { advanceLine } from "./advance-line.js";
export { finishLine } from "./finish-line.js";
export { finishNodeAndAdvance } from "./finish-node.js";
