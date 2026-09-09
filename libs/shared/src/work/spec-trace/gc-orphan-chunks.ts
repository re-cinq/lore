/** Orphan chunk GC; deletes dropped chunks only if nothing else owns them; pass excludeOwnerUids to GC before owner deletion. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";

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
    await gcOneChunk(dgraph, uid, ownerEdges, excludeOwnerUids);
  }
}

/** Deletes one dropped chunk unless something other than the excluded owners still points at it. */
async function gcOneChunk(
  dgraph: DgraphClientPort,
  uid: string,
  ownerEdges: readonly string[],
  excludeOwnerUids: Set<string>,
): Promise<void> {
  const stillOwned = await hasOtherOwner(
    dgraph,
    uid,
    ownerEdges,
    excludeOwnerUids,
  );

  if (stillOwned) {
    return;
  }

  await withTxn(dgraph, (txn) =>
    txn.mutate({ deleteNquads: `<${uid}> * * .`, commitNow: true }),
  );
}

/** Whether anything still points at this node, ignoring the owners the caller is dropping. */
async function hasOtherOwner(
  dgraph: DgraphClientPort,
  uid: string,
  ownerEdges: readonly string[],
  excludeOwnerUids: Set<string>,
): Promise<boolean> {
  const node = await readOwnerEdges(dgraph, uid, ownerEdges);

  return ownerEdges.some((_, index) =>
    isOwnedEdge(node[`owner${index}`], excludeOwnerUids),
  );
}

/** Reads every owner edge of one node in a single query, aliased `owner0…ownerN` in `ownerEdges` order. */
async function readOwnerEdges(
  dgraph: DgraphClientPort,
  uid: string,
  ownerEdges: readonly string[],
): Promise<Record<string, unknown>> {
  return withTxn(dgraph, async (txn) => {
    const blocks = ownerEdges
      .map((edge, index) => `owner${index}: ${edge} { uid }`)
      .join("\n");
    const res = await txn.queryWithVars(
      `query q($uid: string) { node(func: uid($uid)) { ${blocks} } }`,
      { $uid: uid },
    );
    const nodes = (res.data.node ?? []) as Record<string, unknown>[];

    return nodes[0] ?? {};
  });
}

/** A `[uid]` edge arrives as an array and a single-cardinality one as a bare object; both mean owned. */
function isOwnedEdge(value: unknown, excludeOwnerUids: Set<string>): boolean {
  return Array.isArray(value)
    ? value.some((entry) => isCountedOwner(entry, excludeOwnerUids))
    : isCountedOwner(value, excludeOwnerUids);
}

/** FAIL SAFE: an owner edge whose uid cannot be read counts as an owner — only an identified uid may be discounted, so an unreadable answer keeps the node rather than deleting something still in use. */
function isCountedOwner(
  value: unknown,
  excludeOwnerUids: Set<string>,
): boolean {
  if (value == null) {
    return false;
  }

  if (typeof value !== "object" || !("uid" in value)) {
    return true;
  }

  return !excludeOwnerUids.has(String(value.uid));
}
