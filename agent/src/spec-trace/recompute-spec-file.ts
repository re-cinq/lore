/**
 * spec-traceability-graph — lossless source reconstruction FROM the graph.
 *
 * The read-only inverse of `projectSpecFile`'s Block projection: pull the
 * Spec's Block nodes via the `~Block.spec` reverse edge, sort them by ordinal
 * (Dgraph does not guarantee child order), and rejoin with `reassembleBlocks`.
 * For any projected document this returns the verbatim original source.
 */

import type { DgraphClientPort, Block } from "@re-cinq/lore-shared";
import { reassembleBlocks } from "@re-cinq/lore-shared";
import { withTxn } from "./dgraph-upsert.js";

/** A Block node's projected fields as read back from Dgraph via `~Block.spec`. */
type BlockRow = {
  "Block.ordinal": number;
  "Block.kind": Block["kind"];
  "Block.text"?: string;
  "Block.level"?: number;
};

export async function recomputeSpecFile(
  repo: string,
  filePath: string,
  dgraph: DgraphClientPort,
): Promise<string> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($xid: string){
        spec(func: eq(Spec.xid, $xid)){
          blocks: ~Block.spec { Block.ordinal Block.kind Block.text Block.level }
        }
      }`,
      { $xid: `${repo}|${filePath}` },
    );
    return (res.data?.spec?.[0]?.blocks ?? []) as BlockRow[];
  });

  const blocks: Block[] = rows.map((row) => ({
    ordinal: row["Block.ordinal"],
    kind: row["Block.kind"],
    text: row["Block.text"] ?? "",
    ...(row["Block.level"] !== undefined ? { level: row["Block.level"] } : {}),
  }));

  const sortedBlocks = [...blocks].sort((left, right) => left.ordinal - right.ordinal);
  return reassembleBlocks(sortedBlocks);
}
