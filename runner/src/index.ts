// @re-cinq/lore-runner — the portable execution kernel.
//
// The task-execution kernel (workflow graph executor, node handlers, workflow
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
  executeGraph,
  resumeFromTrailers,
  IterationMaxExceededError,
  type StageOutcome,
  type NodeResult,
  type NodeContext,
  type NodeHandler,
  type NodeHandlers,
  type IterationMaxExceededInfo,
  type ExecuteOptions,
  type ExecutionSummary,
} from "./graph-executor.js";

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
  runClaudeCode,
  isClaudeCodeAvailable,
  type ClaudeCodeResult,
  type LogUsage,
} from "./claude-code.js";

export {
  loadWorkflowDir,
  loadWorkflowFile,
  parseWorkflow,
  WorkflowLoadError,
  type Workflow,
  type WorkflowNode,
  type WorkflowEdge,
  type EdgeConditionValue,
} from "./loader.js";

export { loadBuiltinWorkflows } from "./builtin-workflows.js";
