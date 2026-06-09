/**
 * spec-traceability-graph — Phase 1 projection unit.
 *
 * Projects one spec file into the Dgraph traceability graph:
 *   - a Repo root node (xid = repo),
 *   - a Spec child (xid = `${repo}|${filePath}`) carrying the content hash,
 *   - one Section node per unique enclosing heading in document order
 *     (xid = `${repo}|${filePath}|${sectionOrdinal}`), reachable from the Spec
 *     via `Spec.sections`,
 *   - one Statement node per segment (xid = `${repo}|${filePath}|${ordinal}`),
 *     carrying its heuristic classification (`kind`, `testability`, and
 *     `category` when present), linked back to the Spec via `Statement.spec`
 *     and (when it sits under a heading) to its Section via `Statement.section`,
 *   - a TestChunk node (xid = `${repo}|${path}|${line ?? label}`) per inline
 *     test link, attached to its Statement via `Statement.validated_by`,
 *   - a CodeChunk node (same xid scheme) per inline code link, attached to its
 *     Statement via `Statement.implemented_by`,
 *   - one AcceptanceCriterion node per segment under the "Acceptance Criteria"
 *     heading (xid = `${repo}|${filePath}|ac|${ordinal}`), reachable from the
 *     Spec via `Spec.acceptance_criteria`; these segments are projected as
 *     AcceptanceCriterion nodes instead of Statements,
 *   - one Block node per source block (xid = `${repo}|${filePath}|block|${ordinal}`)
 *     forming the lossless source layer, reachable from the Spec via `Block.spec`.
 *
 * Freshness gate: before any write, the persisted `Spec.content_hash` is
 * compared to `sha256(content)`. An unchanged hash is a no-op — nothing is
 * upserted and `{ projected: false }` is returned. Otherwise the file is
 * projected and `{ projected: true }` is returned.
 *
 * Deferred to later facets: idempotent re-projection pruning. Talks only to the
 * injected DgraphClientPort; never imports the driver.
 */

import { createHash } from "node:crypto";
import {
  segmentStatements,
  parseTestLinksInStatement,
  parseCodeLinksInStatement,
  buildIntroOrdinals,
  classifyByHeuristic,
  getQueryEmbedding,
} from "./deps.js";
import type { Classification, DgraphClientPort, SpecLinkRef } from "./deps.js";

/**
 * Embeds a statement/criterion's text into the float32vector stored on its node,
 * powering drift severity and vector candidate suggestion. Defaults to the shared
 * Vertex singleton; injected as a seam so projection stays deterministic + offline
 * in tests (and degrades to no embedding when the embedder returns null).
 */
type EmbedFn = (text: string) => Promise<number[] | null>;

/** Dgraph float32vector literal: the array serialized as a `"[a,b,c]"` string. */
function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
import { withTxn, upsertByXid, replaceEdge, type SpecTraceNodeType } from "./dgraph-upsert.js";
import { parseAdrRefs } from "./adr-refs.js";
import { projectDocumentBlocks, pruneOrphanBlocksByFile } from "./project-blocks.js";
import { repoRelativeLinkTarget } from "./link-target-path.js";
import { fileScopedTestChunkXid } from "./test-chunk-identity.js";

/**
 * The fixed addressing context for one spec-file projection: the injected
 * Dgraph port plus the `repo`/`filePath` that key every node's xid and the
 * already-upserted `specUid` that children link back to. Threaded into each
 * per-facet projector so call sites carry one struct instead of a four-arg
 * prefix.
 */
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

/** Statements under this heading become AcceptanceCriterion nodes, not Statements. */
const ACCEPTANCE_CRITERIA_HEADING = "Acceptance Criteria";

