/** Phase 1 projection unit: projects one spec file into the Dgraph traceability graph (Repo/Spec/Section/Statement/TestChunk/CodeChunk/AcceptanceCriterion/Block), gated by a `Spec.content_hash` freshness check. */

import { createHash } from "node:crypto";
import type { SourceDocument } from "./project-blocks.js";
import {
  segmentStatements,
  parseTestLinksInStatement,
  parseCodeLinksInStatement,
  buildIntroOrdinals,
  classifyByHeuristic,
  getQueryEmbedding,
} from "./deps.js";
import type { Classification, DgraphClientPort, SpecLinkRef } from "./deps.js";

/** Embeds a statement/criterion's text into its node's float32vector; injected as a seam so projection stays deterministic + offline in tests. */
type EmbedFn = (text: string) => Promise<number[] | null>;

/** Dgraph float32vector literal: the array serialized as a `"[a,b,c]"` string. */
function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
import {
  withTxn,
  upsertByXid,
  replaceEdge,
  deletePredicate,
  type SpecTraceNodeType,
} from "./dgraph-upsert.js";
import { parseAdrRefs } from "./adr-refs.js";
import {
  projectDocumentBlocks,
  pruneOrphanBlocksByFile,
} from "./project-blocks.js";
import { repoRelativeLinkTarget } from "./link-target-path.js";
import { fileScopedTestChunkXid } from "./test-chunk-identity.js";
import { gcOrphanChunks } from "./gc-orphan-chunks.js";
import { featureDirOf } from "./feature-dir.js";

/** Fixed addressing context for one spec-file projection, threaded into each per-facet projector instead of a four-arg prefix. */
interface ProjectionContext {
  dgraph: DgraphClientPort;
  repo: string;
  filePath: string;
  specUid: string;
  embed: EmbedFn;
}

/** Hex sha256 — the content-hash idiom shared by Spec, Statement, and AcceptanceCriterion nodes. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The spec's first H1 heading text (the title a sentence-link's `<spec>` segment matches), or null. */
function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+?)\s*$/m);

  return match ? match[1] : null;
}

/** Upserts the Feature node for this spec's owning folder, returning its uid for `Spec.feature` (undefined for a root-level spec with no feature folder). */
async function projectFeature(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<string | undefined> {
  const featureDir = featureDirOf(filePath);

  if (featureDir === null) {
    return undefined;
  }

  return upsertByXid(dgraph, "Feature", `${repo}|${featureDir}`, {
    "Feature.repo": repo,
    "Feature.path": featureDir,
    "Feature.title": featureDir.split("/").pop() ?? featureDir,
  });
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

/** One segment as produced by {@link segmentStatements}. */
type SpecSegment = ReturnType<typeof segmentStatements>[number];

/** Upserts a Section per unique enclosing heading in document order, points `Spec.sections` at them, and returns heading→uid so statements can attach. */
async function projectSections(
  context: ProjectionContext,
  segments: SpecSegment[],
): Promise<Map<string, string>> {
  const { dgraph, repo, filePath, specUid } = context;
  const uniqueHeadings = [
    ...new Set(
      segments
        .map((segment) => segment.enclosingHeading)
        .filter((heading): heading is string => heading !== null),
    ),
  ];
  const sectionUidByHeading = new Map<string, string>();

  for (const [sectionOrdinal, heading] of uniqueHeadings.entries()) {
    const sectionUid = await upsertByXid(
      dgraph,
      "Section",
      `${repo}|${filePath}|${sectionOrdinal}`,
      {
        "Section.heading": heading,
        "Section.ordinal": sectionOrdinal,
        "Section.spec": { uid: specUid },
      },
    );

    sectionUidByHeading.set(heading, sectionUid);
  }

  if (sectionUidByHeading.size) {
    await upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
      "Spec.sections": [...sectionUidByHeading.values()].map((uid) => ({
        uid,
      })),
    });
  }

  return sectionUidByHeading;
}

/** Parses `[label](path#Lline)` parentheticals from a statement's text. */
type LinkParser = (statement: string) => SpecLinkRef[];

