/**
 * spec-traceability-graph — ADR source-layer projection.
 *
 * The ADR artifact joins the lossless Block layer that specs already enjoy.
 * Projects one Block node per source block (xid =
 * `${repo}|${filePath}|block|${ordinal}`), keyed by `Block.file_path` so
 * `recomputeFile` can pull them back without a Spec parent. A minimal ADR node
 * (xid `${repo}|${filePath}`) holds the `content_hash` freshness gate so an
 * unchanged re-projection is a pure no-op (`{ projected: false }`), matching
 * `projectSpecFile`; ADR number/title/status metadata is a LATER overlay. Talks
 * only to the injected DgraphClientPort.
 */

import { createHash } from "node:crypto";
import type { DgraphClientPort } from "./deps.js";
import { projectDocumentBlocks, pruneOrphanBlocksByFile } from "./project-blocks.js";
import { withTxn, upsertByXid } from "./dgraph-upsert.js";
import { adrNumberFromPath } from "./adr-refs.js";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Reads the persisted ADR.content_hash for an xid, or undefined when no ADR exists yet. */
async function readAdrContentHash(dgraph: DgraphClientPort, xid: string): Promise<string | undefined> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query find($xid: string) { found(func: eq(ADR.xid, $xid), first: 1) { ADR.content_hash } }`,
      { $xid: xid },
    );
    return res.data?.found?.[0]?.["ADR.content_hash"] as string | undefined;
  });
}

export async function projectAdrFile(
  repo: string,
  filePath: string,
  content: string,
  dgraph: DgraphClientPort,
): Promise<{ projected: boolean }> {
  const contentHash = sha256(content);
  const xid = `${repo}|${filePath}`;
  if ((await readAdrContentHash(dgraph, xid)) === contentHash) {
    return { projected: false };
  }

  const number = adrNumberFromPath(filePath);
  const adrUid = await upsertByXid(dgraph, "ADR", xid, {
    "ADR.repo": repo,
    "ADR.file_path": filePath,
    "ADR.content_hash": contentHash,
    ...(number != null ? { "ADR.number": number } : {}),
  });
  await upsertByXid(dgraph, "Repo", repo, { "Repo.adrs": [{ uid: adrUid }] });
  const validXids = await projectDocumentBlocks(dgraph, repo, filePath, content);
  await pruneOrphanBlocksByFile(dgraph, repo, filePath, validXids);
  return { projected: true };
}