/** Reads the persisted Spec.content_hash for an xid, or undefined when no Spec exists yet. */
async function readSpecContentHash(dgraph: DgraphClientPort, specXid: string): Promise<string | undefined> {
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

/**
 * Upserts a Section per unique enclosing heading in document order and points
 * the Spec at them via `Spec.sections`. Returns a map from heading text to the
 * Section uid so statements can attach to their Section. Headingless specs
 * yield an empty map and write no Section nodes.
 */
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
    const sectionUid = await upsertByXid(dgraph, "Section", `${repo}|${filePath}|${sectionOrdinal}`, {
      "Section.heading": heading,
      "Section.spec": { uid: specUid },
    });
    sectionUidByHeading.set(heading, sectionUid);
  }
  if (sectionUidByHeading.size) {
    await upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
      "Spec.sections": [...sectionUidByHeading.values()].map((uid) => ({ uid })),
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
const fileScopedXid: ChunkXid = (repo, link) => fileScopedTestChunkXid(repo, link.path);
/** Line/label-scoped CodeChunk xid (`${repo}|${path}|${line}`) — one node per distinct inline link site. */
const lineScopedXid: ChunkXid = (repo, link) => `${repo}|${link.path}|${link.line ?? link.label}`;

/**
 * Parses the inline links in `text`, upserts one chunk node of `nodeType` per
 * link (keyed `${repo}|${chunkKey(link)}`), and returns their uids as edge refs.
 * Every chunk carries `<Type>.repo`/`<Type>.file_path` plus `<Type>.start_line`
 * when the link has a `#L` anchor; `extraFields` adds any node-specific
 * predicates (e.g. TestChunk's `test_name`/`link_label`). Shared by the
 * `validated_by` (TestChunk, file-scoped) and `implemented_by` (CodeChunk,
 * line-scoped) facets — the key granularity differs so TestChunks reconcile with
 * the file-granular runner ingest.
 */
async function projectLinkedChunks(
  context: ProjectionContext,
  text: string,
  parse: LinkParser,
  nodeType: SpecTraceNodeType,
  buildXid: ChunkXid,
  extraFields: ExtraChunkFields = () => ({}),
): Promise<Array<{ uid: string }>> {
  const { dgraph, repo, filePath } = context;
  const edgeRefs: Array<{ uid: string }> = [];
  for (const parsed of parse(text)) {
    // Resolve the authored target to a repo-relative path so xids/coverage joins
    // line up; skip anchors and repo-escaping paths that aren't real files.
    const path = repoRelativeLinkTarget(filePath, parsed.path);
    if (path === null) continue;
    const link = { ...parsed, path };
    const chunkXid = buildXid(repo, link);
    const chunkFields: Record<string, unknown> = {
      [`${nodeType}.repo`]: repo,
      [`${nodeType}.file_path`]: link.path,
      ...extraFields(link),
    };
    if (link.line != null) chunkFields[`${nodeType}.start_line`] = link.line;
    edgeRefs.push({ uid: await upsertByXid(dgraph, nodeType, chunkXid, chunkFields) });
  }
  return edgeRefs;
}

/**
 * Upserts one Statement, its inline-link chunks (TestChunks via
 * `Statement.validated_by`, CodeChunks via `Statement.implemented_by`), and its
 * `Statement.section` edge when the segment sits under a heading. Linked back to
 * the Spec via `Statement.spec`.
 */
async function projectStatement(
  context: ProjectionContext,
  segment: SpecSegment,
  sectionUidByHeading: Map<string, string>,
  classification: Classification,
): Promise<void> {
  const { dgraph, repo, filePath, specUid } = context;
  const validatedBy = await projectLinkedChunks(
    context,
    segment.text,
    parseTestLinksInStatement,
    "TestChunk",
    fileScopedXid,
    (link) => ({ "TestChunk.test_name": link.label, "TestChunk.link_label": link.label }),
  );
  const implementedBy = await projectLinkedChunks(
    context,
    segment.text,
    parseCodeLinksInStatement,
    "CodeChunk",
    lineScopedXid,
  );
  const embedding = await context.embed(segment.text);

  // Link edges are REPLACED (delete-then-set), not folded into the scalar upsert:
  // a re-projected statement that changed its inline links would otherwise
  // set-union the stale TestChunk/CodeChunk refs onto validated_by/implemented_by.
  const statementUid = await upsertByXid(dgraph, "Statement", `${repo}|${filePath}|${segment.ordinal}`, {
    "Statement.ordinal": segment.ordinal,
    "Statement.text": segment.text,
    "Statement.text_hash": sha256(segment.text),
    "Statement.spec": { uid: specUid },
    "Statement.kind": segment.kind,
    "Statement.testability": classification.testability,
    ...(classification.category != null ? { "Statement.category": classification.category } : {}),
    ...(segment.enclosingHeading !== null
      ? { "Statement.section": { uid: sectionUidByHeading.get(segment.enclosingHeading) } }
      : {}),
    ...(embedding ? { "Statement.embedding": vectorLiteral(embedding) } : {}),
  });

  const previousLinks = await readStatementLinkTargets(dgraph, statementUid);
  const newValidated = validatedBy.map((ref) => ref.uid);
  const newImplemented = implementedBy.map((ref) => ref.uid);
  await replaceEdge(dgraph, statementUid, "Statement.validated_by", newValidated);
  await replaceEdge(dgraph, statementUid, "Statement.implemented_by", newImplemented);

  // A chunk this statement just unlinked is deleted only if NOTHING else owns it
  // (another statement's link, or — for code — a Coverage). Scoped to the dropped
  // uids so it never touches chunks the ingest paths created and left unlinked.
  await gcUnlinkedChunks(dgraph, "TestChunk", previousLinks.validated, newValidated);
  await gcUnlinkedChunks(dgraph, "CodeChunk", previousLinks.implemented, newImplemented);

  // DECIDED_BY: a statement that cites an ADR ("per ADR-016") links to that ADR
  // node by number — the "why". Best-effort: only ADRs already projected resolve
  // (run ingest-adrs before ingest-specs to populate them).
  const adrRefs = parseAdrRefs(segment.text);
  if (adrRefs.length > 0) {
    const adrUids = await resolveAdrUids(dgraph, repo, adrRefs);
    await replaceEdge(dgraph, statementUid, "Statement.decided_by", adrUids);
  }
}

/** Resolves cited ADR numbers to their node uids for this repo (skips numbers with no ADR node). */
async function resolveAdrUids(dgraph: DgraphClientPort, repo: string, numbers: number[]): Promise<string[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($repo: string) { adrs(func: eq(ADR.repo, $repo)) { uid ADR.number } }`,
      { $repo: repo },
    );
    const byNumber = new Map<number, string>();
    for (const adr of (res.data?.adrs ?? []) as Array<{ uid: string; "ADR.number"?: number }>) {
      if (adr["ADR.number"] != null) byNumber.set(adr["ADR.number"], adr.uid);
    }
    return numbers.map((n) => byNumber.get(n)).filter((uid): uid is string => Boolean(uid));
  });
}

/** Reads a Statement's current TestChunk/CodeChunk link target uids. */
async function readStatementLinkTargets(
  dgraph: DgraphClientPort,
  statementUid: string,
): Promise<{ validated: string[]; implemented: string[] }> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($uid: string) {
        stmt(func: uid($uid)) {
          validated: Statement.validated_by { uid }
          implemented: Statement.implemented_by { uid }
        }
      }`,
      { $uid: statementUid },
    );
    const node = (res.data?.stmt?.[0] ?? {}) as {
      validated?: { uid: string }[];
      implemented?: { uid: string }[];
    };
    return {
      validated: (node.validated ?? []).map((ref) => ref.uid),
      implemented: (node.implemented ?? []).map((ref) => ref.uid),
    };
  });
}