/** Per-node extra predicates beyond the shared repo/file_path/start_line set. */
type ExtraChunkFields = (link: SpecLinkRef) => Record<string, unknown>;

/** Builds a linked chunk's full xid from the repo + resolved link. */
type ChunkXid = (repo: string, link: SpecLinkRef) => string;

/** File-scoped TestChunk xid (`${repo}|${file}`) — the shared identity coverage also keys on, so a spec link reconciles onto the coverage-bearing node. */
const fileScopedXid: ChunkXid = (repo, link) =>
  fileScopedTestChunkXid(repo, link.path);
/** Line/label-scoped CodeChunk xid (`${repo}|${path}|${line}`) — one node per distinct inline link site. */
const lineScopedXid: ChunkXid = (repo, link) =>
  `${repo}|${link.path}|${link.line ?? link.label}`;

/** Parses inline links in `text`, upserts one chunk node of `nodeType` per link, and returns their uids; shared by the file-scoped `validated_by` (TestChunk) and line-scoped `implemented_by` (CodeChunk) facets. */
/** One linked-chunk facet: how its links are parsed out of a statement, the node type they become, how each is identified, and any extra fields it carries. */
interface LinkedChunkKind {
  parse: LinkParser;
  nodeType: SpecTraceNodeType;
  buildXid: ChunkXid;
  extraFields?: ExtraChunkFields;
}

async function projectLinkedChunks(
  context: ProjectionContext,
  text: string,
  { parse, nodeType, buildXid, extraFields = () => ({}) }: LinkedChunkKind,
): Promise<Array<{ uid: string }>> {
  const { dgraph, repo, filePath } = context;
  const edgeRefs: Array<{ uid: string }> = [];

  for (const parsed of parse(text)) {
    // Resolve to a repo-relative path for xid/coverage joins; skips anchors and repo-escaping paths.
    const path = repoRelativeLinkTarget(filePath, parsed.path);

    if (path === null) {
      continue;
    }
    const link = { ...parsed, path };
    const chunkXid = buildXid(repo, link);
    const chunkFields: Record<string, unknown> = {
      [`${nodeType}.repo`]: repo,
      [`${nodeType}.file_path`]: link.path,
      ...extraFields(link),
    };

    if (link.line != null) {
      chunkFields[`${nodeType}.start_line`] = link.line;
    }
    edgeRefs.push({
      uid: await upsertByXid(dgraph, nodeType, chunkXid, chunkFields),
    });
  }

  return edgeRefs;
}

/** The `validated_by`/`implemented_by` predicate names for one owner node type (Statement or AcceptanceCriterion). */
interface LinkPredicates {
  validatedBy: string;
  implementedBy: string;
}

/** Projects a text's inline links onto an owner node's TestChunk/CodeChunk edges, REPLACING them (not set-union) so re-projection can't leave stale refs; dropped chunks are orphan-GC'd. */
async function projectLinkEdges(
  context: ProjectionContext,
  ownerUid: string,
  text: string,
  predicates: LinkPredicates,
): Promise<void> {
  const { dgraph } = context;
  const validatedBy = await projectLinkedChunks(context, text, {
    parse: parseTestLinksInStatement,
    nodeType: "TestChunk",
    buildXid: fileScopedXid,
    extraFields: (link) => ({
      "TestChunk.test_name": link.label,
      "TestChunk.link_label": link.label,
    }),
  });
  const implementedBy = await projectLinkedChunks(context, text, {
    parse: parseCodeLinksInStatement,
    nodeType: "CodeChunk",
    buildXid: lineScopedXid,
  });

  const previousLinks = await readLinkTargets(dgraph, ownerUid, predicates);
  const newValidated = validatedBy.map((ref) => ref.uid);
  const newImplemented = implementedBy.map((ref) => ref.uid);

  await replaceEdge(dgraph, ownerUid, predicates.validatedBy, newValidated);
  await replaceEdge(dgraph, ownerUid, predicates.implementedBy, newImplemented);

  // A dropped chunk is deleted only if nothing else owns it (another link, or a Coverage row).
  await gcOrphanChunks(dgraph, "TestChunk", {
    previous: previousLinks.validated,
    current: newValidated,
  });
  await gcOrphanChunks(dgraph, "CodeChunk", {
    previous: previousLinks.implemented,
    current: newImplemented,
  });
}

