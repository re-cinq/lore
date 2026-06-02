export { chunkFile, type Chunk } from './chunker.js';
export { redactSecrets } from './redact.js';
export { parseTasks, inferPhaseDependencies, type ParsedTask } from './tasks.js';
export {
  formatTrailers,
  parseTrailers,
  lastStageOnBranch,
  type Trailers,
} from './commit-trailers.js';
export {
  resolveDarkFactorySettings,
  trustMeets,
  DEFAULT_AUTO_MERGE_PATHS,
  type DarkFactorySettings,
  type DarkFactoryAutoMerge,
  type ResolvedDarkFactorySettings,
  type TrustLevel,
  type ReviewMode,
  type CreateIssueMode,
  type NotifyChannel,
} from './dark-factory-settings.js';
export type {
  PipelineTask,
  TaskStatus,
  TaskType,
  PRDetails,
  PRStatus,
} from './types.js';
export {
  parseReferences,
  linkifyMarkdown,
  type RefContext,
  type Segment,
} from './references.js';
export {
  parseSpecTitle,
  extractSummary,
  reassembleSpec,
} from './spec-summary.js';
export {
  segmentStatements,
  classifyByHeuristic,
  buildIntroOrdinals,
  type Statement,
  type StatementKind,
  type Testability,
  type UntestableCategory,
  type Classification,
} from './spec-segment.js';
export {
  isTestFile,
  normalizeTestName,
} from './test-paths.js';
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
} from './spec-judge.js';
