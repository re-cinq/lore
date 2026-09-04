// Barrel for spec-content parsing/status/coverage/link-judging: re-exported from index.ts to keep the top-level barrel under the file-size limit.
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
export { splitSentences } from "./spec-sentence-split.js";
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