/** Upserts one Statement, its inline-link chunks, and its `Statement.section` edge when the segment sits under a heading. */
async function projectStatement(
  context: ProjectionContext,
  segment: SpecSegment,
  sectionUidByHeading: Map<string, string>,
  classification: Classification,
): Promise<void> {
  const { dgraph, repo, filePath, specUid } = context;
  const embedding = await context.embed(segment.text);

  const statementUid = await upsertByXid(
    dgraph,
    "Statement",
    `${repo}|${filePath}|${segment.ordinal}`,
    {
      "Statement.repo": repo,
      "Statement.ordinal": segment.ordinal,
      "Statement.text": segment.text,
      "Statement.text_hash": sha256(segment.text),
      "Statement.spec": { uid: specUid },
      "Statement.kind": segment.kind,
      "Statement.testability": classification.testability,
      ...(classification.category != null
        ? { "Statement.category": classification.category }
        : {}),
      ...(segment.enclosingHeading !== null
        ? {
            "Statement.section": {
              uid: sectionUidByHeading.get(segment.enclosingHeading),
            },
          }
        : {}),
      ...(embedding ? { "Statement.embedding": vectorLiteral(embedding) } : {}),
    },
  );

  await projectLinkEdges(context, statementUid, segment.text, {
    validatedBy: "Statement.validated_by",
    implementedBy: "Statement.implemented_by",
  });

  // DECIDED_BY: links a cited ADR by number, best-effort — specs/adrs project in parallel CI jobs, so an ADR cited in the same push may attach only on a later run.
  const adrRefs = parseAdrRefs(segment.text);

  if (adrRefs.length > 0) {
    const adrUids = await resolveAdrUids(dgraph, repo, adrRefs);

    await replaceEdge(dgraph, statementUid, "Statement.decided_by", adrUids);
  }
}

/** Resolves cited ADR numbers to their node uids for this repo (skips numbers with no ADR node). */
async function resolveAdrUids(
  dgraph: DgraphClientPort,
  repo: string,
  numbers: number[],
): Promise<string[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($repo: string) { adrs(func: eq(ADR.repo, $repo)) { uid ADR.number } }`,
      { $repo: repo },
    );
    const byNumber = new Map<number, string>();

    for (const adr of (res.data?.adrs ?? []) as Array<{
      uid: string;
      "ADR.number"?: number;
    }>) {
      if (adr["ADR.number"] != null) {
        byNumber.set(adr["ADR.number"], adr.uid);
      }
    }

    return numbers
      .map((n) => byNumber.get(n))
      .filter((uid): uid is string => Boolean(uid));
  });
}

/** Reads an owner's current TestChunk/CodeChunk link target uids on the given predicates. */
async function readLinkTargets(
  dgraph: DgraphClientPort,
  ownerUid: string,
  predicates: LinkPredicates,
): Promise<{ validated: string[]; implemented: string[] }> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($uid: string) {
        node(func: uid($uid)) {
          validated: ${predicates.validatedBy} { uid }
          implemented: ${predicates.implementedBy} { uid }
        }
      }`,
      { $uid: ownerUid },
    );
    const node = (res.data?.node?.[0] ?? {}) as {
      validated?: { uid: string }[];
      implemented?: { uid: string }[];
    };

    return {
      validated: (node.validated ?? []).map((ref) => ref.uid),
      implemented: (node.implemented ?? []).map((ref) => ref.uid),
    };
  });
}

/** Builds the delete-nquads for a batch of orphan uids, including the Spec's forward edge to each when `forwardEdge` is given (that edge set-unions on upsert, so it must be deleted too or the orphan lingers as a dangling ref). */
function orphanDeleteNquads(
  orphanUids: string[],
  specUid: string,
  forwardEdge: string | undefined,
): string {
  const deletes = orphanUids.map((uid) => `<${uid}> * * .`);

  if (forwardEdge) {
    deletes.push(
      ...orphanUids.map((uid) => `<${specUid}> <${forwardEdge}> <${uid}> .`),
    );
  }

  return deletes.join("\n");
}