/** Reverse edges that, if present, mean a chunk is still owned and must not be GC'd. */
const CHUNK_OWNER_EDGES: Record<"TestChunk" | "CodeChunk", string[]> = {
  // TestChunk.coverage (forward) means the runner attached coverage to this
  // file-scoped node — it outlives any single spec link and must not be GC'd.
  TestChunk: ["~Statement.validated_by", "TestChunk.coverage"],
  CodeChunk: ["~Statement.implemented_by", "~Coverage.covers"],
};

/**
 * Deletes each chunk in `previousUids` that is no longer in `currentUids` AND no
 * longer has any owning reverse edge — the orphan a statement leaves behind when
 * it drops a link. Reads the owners AFTER {@link replaceEdge} has removed this
 * statement's edge, so a still-shared chunk reports its remaining owners and
 * survives.
 */
async function gcUnlinkedChunks(
  dgraph: DgraphClientPort,
  nodeType: "TestChunk" | "CodeChunk",
  previousUids: string[],
  currentUids: string[],
): Promise<void> {
  const current = new Set(currentUids);
  const dropped = previousUids.filter((uid) => !current.has(uid));
  const ownerEdges = CHUNK_OWNER_EDGES[nodeType];
  for (const uid of dropped) {
    const stillOwned = await withTxn(dgraph, async (txn) => {
      const blocks = ownerEdges.map((edge, index) => `owner${index}: ${edge} { uid }`).join("\n");
      const res = await txn.queryWithVars(
        `query q($uid: string) { node(func: uid($uid)) { ${blocks} } }`,
        { $uid: uid },
      );
      // A `[uid]` edge comes back as an array; a single-cardinality `uid` edge
      // (e.g. TestChunk.coverage) comes back as a bare object — either present
      // shape means the chunk is still owned.
      const node = (res.data?.node?.[0] ?? {}) as Record<string, unknown>;
      const isOwned = (value: unknown): boolean => (Array.isArray(value) ? value.length > 0 : value != null);
      return ownerEdges.some((_, index) => isOwned(node[`owner${index}`]));
    });
    if (!stillOwned) {
      await withTxn(dgraph, (txn) => txn.mutate({ deleteNquads: `<${uid}> * * .`, commitNow: true }));
    }
  }
}

