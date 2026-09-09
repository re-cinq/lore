// @re-cinq/lore-assembly-lines — the definition + transition kernel: declarative loader/YAMLs, the pure transition replay the event-driven walk routes on (spec 6-dark-factory FR6.9), and the station contract's outcome parsing. The in-process walk retired with the event-driven cutover. Depends only on @re-cinq/lore-shared; no DB, Octokit, or K8s client.

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
  agentStderrError,
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
export { stationUsage, type StationUsageRef } from "./station-usage.js";
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
// The graph type itself is `RunGraph` from `@re-cinq/lore-shared` — import it from there (the persisted wire format lives with the port that stores it).
export { snapshotGraph } from "./snapshot-graph.js";

// The BYO toolchain relay is NOT exported (ADR-025 phase 2, built but deliberately not wired until phase 3 runs detectTooling in the repo's sidecar) — reachable at `./relay/`, goes public when phase 3 wires it; Floor lines already use the lore-station image instead (ADR-025 amendment).

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
