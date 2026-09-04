/** Phase 1 projection unit: projects one spec file into the Dgraph traceability graph (Repo/Spec/Section/Statement/TestChunk/CodeChunk/AcceptanceCriterion/Block), gated by a `Spec.content_hash` freshness check. */

import { createHash } from "node:crypto";
import type { SourceDocument } from "./project-blocks.js";
import {
  segmentStatements,
  buildIntroOrdinals,
  getQueryEmbedding,
} from "./deps.js";
import type { DgraphClientPort } from "./deps.js";
import { withTxn, upsertByXid, deletePredicate } from "./dgraph-upsert.js";
import { pruneOrphans } from "./project-spec-file-links.js";
import {
  projectFeature,
  projectSections,
  projectAcceptanceCriteria,
  projectBlocks,
  projectStatements,
} from "./project-spec-file-nodes.js";

/** Embeds a statement/criterion's text into its node's float32vector; injected as a seam so projection stays deterministic + offline in tests. */
export type EmbedFn = (text: string) => Promise<number[] | null>;

/** Dgraph float32vector literal: the array serialized as a `"[a,b,c]"` string. */
export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/** Fixed addressing context for one spec-file projection, threaded into each per-facet projector instead of a four-arg prefix. */
export interface ProjectionContext {
  dgraph: DgraphClientPort;
  repo: string;
  filePath: string;
  specUid: string;
  embed: EmbedFn;
}

/** Hex sha256 — the content-hash idiom shared by Spec, Statement, and AcceptanceCriterion nodes. */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The spec's first H1 heading text (the title a sentence-link's `<spec>` segment matches), or null. */
function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+?)\s*$/m);

  return match ? match[1] : null;
}

/** True for any heading-variant title used across specs for acceptance/success/independent-test criteria — those segments project as AcceptanceCriterion, not Statement. */
export function isAcceptanceCriteriaHeading(heading: string | null): boolean {
  if (!heading) {
    return false;
  }
  const norm = heading
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[:\s]+$/g, "")
    .trim();

  return (
    /acceptance criteria/.test(norm) ||
    norm === "success criteria" ||
    norm === "independent test criteria"
  );
}

/** Reads the persisted Spec.content_hash for an xid, or undefined when no Spec exists yet. */
async function readSpecContentHash(
  dgraph: DgraphClientPort,
  specXid: string,
): Promise<string | undefined> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query find($xid: string) { found(func: eq(Spec.xid, $xid), first: 1) { Spec.content_hash } }`,
      { $xid: specXid },
    );

    return res.data?.found?.[0]?.["Spec.content_hash"] as string | undefined;
  });
}

/** Knobs on one projection: the embedder to use and whether to bypass the content-hash freshness gate. */
export interface ProjectionOptions {
  embed?: EmbedFn;
  force?: boolean;
}

/** True when the persisted Spec.content_hash already matches, so re-projection can be skipped. */
async function isSpecUnchanged(
  dgraph: DgraphClientPort,
  specXid: string,
  force: boolean,
  contentHash: string,
): Promise<boolean> {
  if (force) {
    return false;
  }

  return (await readSpecContentHash(dgraph, specXid)) === contentHash;
}

/** The Spec node's optional own fields — title and feature link, both absent for a bare/root-level spec. */
interface SpecOwnFields {
  title: string | null;
  featureUid: string | undefined;
}

/** Upserts the Spec node's own scalar/edge fields (title and feature link are optional). */
async function upsertSpecNode(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
  { title, featureUid }: SpecOwnFields,
): Promise<string> {
  return upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
    "Spec.repo": repo,
    "Spec.file_path": filePath,
    ...(title !== null ? { "Spec.title": title } : {}),
    ...(featureUid ? { "Spec.feature": { uid: featureUid } } : {}),
  });
}

export async function projectSpecFile(
  { repo, filePath, content }: SourceDocument,
  dgraph: DgraphClientPort,
  { embed = getQueryEmbedding, force = false }: ProjectionOptions = {},
): Promise<{ projected: boolean }> {
  const contentHash = sha256(content);

  const specXid = `${repo}|${filePath}`;

  if (await isSpecUnchanged(dgraph, specXid, force, contentHash)) {
    return { projected: false };
  }

  const title = extractTitle(content);
  const featureUid = await projectFeature(dgraph, repo, filePath);
  const specUid = await upsertSpecNode(dgraph, repo, filePath, {
    title,
    featureUid,
  });

  // Clear the hash now, persist only after every child write succeeds — otherwise a mid-file death leaves the file permanently skipped with partial children.
  await deletePredicate(dgraph, specUid, "Spec.content_hash");

  await upsertByXid(dgraph, "Repo", repo, { "Repo.specs": [{ uid: specUid }] });

  const context: ProjectionContext = { dgraph, repo, filePath, specUid, embed };
  const segments = segmentStatements(content);
  const introOrdinals = buildIntroOrdinals(segments);
  const acSegments = segments.filter((segment) =>
    isAcceptanceCriteriaHeading(segment.enclosingHeading),
  );
  const statementSegments = segments.filter(
    (segment) => !isAcceptanceCriteriaHeading(segment.enclosingHeading),
  );

  const sectionUidByHeading = await projectSections(context, statementSegments);

  await projectStatements(
    context,
    statementSegments,
    introOrdinals,
    sectionUidByHeading,
  );

  const validStatementXids = new Set(
    statementSegments.map(
      (segment) => `${repo}|${filePath}|${segment.ordinal}`,
    ),
  );

  await pruneOrphans(context, "Statement", validStatementXids);

  const validSectionXids = new Set(
    Array.from(
      { length: sectionUidByHeading.size },
      (_, ordinal) => `${repo}|${filePath}|${ordinal}`,
    ),
  );

  await pruneOrphans(context, "Section", validSectionXids, "Spec.sections");

  await projectAcceptanceCriteria(context, acSegments);
  const validAcXids = new Set(
    acSegments.map((segment) => `${repo}|${filePath}|ac|${segment.ordinal}`),
  );

  await pruneOrphans(
    context,
    "AcceptanceCriterion",
    validAcXids,
    "Spec.acceptance_criteria",
  );

  await projectBlocks(context, content);

  await upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
    "Spec.content_hash": contentHash,
  });

  return { projected: true };
}
