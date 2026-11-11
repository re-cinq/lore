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
  markTaskMerged,
  type TaskListRow,
} from "./domain/pipeline-tasks.js";
// "./pipeline-task-actions.js" and "./pipeline-task-status.js" ride through pipeline-tasks.js/pipeline-task-core.js re-exports above.
export * from "./domain/pipeline-task-core.js";
export * from "./domain/task-description.js";
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
export * from "./domain/agents/index.js";
export {
  writeEpisode,
  writeEpisodeWithCuration,
  type WriteEpisodeDeps,
  type CurationDeps,
} from "./work/episode-writer.js";
export * from "./work/artifact-copy.js";
export * from "./domain/approval-config.js";
export * from "./work/pr-section-check.js";
export * from "./outbound/embeddings/index.js";
export { resolveAgentId } from "./outbound/agent-id.js";
// Re-exported via index-spec-trace.js: "./work/spec-trace/project-spec-file.js" "./work/spec-trace/project-adr-file.js" "./domain/spec-trace/trace-descriptors.js" "./work/spec-trace/bind-descriptors-to-spec-links.js" "./work/spec-trace/resolve-test-lines.js" "./domain/spec-trace/spec-anchor.js" "./work/spec-trace/ingest-spec-trace.js" "./work/spec-trace/graph-retention.js" "./work/spec-trace/overlay.js" "./outbound/spec-trace/tests-covering.js" "./outbound/spec-trace/code-callers.js" "./work/spec-trace/project-code-file.js" "./work/spec-trace/failure-nodes.js" "./domain/spec-trace/trace-scope.js" "./work/spec-trace/prune-removed-docs.js" "./work/spec-trace/prune-test-files.js" "./domain/spec-trace/assemble-trace-document.js" "./outbound/spec-trace/trace-document-listing.js" "./outbound/spec-trace/spec-graph.js" "./work/spec-trace/trace-units.js" "./work/spec-trace/trace-impact.js" "./work/spec-trace/graph-baseline.js" "./outbound/spec-trace/graph-context.js" "./work/spec-trace/ingest-graph-task.js" "./work/spec-trace/ingest-patterns.js"
export * from "./work/index-spec-trace.js";
export { mapWithLimit } from "./lib/concurrency/map-with-limit.js";
export { Llm } from "./outbound/llm/llm.js";
export { selectProvider } from "./outbound/llm/select-provider.js";
export { NoLlmProvider } from "./outbound/llm/no-llm-provider.js";
export { FakeLlm } from "./outbound/llm/fake-llm.js";
export { AnthropicProvider } from "./outbound/llm/anthropic-provider.js";
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
  insertEvent,
  eventRepo,
  SOURCES,
  type EventInsert,
  type EventSource,
} from "./outbound/events.js";
export * from "./domain/commit-trailers.js";
export * from "./domain/station-input.js";
// TrustLevel is re-exported via domain/models/index.js below.
export * from "./domain/dod/index.js";
export type {
  PipelineTask,
  TaskStatus,
  TaskType,
  PRDetails,
  PRStatus,
} from "./domain/types.js";
export * from "./domain/references.js";
// Re-exported via index-spec-content.js: "./work/spec-summary.js" "./domain/spec-blocks.js" "./domain/spec-segment.js" "./domain/spec-sentence-split.js" "./domain/spec-status.js" "./work/spec-status-coverage.js" "./domain/test-paths.js" "./domain/test-command-manifest.js" "./domain/test-report.js" "./work/ingest-workflow.js" "./work/trace-impact-workflow.js" "./domain/spec-link-parser.js" "./domain/spec-judge.js" "./work/spec-judge-llm.js"
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
export { runInTransaction } from "./outbound/db/pg-transaction.js";
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
export { setupSpecTraceSchema } from "./outbound/setup-spec-trace-schema.js";
export {
  classifyFile,
  dropIngestExcluded,
  type ContentType,
} from "./domain/content-classify.js";
export { planChunkPrune } from "./domain/chunk-prune.js";
export { stripCoverageLinks } from "./domain/spec-link-strip.js";
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
export { isBusinessHours } from "./lib/business-hours.js";
export { loreTaskIdOf, prFooter } from "./domain/pr-body.js";
export { clampPrTitle } from "./domain/pr-title.js";
export {
  ciConclusionOf,
  ciJudgedSha,
  externalCheckRuns,
  failedCheckRuns,
  SKIP_CI_MARKERS,
} from "./outbound/project/pulls/check-runs.js";
export { summarizeFailedChecks } from "./outbound/project/pulls/failure-summary.js";
export {
  decideOnboard,
  onboardLockKey,
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
export * from "./work/onboard-content.js";
// Branch-lease backends (Slice 3) — used by the agent supervisor until it moves to project.leases (Slice 4).
export {
  DbLeaseBackend,
  FileLeaseBackend,
  type LeaseBackend,
  type LeasePool,
  type AcquireResult,
} from "./outbound/project/leases/lease-backends.js";
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
export * from "./work/backlog/index.js";

// Subject-key formatting functions for API query construction (FR6.51).
export {
  planSubject,
  detectSubject,
  reviewSubject,
  ingestSubject,
} from "./outbound/project/assembly-runs/subject-keys.js";

// Sub-barrel exports — directories covered by their own index.ts.
export * from "./domain/models/index.js";
export * from "./domain/feature-planning/index.js";
export * from "./domain/loops/index.js";
export * from "./domain/task-types/index.js";
export * from "./domain/utopia/index.js";
export * from "./domain/spec-trace/index.js";
export * from "./outbound/floor/index.js";
export * from "./outbound/otel/index.js";
export * from "./outbound/spec-trace/index.js";
export * from "./outbound/utopia/index.js";
export * from "./transport/http/index.js";
export * from "./work/agent-stream/index.js";
export * from "./work/changelog/index.js";
export * from "./work/context-builder/index.js";
export * from "./work/digest/index.js";
export * from "./work/feature-planning/index.js";
export * from "./work/housekeeping/index.js";
export * from "./work/onboard/index.js";
export * from "./work/review/index.js";
export * from "./work/spec-tickets/index.js";
export * from "./work/spec-trace/index.js";
export * from "./work/spec-upkeep/index.js";
export * from "./work/utopia/index.js";

// Direct exports for files not covered by a sub-barrel.
export * from "./domain/agent-defaults/agent-default-file.js";
export * from "./domain/agents/model-harness.js";
export * from "./domain/agents/skills-source.js";
export * from "./domain/anchor-hash.js";
export * from "./domain/blocked-reason.js";
export * from "./domain/codeowners.js";
export * from "./domain/context-model.js";
export * from "./domain/context-template.js";
export * from "./domain/digest-settings.js";
export * from "./domain/dod-verdict.js";
export * from "./domain/github-installation/installation-from-github.js";
export * from "./domain/key-terms.js";
export * from "./domain/knowledge-backend.js";
export * from "./domain/lore-ontology.js";
export * from "./domain/pipeline-task-actions.js";
export * from "./domain/pipeline-task-status.js";
export * from "./domain/repo-context.js";
export * from "./domain/run-graph.js";
export * from "./domain/spec-judge-signals.js";
export * from "./lib/backoff.js";
export * from "./lib/dgraph-test-gate.js";
export * from "./lib/djb2.js";
export * from "./lib/enforce.js";
export * from "./lib/internal-token.js";
export * from "./lib/is-record.js";
export * from "./lib/paginate.js";
export * from "./lib/process-entry.js";
export * from "./lib/repo-root.js";
export * from "./lib/required-env.js";
export * from "./lib/row.js";
export * from "./lib/secret-equals.js";
export * from "./lib/truncate-for-storage.js";
export * from "./lib/wire-schema.js";
export * from "./outbound/db/pg-pool.js";
export * from "./outbound/google/access-token.js";
export * from "./outbound/llm/index.js";
export * from "./outbound/postgres-memory-upsert.js";
export * from "./outbound/setup-spec-trace-schema.schema.js";
export * from "./outbound/setup-spec-trace-schema.schema-types.js";

export * from "./work/ci-wait/round-brief.js";
export * from "./work/repo-validation/repo-validation-detect.js";
export * from "./work/scheduler/cron-emitters.js";
export * from "./work/scheduler/cron-scheduler.js";

// Explicit re-exports to resolve star-export ambiguities between sub-barrels.
export type { Chunk } from "./work/chunk-primitives.js";
export type { Assert } from "./lib/row.js";
export type { Statement } from "./domain/spec-segment.js";
export type { UnlinkedStatement } from "./work/spec-status-coverage.js";
export type { TestReport } from "./domain/models/test-report.js";
export type { DriftedStatement } from "./work/spec-trace/format-drift-report.js";
