/**
 * spec-traceability-graph — lossless source reconstruction FROM the graph.
 *
 * The read-only inverse of the Block projection: pull a document's Block nodes,
 * sort them by ordinal (Dgraph does not guarantee result order), and rejoin with
 * `reassembleBlocks`. For any projected document this returns the verbatim
 * original source; a never-projected file (no Block nodes) returns `null`, while
 * a genuinely empty document (one `blank` block) returns `""`. `recomputeFile` is
 * the single authoritative reconstruction path (by `Block.file_path`);
 * `recomputeSpecFile` is a thin alias for spec call sites — specs carry
 * `Block.file_path` too, so it just delegates.
 */

import type { DgraphClientPort, Block } from "@re-cinq/lore-shared";
import { reassembleBlocks } from "@re-cinq/lore-shared";
import { withTxn } from "./dgraph-upsert.js";

/** A Block node's projected fields as read back from Dgraph. */
type BlockRow = {
  "Block.ordinal": number;
  "Block.kind": Block["kind"];
  "Block.text"?: string;
  "Block.level"?: number;
};

/**
 * Pure inverse of the row read: maps Block rows to `Block[]`, sorts by ordinal
 * (Dgraph does not guarantee result order), and rejoins with `reassembleBlocks`.
 * Returns `null` for zero rows (a never-projected file), distinguishing it from a
 * genuinely empty document (one `blank` block → `""`). Holds no I/O so the
 * not-found / ordering / reassemble decision is unit-testable without Dgraph.
 */
export function sourceFromBlockRows(rows: BlockRow[]): string | null {
  if (rows.length === 0) return null;

  const blocks: Block[] = rows.map((row) => ({
    ordinal: row["Block.ordinal"],
    kind: row["Block.kind"],
    text: row["Block.text"] ?? "",
    ...(row["Block.level"] !== undefined ? { level: row["Block.level"] } : {}),
  }));

  const sortedBlocks = [...blocks].sort((left, right) => left.ordinal - right.ordinal);
  return reassembleBlocks(sortedBlocks);
}

/**
 * Reconstructs a spec's source from its Block layer. Specs carry
 * `Block.file_path`, so this delegates to {@link recomputeFile} — the single
 * authoritative reconstruction path — rather than re-deriving the same logic via
 * the `~Block.spec` reverse edge.
 */
export async function recomputeSpecFile(
  repo: string,
  filePath: string,
  dgraph: DgraphClientPort,
): Promise<string | null> {
  return recomputeFile(repo, filePath, dgraph);
}

/**
 * Generic source reconstruction by `Block.file_path` — works for any ingested
 * document (specs, ADRs) whose Block layer is keyed by file_path, with no
 * dependence on a Spec parent. Reads the file's Block rows, then hands them to
 * {@link sourceFromBlockRows}: `null` for a never-projected file (no rows), `""`
 * for a genuinely empty document, else the verbatim reassembled source.
 */
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