/**
 * Deletes every child node of `nodeType` currently linked to this Spec whose xid
 * is not in `validXids` — the orphans left behind when a re-projection drops a
 * child (e.g. a removed Statement, Section, or AcceptanceCriterion). The sweep
 * walks the reverse `~<Type>.spec` edge from the Spec, so it generalizes across
 * every spec-owned facet that links back via `<Type>.spec`. Upsert-by-xid alone
 * never removes nodes, so this reverse-edge sweep is what keeps re-projection
 * idempotent. `nodeType` is a trusted internal constant, never user input, so it
 * is safe to interpolate into the query predicates.
 */
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
    const children = (res.data?.spec?.[0]?.children ?? []) as Array<{ uid: string } & Record<string, string>>;
    const orphanUids = children
      .filter((child) => !validXids.has(child[xidPredicate]))
      .map((child) => child.uid);
    if (orphanUids.length) {
      // `<uid> * * .` drops the orphan node's outgoing edges, but the Spec keeps a
      // forward `[uid]` edge (Spec.sections / Spec.acceptance_criteria) that Dgraph
      // set-unions on upsert, so a removed child lingers there as a dangling ref
      // unless its forward edge is deleted too.
      const deletes = orphanUids.map((uid) => `<${uid}> * * .`);
      if (forwardEdge) {
        deletes.push(...orphanUids.map((uid) => `<${specUid}> <${forwardEdge}> <${uid}> .`));
      }
      await txn.mutate({ deleteNquads: deletes.join("\n"), commitNow: true });
    }
  });
}

/**
 * Upserts one AcceptanceCriterion node (xid = `${repo}|${filePath}|ac|${ordinal}`)
 * carrying its verbatim text + text_hash, linked back to the Spec via
 * `AcceptanceCriterion.spec`. Returns its uid for the forward `Spec.acceptance_criteria` edge.
 */
