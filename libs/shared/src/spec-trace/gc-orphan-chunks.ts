/** Orphan chunk GC; deletes dropped chunks only if nothing else owns them; pass excludeOwnerUids to GC before owner deletion. */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

/** A garbage-collectable chunk-like node and its ownership edges. */
type GcNodeType = "TestChunk" | "CodeChunk" | "File";

/** Reverse/forward edges that, if present, mean a node is still owned and must not be GC'd. */
const CHUNK_OWNER_EDGES: Record<GcNodeType, string[]> = {
  // TestChunk.coverage outlives any single spec link; link owners include both Statements and AcceptanceCriteria.
  TestChunk: [
    "~Statement.validated_by",
    "~AcceptanceCriterion.validated_by",
    "TestChunk.coverage",
  ],
  CodeChunk: [
    "~Statement.implemented_by",
    "~AcceptanceCriterion.implemented_by",
    "~Coverage.covers",
  ],
  // A coverage-source File is owned by any Coverage still covering it.
  File: ["~Coverage.covers"],
};

/** Deletes chunks no longer in currentUids and not owned by CHUNK_OWNER_EDGES; pass excludeOwnerUids to GC before deletion. */
export interface OrphanSweep {
  /** Chunk uids the owner pointed at before this write. */
  previous: string[];
  /** Chunk uids it points at now; anything in `previous` but not here is a candidate. */
  current: string[];
  /** Owners about to be deleted, so their edges do not count as ownership. */
  excludeOwners?: Set<string>;
}

export async function gcOrphanChunks(
  dgraph: DgraphClientPort,
  nodeType: GcNodeType,
  { previous, current: currentUids, excludeOwners }: OrphanSweep,
): Promise<void> {
  const excludeOwnerUids = excludeOwners ?? new Set<string>();
  const current = new Set(currentUids);
  const dropped = previous.filter((uid) => !current.has(uid));
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
      // A `[uid]` edge is array; single-cardinality `uid` edge is bare object; either means owned.
      const node = (res.data.node?.[0] ?? {}) as Record<string, unknown>;
      const isCountedOwner = (value: unknown): boolean => {
        if (value == null) {
          return false;
        }

        if (typeof value !== "object" || !("uid" in value)) {
          // Fail safe: unreadable uid still counts; only identified uids may be discounted.
          return true;
        }

        return !excludeOwnerUids.has(String(value.uid));
      };
      const isOwned = (value: unknown): boolean =>
        Array.isArray(value)
          ? value.some(isCountedOwner)
          : isCountedOwner(value);

      return ownerEdges.some((_, index) => isOwned(node[`owner${index}`]));
    });

    if (!stillOwned) {
      await withTxn(dgraph, (txn) =>
        txn.mutate({ deleteNquads: `<${uid}> * * .`, commitNow: true }),
      );
    }
  }
}
