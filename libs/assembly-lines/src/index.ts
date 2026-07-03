// @re-cinq/lore-assembly-lines — the portable execution kernel.
//
// The task-execution kernel (assembly line executor, node handlers, assembly line
// loader, claude spawner, runSupervisor, pod entry) extracted from the agent so
// it can run inside any container. It depends only on @re-cinq/lore-shared and
// receives all repo I/O through injected ports (a Project facade's leases/audit/
// usage, episode writers, an LLM call) — never a bespoke DB, Octokit, or K8s client.

export {
  runSupervisor,
  type SupervisorOptions,
  type SupervisorResult,
  type SupervisorReason,
  type SupervisorAuditSink,
} from "./supervisor.js";

export {
  executeAssemblyLine,
  resumeFromTrailers,
  builtinHandlers,
  IterationMaxExceededError,
  type StageOutcome,
  type NodeResult,
  type NodeContext,
  type AssemblyLineTrace,
  type NodeHandler,
  type NodeHandlers,
  type IterationMaxExceededInfo,
  type ExecuteOptions,
  type ExecutionSummary,
} from "./assembly-line-executor.js";

export {
  createProductionHandlers,
  createProductionRetrospectiveHandler,
  type ProductionHandlersDeps,
  type WriteEpisode,
  type WriteEpisodeWithCuration,
  type AutoMergeCandidate,
} from "./handlers.js";

export {
  createAgentHandler,
  extractJsonFiles,
  type AgentHandlerDeps,
  type AgentHandlerTaskMeta,
} from "./agent-handler.js";

export {
  createClaudeCodeAgentHandler,
  type ClaudeCodeHandlerDeps,
  type ClaudeCodeHandlerTaskMeta,
} from "./claude-code-handler.js";

export {
  createAgentNodeHandler,
  agentNodeOutcome,
  parseReviewVerdict,
  type AgentNodeStatus,
  type AgentNodeDeps,
} from "./agent-node-handler.js";

export {
  createGithubActionHandler,
  ciOutcome,
  type CiConclusion,
  type GithubActionDeps,
} from "./github-action-handler.js";

export {
  createDetectHandler,
  DETECT_SUMMARY_MAX_CHARS,
  type DetectorFn,
  type DetectRun,
} from "./detect-handler.js";

export {
  runClaudeCode,
  isClaudeCodeAvailable,
  type ClaudeCodeResult,
  type LogUsage,
} from "./claude-code.js";

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
  RelayExecutor,
  type RelayResult,
} from "./relay/relay-executor.js";
export { RELAY_SCRIPT } from "./relay/relay-script.js";

export {
  createValidateHandler,
  type ValidateHandlerDeps,
} from "./validate-handler.js";