async function projectAcceptanceCriterion(context: ProjectionContext, segment: SpecSegment): Promise<string> {
  const { dgraph, repo, filePath, specUid } = context;
  const embedding = await context.embed(segment.text);
  return upsertByXid(dgraph, "AcceptanceCriterion", `${repo}|${filePath}|ac|${segment.ordinal}`, {
    "AcceptanceCriterion.ordinal": segment.ordinal,
    "AcceptanceCriterion.text": segment.text,
    "AcceptanceCriterion.text_hash": sha256(segment.text),
    "AcceptanceCriterion.spec": { uid: specUid },
    ...(embedding ? { "AcceptanceCriterion.embedding": vectorLiteral(embedding) } : {}),
  });
}

/**
 * Upserts an AcceptanceCriterion per "Acceptance Criteria" segment and points
 * the Spec at them via `Spec.acceptance_criteria`. Specs without any such
 * segments write no nodes and leave the edge untouched. Parallel to
 * {@link projectSections}.
 */
async function projectAcceptanceCriteria(context: ProjectionContext, acSegments: SpecSegment[]): Promise<void> {
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

/**
 * Projects the lossless source layer via the shared {@link projectDocumentBlocks}
 * writer — one Block node per source block, linked back to the Spec via
 * `Block.spec` and also carrying `Block.file_path` — then prunes the Blocks that
 * a re-projection orphaned. Pruning goes through the file-scoped
 * {@link pruneOrphanBlocksByFile}, the single authoritative Block sweep shared
 * with the ADR path: every Block carries `Block.file_path`, so the `(file_path,
 * repo)` index reaches the same Blocks the `~Block.spec` reverse edge would,
 * without needing a Spec parent.
 */
async function projectBlocks(context: ProjectionContext, content: string): Promise<void> {
  const { dgraph, repo, filePath, specUid } = context;
  const validBlockXids = await projectDocumentBlocks(dgraph, repo, filePath, content, specUid);
  await pruneOrphanBlocksByFile(dgraph, repo, filePath, validBlockXids);
}

export async function projectSpecFile(
  repo: string,
  filePath: string,
  content: string,
  dgraph: DgraphClientPort,
  embed: EmbedFn = getQueryEmbedding,
): Promise<{ projected: boolean }> {
  const contentHash = sha256(content);
  if ((await readSpecContentHash(dgraph, `${repo}|${filePath}`)) === contentHash) {
    return { projected: false };
  }

  const title = extractTitle(content);
  const specUid = await upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
    "Spec.repo": repo,
    "Spec.file_path": filePath,
    "Spec.content_hash": contentHash,
    ...(title !== null ? { "Spec.title": title } : {}),
  });
  await upsertByXid(dgraph, "Repo", repo, { "Repo.specs": [{ uid: specUid }] });

  const context: ProjectionContext = { dgraph, repo, filePath, specUid, embed };
  const segments = segmentStatements(content);
  const introOrdinals = buildIntroOrdinals(segments);
  const acSegments = segments.filter((segment) => segment.enclosingHeading === ACCEPTANCE_CRITERIA_HEADING);
  const statementSegments = segments.filter((segment) => segment.enclosingHeading !== ACCEPTANCE_CRITERIA_HEADING);

  const sectionUidByHeading = await projectSections(context, statementSegments);
  for (const segment of statementSegments) {
    const classification = classifyByHeuristic(segment, introOrdinals);
    await projectStatement(context, segment, sectionUidByHeading, classification);
  }

  const validStatementXids = new Set(statementSegments.map((segment) => `${repo}|${filePath}|${segment.ordinal}`));
  await pruneOrphans(context, "Statement", validStatementXids);

  const validSectionXids = new Set(
    Array.from({ length: sectionUidByHeading.size }, (_, ordinal) => `${repo}|${filePath}|${ordinal}`),
  );
  await pruneOrphans(context, "Section", validSectionXids, "Spec.sections");

  await projectAcceptanceCriteria(context, acSegments);
  const validAcXids = new Set(acSegments.map((segment) => `${repo}|${filePath}|ac|${segment.ordinal}`));
  await pruneOrphans(context, "AcceptanceCriterion", validAcXids, "Spec.acceptance_criteria");

  await projectBlocks(context, content);
  return { projected: true };
}
