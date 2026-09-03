/** Lossless source reconstruction FROM the graph: the read-only inverse of the Block projection — pulls Block nodes, sorts by ordinal (Dgraph doesn't guarantee order), rejoins via reassembleBlocks; `recomputeFile` is the single authoritative path, keyed by `Block.file_path`, serving specs and ADRs alike. */

import type { DgraphClientPort, Block } from "./deps.js";
import { reassembleBlocks } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";

/** A Block node's projected fields as read back from Dgraph. */
type BlockRow = {
  "Block.ordinal": number;
  "Block.kind": Block["kind"];
  "Block.text"?: string;
  "Block.level"?: number;
};

/** Pure inverse of the row read: maps rows to `Block[]`, sorts by ordinal, rejoins with `reassembleBlocks`; `null` for zero rows (never-projected) vs. `""` for a genuinely empty document. Holds no I/O, so it's unit-testable without Dgraph. */
export function sourceFromBlockRows(rows: BlockRow[]): string | null {
  if (rows.length === 0) {
    return null;
  }

  const blocks: Block[] = rows.map((row) => ({
    ordinal: row["Block.ordinal"],
    kind: row["Block.kind"],
    text: row["Block.text"] ?? "",
    ...(row["Block.level"] !== undefined ? { level: row["Block.level"] } : {}),
  }));

  const sortedBlocks = [...blocks].sort(
    (left, right) => left.ordinal - right.ordinal,
  );

  return reassembleBlocks(sortedBlocks);
}

/** Source reconstruction by `Block.file_path` — works for any ingested document (specs, ADRs) with no dependence on a Spec parent; reads the file's Block rows and hands them to {@link sourceFromBlockRows}. */
export async function recomputeFile(
  repo: string,
  filePath: string,
  dgraph: DgraphClientPort,
): Promise<string | null> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($fp: string, $repo: string){
        blocks(func: eq(Block.file_path, $fp)) @filter(eq(Block.repo, $repo)){
          Block.ordinal Block.kind Block.text Block.level
        }
      }`,
      { $fp: filePath, $repo: repo },
    );

    return (res.data?.blocks ?? []) as BlockRow[];
  });

  return sourceFromBlockRows(rows);
}
