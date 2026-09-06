/** ADR source-layer projection; projects Block nodes; ADR node holds content_hash freshness gate. */

import { createHash } from "node:crypto";
import type { SourceDocument } from "./project-blocks.js";
import type { ProjectionOptions } from "./project-spec-file.js";
import type { DgraphClientPort } from "./deps.js";
import {
  projectDocumentBlocks,
  pruneOrphanBlocksByFile,
} from "./project-blocks.js";
import { withTxn, upsertByXid, deletePredicate } from "./dgraph-upsert.js";
import { adrNumberFromPath } from "./adr-refs.js";

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

    return res.data.found?.[0]?.["ADR.content_hash"] as string | undefined;
  });
}

// ADRs are not embedded, so `embed` in the options is ignored; the shape matches IngestKindDef.project alongside projectSpecFile.
export async function projectAdrFile(
  { repo, filePath, content }: SourceDocument,
  dgraph: DgraphClientPort,
  { force = false }: ProjectionOptions = {},
): Promise<{ projected: boolean }> {
  const contentHash = sha256(content);
  const xid = `${repo}|${filePath}`;

  if (!force && (await readAdrContentHash(dgraph, xid)) === contentHash) {
    return { projected: false };
  }

  const number = adrNumberFromPath(filePath);
  const adrUid = await upsertByXid(dgraph, "ADR", xid, {
    "ADR.repo": repo,
    "ADR.file_path": filePath,
    ...(number != null ? { "ADR.number": number } : {}),
  });

  // Hash is receipt; cleared now, persisted after writes succeed; mid-file failure re-projects.
  await deletePredicate(dgraph, adrUid, "ADR.content_hash");

  await upsertByXid(dgraph, "Repo", repo, { "Repo.adrs": [{ uid: adrUid }] });
  const validXids = await projectDocumentBlocks(dgraph, {
    repo,
    filePath,
    content,
  });

  await pruneOrphanBlocksByFile(dgraph, repo, filePath, validXids);

  await upsertByXid(dgraph, "ADR", xid, { "ADR.content_hash": contentHash });

  return { projected: true };
}