/** Deletes every `nodeType` child linked to this Spec whose xid isn't in `validXids` — upsert-by-xid never removes nodes, so this reverse-edge sweep is what keeps re-projection idempotent. */
async function pruneOrphans(
  context: ProjectionContext,
  nodeType: SpecTraceNodeType,
  validXids: Set<string>,
  forwardEdge?: string,
): Promise<void> {
  const { dgraph, repo, filePath, specUid } = context;
  const xidPredicate = `${nodeType}.xid`;

  await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) { children: ~${nodeType}.spec { uid ${xidPredicate} } }
      }`,
      { $xid: `${repo}|${filePath}` },
    );
    const children = (res.data?.spec?.[0]?.children ?? []) as Array<
      { uid: string } & Record<string, string>
    >;
    const orphanUids = children
      .filter((child) => !validXids.has(child[xidPredicate]))
      .map((child) => child.uid);

    if (orphanUids.length === 0) {
      return;
    }
    await txn.mutate({
      deleteNquads: orphanDeleteNquads(orphanUids, specUid, forwardEdge),
      commitNow: true,
    });
  });
}

/** Upserts one AcceptanceCriterion node plus its inline-link chunks, returning its uid for the forward `Spec.acceptance_criteria` edge. */
async function projectAcceptanceCriterion(
  context: ProjectionContext,
  segment: SpecSegment,
): Promise<string> {
  const { dgraph, repo, filePath, specUid } = context;
  const embedding = await context.embed(segment.text);
  const criterionUid = await upsertByXid(
    dgraph,
    "AcceptanceCriterion",
    `${repo}|${filePath}|ac|${segment.ordinal}`,
    {
      "AcceptanceCriterion.repo": repo,
      "AcceptanceCriterion.ordinal": segment.ordinal,
      "AcceptanceCriterion.text": segment.text,
      "AcceptanceCriterion.text_hash": sha256(segment.text),
      "AcceptanceCriterion.spec": { uid: specUid },
      ...(embedding
        ? { "AcceptanceCriterion.embedding": vectorLiteral(embedding) }
        : {}),
    },
  );

  await projectLinkEdges(context, criterionUid, segment.text, {
    validatedBy: "AcceptanceCriterion.validated_by",
    implementedBy: "AcceptanceCriterion.implemented_by",
  });

  return criterionUid;
}

/** Upserts an AcceptanceCriterion per "Acceptance Criteria" segment and points `Spec.acceptance_criteria` at them; specs without any leave the edge untouched. */
async function projectAcceptanceCriteria(
  context: ProjectionContext,
  acSegments: SpecSegment[],
): Promise<void> {
  const { dgraph, repo, filePath } = context;
  const criterionUids: string[] = [];

  for (const segment of acSegments) {
    criterionUids.push(await projectAcceptanceCriterion(context, segment));
  }

  if (criterionUids.length) {
    await upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
      "Spec.acceptance_criteria": criterionUids.map((uid) => ({ uid })),
    });
  }
}

/** Projects the lossless Block source layer via the shared writer, then prunes orphaned Blocks through the file-scoped sweep shared with the ADR path. */
async function projectBlocks(
  context: ProjectionContext,
  content: string,
): Promise<void> {
  const { dgraph, repo, filePath, specUid } = context;
  const validBlockXids = await projectDocumentBlocks(
    dgraph,
    { repo, filePath, content },
    specUid,
  );

  await pruneOrphanBlocksByFile(dgraph, repo, filePath, validBlockXids);
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

/** Upserts every statement segment's Statement node in turn. */
async function projectStatements(
  context: ProjectionContext,
  statementSegments: SpecSegment[],
  introOrdinals: Set<number>,
  sectionUidByHeading: Map<string, string>,
): Promise<void> {
  for (const segment of statementSegments) {
    const classification = classifyByHeuristic(segment, introOrdinals);

    await projectStatement(
      context,
      segment,
      sectionUidByHeading,
      classification,
    );
  }
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
