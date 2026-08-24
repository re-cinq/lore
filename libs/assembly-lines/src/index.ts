// @re-cinq/lore-assembly-lines — the assembly-line definition + transition kernel.
//
// The declarative definitions (loader + builtin YAMLs), the pure transition
// replay the event-driven walk routes on (spec 6-dark-factory FR6.9), and the
// station contract's outcome parsing. The in-process walk (executor, supervisor,
// node handlers, poll loops) retired with the event-driven cutover — the Floor
// advances lines on `kubernetes.agent_node.*` events; station pods run the work.
// Depends only on @re-cinq/lore-shared; no DB, Octokit, or K8s client.

export {
  type StageOutcome,
  type NodeResult,
  type NodeLlmUsage,
  type NodeContext,
  type NodeHandler,
} from "./node-types.js";

export {
  NodeResultSchema,
  type ParsedNodeResult,
} from "./node-result-schema.js";

export {
  stationNodeOutcome,
  parseNodeResult,
  parseReviewVerdict,
  type AgentNodeStatus,
} from "./node-outcome.js";

export {
  resultTextFromOutput,
  terminalErrorText,
  resultLine,
  eventLine,
  unwrapAttribution,
} from "./agent-output.js";

export { resolveRunGraph } from "./resolve-run-graph.js";

export {
  loadAssemblyLineDir,
  parseAssemblyLine,
  AssemblyLineLoadError,
  type AssemblyLine,
  type AssemblyLineNode,
  type AssemblyLineEdge,
  type EdgeConditionValue,
  NODE_TYPES,
  type NodeTypeValue,
} from "./loader.js";

export { loadBuiltinAssemblyLines } from "./builtin-assembly-lines.js";
export {
  resolveNodeStation,
  builtinStationName,
  type NodeStation,
} from "./node-station.js";

export { definitionHash } from "./definition-hash.js";
export {
  HUMAN_STATION_TYPES,
  isHumanStation,
  invalidRoutePlaceholders,
  type HumanStationType,
} from "./human-station.js";
// The graph type itself is `RunGraph` from `@re-cinq/lore-shared` (the persisted
// wire format lives with the port that stores it) — import it from there.
export { snapshotGraph } from "./snapshot-graph.js";

// The BYO toolchain relay is NOT exported. It is ADR-025 phase 2 — built, with a
// real round-trip test, and deliberately not wired: phase 3 is what makes the
// kernel run `detectTooling`'s commands in the repo's sidecar. Exporting it from
// the public barrel advertised a capability no production code sets up, so a
// reader could reasonably conclude BYO validation works today. It stays in the
// package (`./relay/`), reachable by the handler that will use it, and becomes
// public when phase 3 wires it.
//
// For Floor assembly lines the station pod already superseded this path: the
// lore-station image IS the toolchain container (ADR-025's amendment). The relay
// remains for the in-pod agent runs it was built for.

export {
  createValidateHandler,
  type ValidateHandlerDeps,
} from "./validate-handler.js";

export {
  selectEdge,
  getNextTransition,
  type NodeVisit,
  type Transition,
} from "./transition.js";
export {
  isPermanentNodeFailure,
  nodeFailureReason,
  type NodeFailure,
} from "./failure-reason.js";
