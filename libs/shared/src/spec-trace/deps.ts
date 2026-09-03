/** Local re-export funnel for the spec-trace subtree: a package file can't import its own `@re-cinq/lore-shared` barrel, so moved files import shared siblings through here — one funnel, one `@re-cinq/lore-shared` → `./deps.js` swap per file. */
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
