export * from "./project/index.js";
export {
  createTask as createPipelineTask,
  retryTask as retryPipelineTask,
  getTask as getPipelineTask,
  listTasks as listPipelineTasks,
  recordEvent as recordTaskEvent,
  setTaskStatus,
  updateTaskStatus,
  cancelTask as cancelPipelineTask,
  escalateTask as escalatePipelineTask,
  reviseTask as revisePipelineTask,
  markTaskMerged,
  type CreateTaskInput,
  type CreatedTask,
  type RetriedTask,
  type PipelineTaskRow,
  type TaskListRow,
} from "./pipeline-tasks.js";
// "./pipeline-task-actions.js"'s retryTask/cancelTask/escalateTask/reviseTask/markTaskMerged and "./pipeline-task-status.js"'s setTaskStatus/setTaskStatusIf/ALLOWED_TASK_COLUMNS are already re-exported above via pipeline-tasks.js.
export { enforceRepoTrustForTaskType } from "./pipeline-task-trust.js";
export {
  chunkFile,
  buildIngestedChunkMetadata,
  CHUNKER_VERSION,
  type Chunk,
} from "./chunker.js";
export * from "./chunker-symbols.js";
export * from "./chunker-ast.js";
export { redactSecrets } from "./redact.js";
export {
  tokenSecretKey,
  perTaskName,
  needsToken,
  catalogLookupName,
  injectRepoToken,
  perTaskStation,
} from "./cluster/per-task-token.js";
export { preserveUnownedFields } from "./cluster/preserve-unowned.js";
export { AGENT_MAX_TURNS } from "./cluster/agent-limits.js";
export { CONTEXT_BOOTSTRAP } from "./agents/recipe-prompt.js";
export type { AgentNodeStatus } from "./cluster/agent-node-status.js";
export { statusFromAgentCr } from "./cluster/agent-node-status.js";
export type {
  AgentApi,
  AgentLister,
  AgentStatusReader,
  TokenProvisioner,
  TokenCleanup,
} from "./cluster/cluster-ports.js";
export type {
  AgentPodInfo,
  PodSummary,
  RunningPodInfo,
  PodLogSource,
} from "./cluster/pod-logs-port.js";
export {
  ClusterAgentClient,
  HttpAgentApi,
  HttpPodLogSource,
  HttpTokenCleanup,
  HttpAgentCatalog,
} from "./cluster/cluster-agent-client.js";
export {
  writeEpisode,
  writeEpisodeWithCuration,
  type WriteEpisodeDeps,
  type CurationDeps,
} from "./episode-writer.js";
export {
  loadApprovalConfig,
  requiresApproval,
  getApprovalLabel,
  getApprovalConfig,
  type ApprovalConfig,
} from "./approval-config.js";
export {
  extractSection,
  stripCommentsAndWhitespace,
  sectionIsEmpty,
} from "./pr-section-check.js";
export {
  getQueryEmbedding,
  buildVertexUrl,
} from "./embeddings/embedding-service.js";
export { resolveAgentId } from "./agent-id.js";
export * from "./index-spec-trace.js";
export { mapWithLimit } from "./concurrency/map-with-limit.js";
export { Llm } from "./llm/llm.js";
export { selectProvider } from "./llm/select-provider.js";
export { NoLlmProvider } from "./llm/no-llm-provider.js";
export { FakeLlm } from "./llm/fake-llm.js";
export { AnthropicProvider } from "./llm/anthropic-provider.js";
export { OpenAiProvider } from "./llm/openai-provider.js";
export { OllamaProvider } from "./llm/ollama-provider.js";
export { CliProvider } from "./llm/cli-provider.js";
export type {
  LlmProvider,
  LlmCompleteRequest,
  LlmCompletion,
  LlmToolRequest,
  LlmToolResult,
  LlmUsage,
} from "./llm/llm-provider.js";
export {
  parseTasks,
  inferPhaseDependencies,
  syncTasksToDb,
  specSlugFromBranch,
  type ParsedTask,
} from "./tasks.js";
export {
  insertEvent,
  eventRepo,
  SOURCES,
  type EventInsert,
  type EventSource,
} from "./events.js";
export {
  formatTrailers,
  formatValidatesTrailer,
  parseTrailers,
  parseValidatesTrailers,
  type Trailers,
  type ProvenanceRef,
} from "./commit-trailers.js";
export {
  StationInputSchema,
  parseStationInput,
  serializeStationInput,
  type StationInput,
} from "./station-input.js";
export {
  resolveDarkFactorySettings,
  resolveExecutionImage,
  trustMeets,
  DEFAULT_AUTO_MERGE_PATHS,
  DEFAULT_EXECUTION_IMAGE,
  type DarkFactorySettings,
  type DarkFactoryAutoMerge,
  type DarkFactoryExecution,
  type ExecutionImageSettings,
  type ResolvedDarkFactorySettings,
  type TrustLevel,
  type ReviewMode,
  type CreateIssueMode,
  type NotifyChannel,
} from "./dark-factory-settings.js";
export type {
  PipelineTask,
  TaskStatus,
  TaskType,
  PRDetails,
  PRStatus,
} from "./types.js";
export {
  parseReferences,
  linkifyMarkdown,
  type RefContext,
  type Segment,
} from "./references.js";
// Re-exported via index-spec-content.js: "./spec-summary.js" "./spec-blocks.js" "./spec-segment.js" "./spec-sentence-split.js" "./spec-status.js" "./spec-status-coverage.js" "./spec-status-flip.js" "./test-paths.js" "./test-command-manifest.js" "./test-report.js" "./ingest-workflow.js" "./trace-impact-workflow.js" "./spec-link-parser.js" "./spec-judge.js" "./spec-judge-llm.js"
export * from "./index-spec-content.js";

