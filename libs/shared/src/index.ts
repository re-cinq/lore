export * from "./outbound/project/index.js";
export {
  createTask as createPipelineTask,
  retryTask as retryPipelineTask,
  getTask as getPipelineTask,
  listTasks as listPipelineTasks,
  recordEvent as recordTaskEvent,
  setTaskStatus,
  cancelTask as cancelPipelineTask,
  escalateTask as escalatePipelineTask,
  reviseTask as revisePipelineTask,
  markTaskMerged,
  type TaskListRow,
} from "./domain/pipeline-tasks.js";
// "./pipeline-task-actions.js" and "./pipeline-task-status.js" ride through pipeline-tasks.js/pipeline-task-core.js re-exports above.
export * from "./domain/pipeline-task-core.js";
export { enforceRepoTrustForTaskType } from "./domain/pipeline-task-trust.js";
export {
  chunkFile,
  buildIngestedChunkMetadata,
  CHUNKER_VERSION,
} from "./work/chunker.js";
export * from "./work/chunker-symbols.js";
export * from "./work/chunker-ast.js";
export * from "./work/chunk-primitives.js";
export { redactSecrets } from "./lib/redact.js";
export {
  tokenSecretKey,
  perTaskName,
  needsToken,
  catalogLookupName,
  injectRepoToken,
  perTaskStation,
} from "./outbound/cluster/per-task-token.js";
export { preserveUnownedFields } from "./outbound/cluster/preserve-unowned.js";
export { AGENT_MAX_TURNS } from "./outbound/cluster/agent-limits.js";
export { CONTEXT_BOOTSTRAP } from "./domain/agents/recipe-prompt.js";
export type { AgentNodeStatus } from "./outbound/cluster/agent-node-status.js";
export { statusFromAgentCr } from "./outbound/cluster/agent-node-status.js";
export type {
  AgentApi,
  AgentLister,
  AgentStatusReader,
  TokenProvisioner,
  TokenCleanup,
} from "./outbound/cluster/cluster-ports.js";
export type {
  AgentPodInfo,
  PodSummary,
  RunningPodInfo,
  PodLogSource,
} from "./outbound/cluster/pod-logs-port.js";
export {
  ClusterAgentClient,
  HttpAgentApi,
  HttpPodLogSource,
  HttpTokenCleanup,
  HttpAgentCatalog,
} from "./outbound/cluster/cluster-agent-client.js";
export {
  writeEpisode,
  writeEpisodeWithCuration,
  type WriteEpisodeDeps,
  type CurationDeps,
} from "./work/episode-writer.js";
export {
  loadApprovalConfig,
  requiresApproval,
  getApprovalLabel,
  getApprovalConfig,
  type ApprovalConfig,
} from "./domain/approval-config.js";
export {
  extractSection,
  stripCommentsAndWhitespace,
  sectionIsEmpty,
} from "./work/pr-section-check.js";
export {
  getQueryEmbedding,
  buildVertexUrl,
} from "./outbound/embeddings/embedding-service.js";
export { resolveAgentId } from "./outbound/agent-id.js";
export * from "./work/index-spec-trace.js";
export { mapWithLimit } from "./lib/concurrency/map-with-limit.js";
export { Llm } from "./outbound/llm/llm.js";
export { selectProvider } from "./outbound/llm/select-provider.js";
export { NoLlmProvider } from "./outbound/llm/no-llm-provider.js";
export { FakeLlm } from "./outbound/llm/fake-llm.js";
export { AnthropicProvider } from "./outbound/llm/anthropic-provider.js";
export { OpenAiProvider } from "./outbound/llm/openai-provider.js";
export { OllamaProvider } from "./outbound/llm/ollama-provider.js";
export { CliProvider } from "./outbound/llm/cli-provider.js";
export type {
  LlmProvider,
  LlmCompleteRequest,
  LlmCompletion,
  LlmToolRequest,
  LlmToolResult,
  LlmUsage,
} from "./outbound/llm/llm-provider.js";
export {
  parseTasks,
  inferPhaseDependencies,
  syncTasksToDb,
  specSlugFromBranch,
  type ParsedTask,
} from "./domain/tasks.js";
export {
  insertEvent,
  eventRepo,
  SOURCES,
  type EventInsert,
  type EventSource,
} from "./outbound/events.js";
export {
  formatTrailers,
  formatValidatesTrailer,
  parseTrailers,
  parseValidatesTrailers,
  type Trailers,
  type ProvenanceRef,
} from "./domain/commit-trailers.js";
export {
  StationInputSchema,
  parseStationInput,
  serializeStationInput,
  type StationInput,
} from "./domain/station-input.js";
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
} from "./domain/dark-factory-settings.js";
export type {
  PipelineTask,
  TaskStatus,
  TaskType,
  PRDetails,
  PRStatus,
} from "./domain/types.js";
export {
  parseReferences,
  linkifyMarkdown,
  type RefContext,
  type Segment,
} from "./domain/references.js";
// Re-exported via index-spec-content.js: "./spec-summary.js" "./spec-blocks.js" "./spec-segment.js" "./spec-sentence-split.js" "./spec-status.js" "./spec-status-coverage.js" "./spec-status-flip.js" "./test-paths.js" "./test-command-manifest.js" "./test-report.js" "./ingest-workflow.js" "./trace-impact-workflow.js" "./spec-link-parser.js" "./spec-judge.js" "./spec-judge-llm.js"
export * from "./work/index-spec-content.js";

