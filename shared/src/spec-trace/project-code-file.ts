/**
 * spec-traceability-graph — code ingest projector. Parses one source file into
 * symbol descriptors ({@link ./parse-code-chunks}) and upserts a CodeChunk node
 * per symbol, keyed `${repo}|${filePath}|${symbol_name}`. These are the nodes
 * coverage's `Coverage.covers` resolves against (by file_path + overlapping line
 * range) and the drift checker hashes — previously nothing produced them.
 *
 * Shares the generic create-or-update primitive ({@link ./dgraph-upsert}) with
 * the spec/ADR projectors. Talks only to the injected DgraphClientPort.
 */

import type { DgraphClientPort } from "./deps.js";
import { upsertByXid } from "./dgraph-upsert.js";
import { parseCodeChunks } from "./parse-code-chunks.js";

export async function projectCodeFile(
  repo: string,
  filePath: string,
  content: string,
  dgraph: DgraphClientPort,
): Promise<{ projected: boolean }> {
  const chunks = parseCodeChunks(filePath, content);
  for (const chunk of chunks) {
    await upsertByXid(dgraph, "CodeChunk", `${repo}|${filePath}|${chunk.symbol_name}`, {
      "CodeChunk.repo": repo,
      "CodeChunk.file_path": filePath,
      "CodeChunk.symbol_name": chunk.symbol_name,
      "CodeChunk.symbol_type": chunk.symbol_type,
      "CodeChunk.start_line": chunk.start_line,
      "CodeChunk.end_line": chunk.end_line,
      "CodeChunk.content_hash": chunk.content_hash,
    });
  }
  return { projected: chunks.length > 0 };
}
