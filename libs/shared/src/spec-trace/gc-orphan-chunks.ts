/**
 * spec-traceability-graph — orphan chunk garbage collection. When an owner edge
 * set is REPLACED (a statement's `validated_by`/`implemented_by`, or a Coverage's
 * `covers`), the chunks that dropped out must be deleted ONLY if nothing else
 * still owns them. Shared by `project-spec-file` (spec-link drops) and
 * `ingest-coverage` (coverage-range drops) so the ownership rules live in one
 * place. Reads owners AFTER the edge replace, so a still-shared chunk reports its
 * remaining owners and survives.
 */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

/** A garbage-collectable chunk-like node and its ownership edges. */
type GcNodeType = "TestChunk" | "CodeChunk" | "File";

/** Reverse/forward edges that, if present, mean a node is still owned and must not be GC'd. */
const CHUNK_OWNER_EDGES: Record<GcNodeType, string[]> = {
  // TestChunk.coverage (forward) means coverage is attached to this file-scoped
  // node — it outlives any single spec link and must not be GC'd.
  TestChunk: ["~Statement.validated_by", "TestChunk.coverage"],
  CodeChunk: ["~Statement.implemented_by", "~Coverage.covers"],
  // A coverage-source File is owned by any Coverage still covering it.
  File: ["~Coverage.covers"],
};

/**
 * Deletes each chunk in `previousUids` no longer in `currentUids` AND no longer
 * owned by any {@link CHUNK_OWNER_EDGES} edge. Call AFTER replacing the dropping
 * owner's edge so the ownership query sees the post-drop state.
 */
export async function gcOrphanChunks(
  dgraph: DgraphClientPort,
  nodeType: GcNodeType,
  previousUids: string[],
  currentUids: string[],
): Promise<void> {
  const current = new Set(currentUids);
  const dropped = previousUids.filter((uid) => !current.has(uid));
  const ownerEdges = CHUNK_OWNER_EDGES[nodeType];
  for (const uid of dropped) {
    const stillOwned = await withTxn(dgraph, async (txn) => {
      const blocks = ownerEdges
        .map((edge, index) => `owner${index}: ${edge} { uid }`)
        .join("\n");
      const res = await txn.queryWithVars(
        `query q($uid: string) { node(func: uid($uid)) { ${blocks} } }`,
        { $uid: uid },
      );
      // A `[uid]` edge comes back as an array; a single-cardinality `uid` edge
      // (e.g. TestChunk.coverage) comes back as a bare object — either present
      // shape means the chunk is still owned.
      const node = (res.data?.node?.[0] ?? {}) as Record<string, unknown>;
      const isOwned = (value: unknown): boolean =>
        Array.isArray(value) ? value.length > 0 : value != null;
      return ownerEdges.some((_, index) => isOwned(node[`owner${index}`]));
    });
    if (!stillOwned) {
      await withTxn(dgraph, (txn) =>
        txn.mutate({ deleteNquads: `<${uid}> * * .`, commitNow: true }),
      );
    }
  }
}