export {
  memoryStore,
  setMemoryStore,
  selectMemoryStore,
} from "./outbound/memory-store.js";
// MemoryRecord is deliberately not re-exported here: project/index.js already exports an unrelated MemoryRecord (memory-port.ts).
export {
  hasConnect,
  type MemoryStore,
  type MemoryTxClient,
  type WriteResult,
  type PgPool,
  type DgraphClientPort,
  type DgraphTxn,
} from "./domain/memory-store-types.js";
export {
  PostgresMemoryStore,
  memoryListScope,
} from "./outbound/postgres-memory-store.js";
export { ShadowMemoryStore } from "./outbound/shadow-memory-store.js";
export {
  DgraphMemoryStore,
  type GraphHop,
} from "./outbound/dgraph-memory-store.js";
export { toVectorLiteral, newUid } from "./outbound/dgraph-vector.js";
export { withTxn } from "./outbound/dgraph-txn.js";
export {
  findLatestLive,
  type MemoryRow,
} from "./outbound/dgraph-memory-queries.js";
export { flattenHops } from "./outbound/dgraph-graph-hops.js";
export { contradictionNodes } from "./outbound/dgraph-fact-contradictions.js";
export { searchMemories as dgraphSearchMemories } from "./outbound/dgraph-search.js";
export { writeMemory as dgraphWriteMemory } from "./outbound/dgraph-memory-crud.js";
export { persistFact as dgraphPersistFact } from "./outbound/dgraph-fact-episode.js";
export { upsertEdge as dgraphUpsertEdge } from "./outbound/dgraph-graph-edges.js";
export {
  rrfMerge,
  RRF_K,
  computeTransferScore,
  diversify,
  scoreImportance,
  type MemorySearchResult,
  type RankedItem,
} from "./domain/memory-ranking.js";

export {
  backfillMemoryToDgraph,
  type BackfillReport,
} from "./work/backfill-memory.js";

export {
  evaluateParityGates,
  jaccard,
  meanTopkJaccard,
  type ParitySummary,
  type GateResult,
} from "./work/backfill-parity.js";

export { auditDgraphAcl } from "./outbound/dgraph-acl-policy.js";
export { createDgraphClient } from "./outbound/dgraph-client.js";
export {
  classifyFile,
  dropIngestExcluded,
  type ContentType,
} from "./domain/content-classify.js";
export { TEST_COMMAND_SETUP_PROMPT } from "./lib/test-command-setup-prompt.js";
export { LORE_TESTS_INSTRUCTION } from "./lib/lore-tests-instruction.js";

// Pure-domain helpers relocated from agent/src/lib (Slice 2).
export { allPathsMatch, matchingPatterns } from "./lib/path-match.js";
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
} from "./lib/error-classify.js";
export {
  isTransientInfraFailure,
  MAX_INFRA_RETRIES,
} from "./outbound/k8s-pod-failure.js";
export { isBusinessHours } from "./lib/business-hours.js";
export { isAlreadyExistsError } from "./outbound/k8s-errors.js";
export {
  agentsNamespace,
  kubeConfigSource,
  loadKube,
  type KubeConfigSource,
  type KubeConfigLoader,
} from "./outbound/kube-config.js";
export { prFooter } from "./domain/pr-body.js";
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
} from "./work/onboard-guard.js";
// Branch-lease backends (Slice 3) — used by the agent supervisor until it moves to project.leases (Slice 4).
export {
  DbLeaseBackend,
  FileLeaseBackend,
  type LeaseBackend,
  type LeasePool,
  type AcquireResult,
} from "./outbound/project/leases/lease-backends.js";
export {
  buildReviewFixDescription,
  formatReviewFeedback,
} from "./work/review-feedback.js";
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
} from "./work/repo-validation/repo-validation.js";

// The implementation loop's backlog: pure queue ordering + label taxonomy (FR1).
export {
  selectNextIssue,
  orderBacklog,
  PRIORITY_LABELS,
  LORE_BLOCKED_LABEL,
  BACKLOG_LABEL_SEED,
  type PriorityLabel,
} from "./work/backlog/index.js";
