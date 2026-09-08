/** ADR source-layer projection; projects Block nodes; ADR node holds content_hash freshness gate. */

import { createHash } from "node:crypto";
import type { SourceDocument } from "./project-blocks.js";
import type { ProjectionOptions } from "./project-spec-file.js";
import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import {
  projectDocumentBlocks,
  pruneOrphanBlocksByFile,
} from "./project-blocks.js";
import {
  withTxn,
  upsertByXid,
  deletePredicate,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import { adrNumberFromPath } from "./adr-refs.js";
import { firstOf } from "./uid-refs.js";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Reads the persisted ADR.content_hash for an xid, or undefined when no ADR exists yet. */
async function readAdrContentHash(
  dgraph: DgraphClientPort,
  xid: string,
): Promise<string | undefined> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query find($xid: string) { found(func: eq(ADR.xid, $xid), first: 1) { ADR.content_hash } }`,
      { $xid: xid },
    );

    return firstOf(res.data.found)?.["ADR.content_hash"] as string | undefined;
  });
}

/** Upserts the ADR node and hangs it off its Repo, with the content hash CLEARED — the hash is a receipt persisted only after every child write succeeds, so a mid-file failure re-projects instead of staying permanently skipped. */
async function projectAdrNode(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
  xid: string,
): Promise<void> {
  const number = adrNumberFromPath(filePath);
  const adrUid = await upsertByXid(dgraph, "ADR", xid, {
    "ADR.repo": repo,
    "ADR.file_path": filePath,
    ...(number != null ? { "ADR.number": number } : {}),
  });

  await deletePredicate(dgraph, adrUid, "ADR.content_hash");
  await upsertByXid(dgraph, "Repo", repo, { "Repo.adrs": [{ uid: adrUid }] });
}

/** Projects the ADR's lossless Block source layer, then sweeps the Blocks this run did not produce. */
async function projectAdrBlocks(
  dgraph: DgraphClientPort,
  document: SourceDocument,
): Promise<void> {
  const { repo, filePath } = document;
  const validXids = await projectDocumentBlocks(dgraph, document);

  await pruneOrphanBlocksByFile(dgraph, repo, filePath, validXids);
}

// ADRs are not embedded, so `embed` in the options is ignored; the shape matches IngestKindDef.project alongside projectSpecFile.
export async function projectAdrFile(
  document: SourceDocument,
  dgraph: DgraphClientPort,
  { force = false }: ProjectionOptions = {},
): Promise<{ projected: boolean }> {
  const { repo, filePath, content } = document;
  const contentHash = sha256(content);
  const xid = `${repo}|${filePath}`;

  if (!force && (await readAdrContentHash(dgraph, xid)) === contentHash) {
    return { projected: false };
  }

  await projectAdrNode(dgraph, repo, filePath, xid);
  await projectAdrBlocks(dgraph, document);
  await upsertByXid(dgraph, "ADR", xid, { "ADR.content_hash": contentHash });

  return { projected: true };
}
