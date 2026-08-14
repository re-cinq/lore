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
  stationNodeOutcome,
  parseNodeResult,
  parseReviewVerdict,
  isBillingError,
  type AgentNodeStatus,
} from "./node-outcome.js";

export {
  resultTextFromOutput,
  terminalErrorText,
  resultLine,
  eventLine,
  unwrapAttribution,
} from "./agent-output.js";

export { ciOutcome, type CiConclusion } from "./github-action-handler.js";

export {
  loadAssemblyLineDir,
  parseAssemblyLine,
  AssemblyLineLoadError,
  type AssemblyLine,
  type AssemblyLineNode,
  type AssemblyLineEdge,
  type EdgeConditionValue,
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
export {
  snapshotGraph,
  type SnapshotGraph,
  type SnapshotNode,
  type SnapshotEdge,
} from "./snapshot-graph.js";

export { RelayExecutor, type RelayResult } from "./relay/relay-executor.js";
export { RELAY_SCRIPT } from "./relay/relay-script.js";

export {
  createValidateHandler,
  type ValidateHandlerDeps,
} from "./validate-handler.js";

export {
  selectEdge,
  nextTransition,
  type NodeVisit,
  type Transition,
} from "./transition.js";
