// Barrel for the spec-traceability graph (./spec-trace/*): re-exported from index.ts to keep the top-level barrel under the file-size limit.
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
export {
  ingestSpecTrace,
  type SpecTraceOutcome,
} from "./spec-trace/ingest-spec-trace.js";
export {
  deleteSpecSubtree,
  deleteAdrSubtree,
} from "./spec-trace/prune-removed-docs.js";
export { pruneTestFiles } from "./spec-trace/prune-test-files.js";
export {
  assembleTraceDocument,
  type TraceDocument,
  type TraceStatement,
  type TraceSection,
  type TraceLinkRef,
  type TraceCoverage,
  type StatementState as TraceStatementState,
} from "./spec-trace/assemble-trace-document.js";
export {
  fetchTraceDocument,
  listSpecDocuments,
  listAdrDocuments,
  listAllSpecDocuments,
  listAllAdrDocuments,
  listSpecSummaries,
  listAdrSummaries,
  type SpecSummary,
  type AdrSummary,
} from "./spec-trace/trace-document-listing.js";
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
export {
  computeImpact,
  buildImpactAnnotations,
  buildImpactComment,
  IMPACT_COMMENT_MARKER,
  parseRanges,
  type ChangedRange,
  type ChangedDoc,
  type ImpactOptions,
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