export {
  memoryStore,
  setMemoryStore,
  selectMemoryStore,
  hasConnect,
  type MemoryStore,
  type MemoryTxClient,
  type WriteResult,
  type PgPool,
  type DgraphClientPort,
  type DgraphTxn,
} from "./memory-store.js";
export { PostgresMemoryStore } from "./postgres-memory-store.js";
export { ShadowMemoryStore } from "./shadow-memory-store.js";
export { DgraphMemoryStore } from "./dgraph-memory-store.js";
export {
  rrfMerge,
  RRF_K,
  computeTransferScore,
  diversify,
  scoreImportance,
  type MemorySearchResult,
  type RankedItem,
} from "./memory-ranking.js";

export {
  backfillMemoryToDgraph,
  type BackfillReport,
} from "./backfill-memory.js";

export {
  evaluateParityGates,
  jaccard,
  meanTopkJaccard,
  type ParitySummary,
  type GateResult,
} from "./backfill-parity.js";

export { auditDgraphAcl } from "./dgraph-acl-policy.js";
export { createDgraphClient } from "./dgraph-client.js";
export {
  classifyFile,
  dropIngestExcluded,
  type ContentType,
} from "./content-classify.js";
export { TEST_COMMAND_SETUP_PROMPT } from "./test-command-setup-prompt.js";
export { LORE_TESTS_INSTRUCTION } from "./lore-tests-instruction.js";

// Pure-domain helpers relocated from agent/src/lib (Slice 2).
export { allPathsMatch, matchingPatterns } from "./path-match.js";
export {
  classifyError,
  errorMessage,
  failureHint,
  isFailureCategory,
  isPermanentFailure,
  summarizeFailures,
  TaskFailure,
  type FailureCategory,
  type StepFailure,
  type ClassifiedFailure,
} from "./error-classify.js";
export {
  isTransientInfraFailure,
  MAX_INFRA_RETRIES,
} from "./k8s-pod-failure.js";
export { isBusinessHours } from "./business-hours.js";
export { isAlreadyExistsError } from "./k8s-errors.js";
export {
  agentsNamespace,
  kubeConfigSource,
  loadKube,
  type KubeConfigSource,
  type KubeConfigLoader,
} from "./kube-config.js";
export { prFooter } from "./pr-body.js";
export {
  decideOnboard,
  onboardLockKey,
  onboardTaskDescription,
  toOnboardState,
  IN_FLIGHT_TASK_STATUSES,
  ONBOARD_REPO_STATE_SQL,
  ONBOARD_IN_FLIGHT_TASK_SQL,
  type OnboardState,
  type OnboardBlock,
  type OnboardDecision,
  type OnboardRepoRow,
  type OnboardTaskRow,
} from "./onboard-guard.js";
// Branch-lease backends (Slice 3) — used by the agent supervisor until it moves to project.leases (Slice 4).
export {
  DbLeaseBackend,
  FileLeaseBackend,
  type LeaseBackend,
  type LeasePool,
  type AcquireResult,
} from "./project/leases/lease-backends.js";
export {
  buildReviewFixDescription,
  formatReviewFeedback,
} from "./review-feedback.js";
// Deterministic repo validation (lint/typecheck), relocated from mcp-server for the BYO toolchain sidecar (ADR-025).
export {
  detectTooling,
  runValidation,
  formatValidationOutput,
  localValidationExec,
  type ValidationStep,
  type RepoTooling,
  type StepResult,
  type ValidationResult,
  type ValidationExec,
} from "./repo-validation/repo-validation.js";

// The implementation loop's backlog: pure queue ordering + label taxonomy (FR1).
export {
  selectNextIssue,
  orderBacklog,
  PRIORITY_LABELS,
  LORE_BLOCKED_LABEL,
  BACKLOG_LABEL_SEED,
  type PriorityLabel,
} from "./backlog/index.js";
