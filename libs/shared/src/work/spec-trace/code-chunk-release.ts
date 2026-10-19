/** Removing a code chunk by hand, because Dgraph does not cascade: a chunk's own reference edges go with it, a definition still called shrinks to a placeholder its callers keep, and a placeholder nobody calls is deleted. */

import type {
  DgraphClientPort,
  UidRef,
} from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";

/** The predicates that make a chunk a definition rather than a placeholder; a definition that leaves its file while still called sheds exactly these. */
const DEFINING_PREDICATES = [
  "CodeChunk.references",
  "CodeChunk.file_path",
  "CodeChunk.start_line",
  "CodeChunk.end_line",
  "CodeChunk.content_hash",
];

interface ChunkState extends UidRef {
  refs?: UidRef[];
  callers?: number;
  "CodeChunk.start_line"?: number;
}

/** The placeholders a chunk stopped referencing are released, since it may have been the last caller keeping one alive. */
export async function releaseDropped(
  dgraph: DgraphClientPort,
  previous: string[],
  current: string[],
): Promise<void> {
  const kept = new Set(current);

  for (const dropped of previous.filter((uid) => !kept.has(uid))) {
    await releasePlaceholder(dgraph, dropped);
  }
}

/** A definition that left its file: with callers left it shrinks to a placeholder, so they rebind when it returns; with none it is deleted. Either way its own reference edges go, and so do placeholders only it kept alive. */
export async function releaseChunk(
  dgraph: DgraphClientPort,
  uid: string,
): Promise<void> {
  const node = await readChunk(dgraph, uid);
  const predicates = node?.callers ? DEFINING_PREDICATES : ["*"];

  await deletePredicates(dgraph, uid, predicates);

  for (const target of referencedUids(node)) {
    await releasePlaceholder(dgraph, target);
  }
}

/** Deletes a placeholder nobody references any more; a defined chunk is its file's to remove, not its callers'. */
async function releasePlaceholder(
  dgraph: DgraphClientPort,
  uid: string,
): Promise<void> {
  const node = await readChunk(dgraph, uid);

  if (node && node["CodeChunk.start_line"] === undefined && !node.callers) {
    await deletePredicates(dgraph, uid, ["*"]);
  }
}

export function referencedUids(node: ChunkState | undefined): string[] {
  return (node?.refs ?? []).map((ref) => ref.uid);
}

export async function readChunk(
  dgraph: DgraphClientPort,
  uid: string,
): Promise<ChunkState | undefined> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($uid: string) {
        node(func: uid($uid)) {
          uid
          CodeChunk.start_line
          refs: CodeChunk.references { uid }
          callers: count(~CodeChunk.references)
        }
      }`,
      { $uid: uid },
    );

    return (res.data.node ?? [])[0] as unknown as ChunkState | undefined;
  });
}

async function deletePredicates(
  dgraph: DgraphClientPort,
  uid: string,
  predicates: string[],
): Promise<void> {
  const nquads = predicates.map((predicate) =>
    predicate === "*" ? `<${uid}> * * .` : `<${uid}> <${predicate}> * .`,
  );

  await withTxn(dgraph, (txn) =>
    txn.mutate({ deleteNquads: nquads.join("\n"), commitNow: true }),
  );
}
