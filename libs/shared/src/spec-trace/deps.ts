/**
 * Local re-export funnel for the spec-trace subtree. spec-trace lives in
 * `shared` now, and a package file cannot import its own `@re-cinq/lore-shared`
 * barrel, so the moved files import their shared siblings by relative path
 * through here — one funnel keeps each moved file's change to a single
 * `@re-cinq/lore-shared` → `./deps.js` swap.
 */
export {
  segmentStatements,
  classifyByHeuristic,
  buildIntroOrdinals,
  type Classification,
} from "../spec-segment.js";
export {
  parseTestLinksInStatement,
  parseCodeLinksInStatement,
  type SpecLinkRef,
} from "../spec-link-parser.js";
export { segmentBlocks, reassembleBlocks, type Block } from "../spec-blocks.js";
export type { DgraphClientPort, DgraphTxn } from "../memory-store.js";
export { cosineSimilarity, parseEmbedding } from "../spec-judge.js";
export { getQueryEmbedding } from "../embeddings/embedding-service.js";
export type { ProvenanceRef } from "../commit-trailers.js";
export type {
  CoveredChunk,
  TaggedRunResult,
  TestDescriptor,
} from "../test-report.js";

/** A Dgraph query result entry carrying just a node uid. */
export interface UidRef {
  uid: string;
}
