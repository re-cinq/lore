/**
 * spec-traceability-graph — ADR source-layer projection.
 *
 * The ADR artifact joins the lossless Block layer that specs already enjoy.
 * Projects one Block node per source block (xid =
 * `${repo}|${filePath}|block|${ordinal}`), keyed by `Block.file_path` so
 * `recomputeFile` can pull them back without a Spec parent. No ADR metadata node
 * and no number/title/status parse yet — that's a LATER facet; this is the
 * Block layer only. Talks only to the injected DgraphClientPort.
 */

import type { DgraphClientPort } from "@re-cinq/lore-shared";
import { projectDocumentBlocks, pruneOrphanBlocksByFile } from "./project-blocks.js";

export async function projectAdrFile(
  repo: string,
  filePath: string,
  content: string,
  dgraph: DgraphClientPort,
): Promise<void> {
  const validXids = await projectDocumentBlocks(dgraph, repo, filePath, content);
  await pruneOrphanBlocksByFile(dgraph, repo, filePath, validXids);
}
