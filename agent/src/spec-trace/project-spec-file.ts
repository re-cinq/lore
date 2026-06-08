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
} from "@re-cinq/lore-shared";
import type { Classification, DgraphClientPort, SpecLinkRef } from "@re-cinq/lore-shared";

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
import { withTxn, upsertByXid, type SpecTraceNodeType } from "./dgraph-upsert.js";
import { projectDocumentBlocks, pruneOrphanBlocksByFile } from "./project-blocks.js";

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

/**
 * Parses the inline links in `text`, upserts one chunk node of `nodeType` per
 * link (keyed by `${repo}|${path}|${line ?? label}`), and returns their uids as
 * edge refs. Every chunk carries `<Type>.repo`/`<Type>.file_path` plus
 * `<Type>.start_line` when the link has a `#L` anchor; `extraFields` adds any
 * node-specific predicates (e.g. TestChunk's `test_name`/`link_label`). Shared
 * by the `validated_by` (TestChunk) and `implemented_by` (CodeChunk) facets.
 */
async function projectLinkedChunks(
  context: ProjectionContext,
  text: string,
  parse: LinkParser,
  nodeType: SpecTraceNodeType,
  extraFields: ExtraChunkFields = () => ({}),
): Promise<Array<{ uid: string }>> {
  const { dgraph, repo } = context;
  const edgeRefs: Array<{ uid: string }> = [];
  for (const link of parse(text)) {
    const chunkXid = `${repo}|${link.path}|${link.line ?? link.label}`;
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
    (link) => ({ "TestChunk.test_name": link.label, "TestChunk.link_label": link.label }),
  );
  const implementedBy = await projectLinkedChunks(
    context,
    segment.text,
    parseCodeLinksInStatement,
    "CodeChunk",
  );
  const embedding = await context.embed(segment.text);

  await upsertByXid(dgraph, "Statement", `${repo}|${filePath}|${segment.ordinal}`, {
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
    ...(validatedBy.length ? { "Statement.validated_by": validatedBy } : {}),
    ...(implementedBy.length ? { "Statement.implemented_by": implementedBy } : {}),
    ...(embedding ? { "Statement.embedding": vectorLiteral(embedding) } : {}),
  });
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

  const specUid = await upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
    "Spec.repo": repo,
    "Spec.file_path": filePath,
    "Spec.content_hash": contentHash,
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
