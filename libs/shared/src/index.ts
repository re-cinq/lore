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
  markTaskMerged,
  type CreateTaskInput,
  type CreatedTask,
  type RetriedTask,
  type PipelineTaskRow,
  type TaskListRow,
} from "./pipeline-tasks.js";
export {
  chunkFile,
  buildIngestedChunkMetadata,
  CHUNKER_VERSION,
  type Chunk,
} from "./chunker.js";
export { redactSecrets } from "./redact.js";
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
export { projectSpecFile } from "./spec-trace/project-spec-file.js";
export { projectAdrFile } from "./spec-trace/project-adr-file.js";
export {
  descriptorsFromVitestList,
  groupRunsByFile,
  type VitestListEntry,
} from "./spec-trace/trace-descriptors.js";
export {
  bindDescriptorsToSpecLinks,
  type SpecSource,
} from "./spec-trace/bind-descriptors-to-spec-links.js";
export { resolveTestLines } from "./spec-trace/resolve-test-lines.js";
export {
  parseSpecAnchor,
  parseSpecAnchors,
  type SpecAnchor,
} from "./spec-trace/spec-anchor.js";
export { mapWithLimit } from "./concurrency/map-with-limit.js";
export {
  ingestSpecTrace,
  type SpecTraceOutcome,
} from "./spec-trace/ingest-spec-trace.js";
export {
  assembleTraceDocument,
  fetchTraceDocument,
  listSpecDocuments,
  listAdrDocuments,
  listAllSpecDocuments,
  listAllAdrDocuments,
  listSpecSummaries,
  listAdrSummaries,
  type SpecSummary,
  type AdrSummary,
  type TraceDocument,
  type TraceStatement,
  type TraceSection,
  type TraceLinkRef,
  type TraceCoverage,
  type StatementState as TraceStatementState,
} from "./spec-trace/assemble-trace-document.js";
export {
  fetchSpecGraph,
  fetchSpecRing,
  flattenSpecGraph,
  flattenSpecRing,
  mergePersistentFeatures,
  specLabel,
  adrLabel,
  UNGROUPED_SECTION,
  type SpecGraph,
  type SpecGraphNode,
  type SpecGraphLink,
  type PersistentFeatureNode,
  type SpecRing,
  type RingSection,
  type RingStatement,
} from "./spec-trace/spec-graph.js";
export {
  planTraceUnits,
  runTraceUnits,
  type TraceUnit,
} from "./spec-trace/trace-units.js";
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
  computeImpact,
  buildImpactAnnotations,
  buildImpactComment,
  IMPACT_COMMENT_MARKER,
  parseRanges,
  type ChangedRange,
  type ImpactReport,
  type ImpactStatement,
  type OrphanStatement,
  type ImpactAnnotation,
} from "./spec-trace/trace-impact.js";
export {
  readGraphBaseline,
  stampGraphBaseline,
  type GraphBaseline,
} from "./spec-trace/graph-baseline.js";
export {
  assembleGraphContext,
  fetchGraphContext,
  DEFAULT_LIMIT as GRAPH_CONTEXT_DEFAULT_LIMIT,
  type GraphContextBlock,
  type GraphContextStatement,
  type GraphContextResult,
  type GraphSignal,
} from "./spec-trace/graph-context.js";
export {
  runIngestGraph,
  selectIngestFiles,
  summarizeIngest,
  chunkGlobsForKind,
  INGEST_KINDS,
  type IngestKind,
  type IngestGraphParams,
  type IngestGraphSummary,
  type IngestGraphPorts,
  type IngestKindDef,
} from "./spec-trace/ingest-graph-task.js";
export {
  parseTasks,
  inferPhaseDependencies,
  syncTasksToDb,
  specSlugFromBranch,
  type ParsedTask,
} from "./tasks.js";
export { insertEvent, eventRepo, type EventInsert } from "./events.js";
export {
  formatTrailers,
  formatValidatesTrailer,
  parseTrailers,
  parseValidatesTrailers,
  type Trailers,
  type ProvenanceRef,
} from "./commit-trailers.js";
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
export {
  parseSpecTitle,
  extractSummary,
  reassembleSpec,
} from "./spec-summary.js";
export {
  segmentBlocks,
  reassembleBlocks,
  type Block,
  type BlockKind,
} from "./spec-blocks.js";
export {
  segmentStatements,
  classifyByHeuristic,
  buildIntroOrdinals,
  type Statement,
  type StatementKind,
  type Testability,
  type UntestableCategory,
  type Classification,
} from "./spec-segment.js";
export {
  docStatusPill,
  parseDocStatus,
  statusTier,
  rewriteAdrStatusRow,
  rewriteSpecStatusRow,
  type DocKind,
  type DocStatus,
  type DocStatusPill,
  type RewriteStatusOptions,
  type StatusBucket,
  type StatusTier,
} from "./spec-status.js";
export {
  coverageStatusLabel,
  coverageTier,
  expectedStatus,
  statementCoverage,
  statusLabel,
  unlinkedTestableStatements,
  type CoverageTier,
  type StatementCoverage,
  type UnlinkedStatement,
} from "./spec-status-coverage.js";
export {
  openSpecStatusFlipPr,
  type StatusFlipOptions,
  type StatusFlipResult,
} from "./spec-status-flip.js";
export { isTestFile, isDocFile, normalizeTestName } from "./test-paths.js";
export {
  parseTestCommandManifest,
  resolveTestCommandManifest,
  decideTestInterfaceCheck,
  substituteSelector,
  type TestCommandManifest,
  type CoverageFormat,
  type TestInterfaceCheck,
} from "./test-command-manifest.js";
export {
  parseTestDescriptors,
  parseRunResult,
  type TestDescriptor,
  type CoveredChunk,
  type RunResult,
  type TaggedRunResult,
} from "./test-report.js";
export {
  LORE_INGEST_WORKFLOW_PATH,
  LORE_INGEST_WORKFLOW_VERSION,
  LORE_INGEST_WORKFLOW_CONTENT,
  ingestWorkflowStatus,
  parseIngestWorkflowVersion,
  type IngestWorkflowStatus,
} from "./ingest-workflow.js";
export {
  TRACE_IMPACT_WORKFLOW_PATH,
  TRACE_IMPACT_WORKFLOW_VERSION,
  TRACE_IMPACT_WORKFLOW_CONTENT,
  traceImpactWorkflowStatus,
  parseTraceImpactWorkflowVersion,
  type TraceImpactWorkflowStatus,
} from "./trace-impact-workflow.js";
export {
  parseTestLinksInStatement,
  parseCodeLinksInStatement,
  linksForStatements,
  findMisplacedCoverageLinks,
  resolveLinkPath,
  type SpecLinkRef,
  type TestLinkRef,
  type CodeLinkRef,
} from "./spec-link-parser.js";
export {
  specFeatureSlug,
  hasDirectoryAffinity,
  cosineSimilarity,
  matchedAssertion,
  deriveTestName,
  parseEmbedding,
  selectCandidates,
  staleLinkKeys,
  staleStatementOrdinals,
  argmaxByTest,
  hashSpecContent,
  MAX_CANDIDATES_PER_SPEC,
  EMBEDDING_THRESHOLD,
  JUDGE_SCORE_THRESHOLD,
  type Assertion,
  type MatchKind,
  type SpecTestLink,
  type TestChunk,
  type JudgeCandidate,
  type SpecInput,
  type CandidateSelection,
  type Judgment,
} from "./spec-judge.js";

export { extractAssertions, type LlmJobContext } from "./spec-judge-llm.js";

export {
  memoryStore,
  setMemoryStore,
  selectMemoryStore,
  type MemoryStore,
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
  summarizeFailures,
  TaskFailure,
  type FailureCategory,
  type StepFailure,
  type ClassifiedFailure,
} from "./error-classify.js";
export { isBusinessHours } from "./business-hours.js";
export { isAlreadyExistsError } from "./k8s-errors.js";
export {
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
// Branch-lease backends (Slice 3) — the agent supervisor imports these until
// it moves to the runner package and switches to project.leases (Slice 4).
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
// Deterministic repo validation (lint/typecheck), relocated from mcp-server so
// the runner kernel can drive it in a BYO toolchain sidecar (ADR-025).
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
