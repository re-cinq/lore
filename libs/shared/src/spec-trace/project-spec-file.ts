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

/**
 * Upserts the Feature node for this spec's owning folder (xid `${repo}|${featureDir}`)
 * and returns its uid for the `Spec.feature` edge — so every md file in one speckit
 * folder groups under a single UI node. A root-level spec (no feature folder) writes
 * no Feature and returns undefined.
 */
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

/**
 * Segments under an acceptance-criteria heading become AcceptanceCriterion nodes,
 * not Statements. Matches the title variants in use across specs — `Acceptance
 * Criteria`, `Success Criteria`, `Independent Test Criteria`, and `… & Acceptance
 * Criteria` wrappers — under any heading level / case / trailing colon / bold, so
 * they all fall into the one AcceptanceCriterion category.
 */
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

/**
 * The `validated_by`/`implemented_by` predicate names for one owner node type
 * (Statement or AcceptanceCriterion). Both facets link to the same TestChunk /
 * CodeChunk identities; only the owning predicate differs.
 */
interface LinkPredicates {
  validatedBy: string;
  implementedBy: string;
}

/**
 * Projects a text's inline links onto an owner node: TestChunks via the owner's
 * `validated_by` predicate (file-scoped xid) and CodeChunks via `implemented_by`
 * (line-scoped xid). Edges are REPLACED (delete-then-set) so a re-projection that
 * changed the inline links can't set-union stale chunk refs, and dropped chunks
 * are orphan-GC'd. Shared verbatim by {@link projectStatement} and
 * {@link projectAcceptanceCriterion} — only `predicates` differs.
 */
async function projectLinkEdges(
  context: ProjectionContext,
  ownerUid: string,
  text: string,
  predicates: LinkPredicates,
): Promise<void> {
  const { dgraph } = context;
  const validatedBy = await projectLinkedChunks(
    context,
    text,
    parseTestLinksInStatement,
    "TestChunk",
    fileScopedXid,
    (link) => ({
      "TestChunk.test_name": link.label,
      "TestChunk.link_label": link.label,
    }),
  );
  const implementedBy = await projectLinkedChunks(
    context,
    text,
    parseCodeLinksInStatement,
    "CodeChunk",
    lineScopedXid,
  );

  const previousLinks = await readLinkTargets(dgraph, ownerUid, predicates);
  const newValidated = validatedBy.map((ref) => ref.uid);
  const newImplemented = implementedBy.map((ref) => ref.uid);

  await replaceEdge(dgraph, ownerUid, predicates.validatedBy, newValidated);
  await replaceEdge(dgraph, ownerUid, predicates.implementedBy, newImplemented);

  // A chunk this owner just unlinked is deleted only if NOTHING else owns it
  // (another statement's link, or — for code — a Coverage). Scoped to the dropped
  // uids so it never touches chunks the ingest paths created and left unlinked.
  await gcOrphanChunks(
    dgraph,
    "TestChunk",
    previousLinks.validated,
    newValidated,
  );
  await gcOrphanChunks(
    dgraph,
    "CodeChunk",
    previousLinks.implemented,
    newImplemented,
  );
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

  // DECIDED_BY: a statement that cites an ADR ("per ADR-016") links to that ADR
  // node by number — the "why". Best-effort: only ADRs already projected resolve.
  // specs and adrs project as independent (parallel) CI jobs, so when a spec and
  // the ADR it cites land in the same push the edge may attach on a later run
  // (the next time that spec changes, or a force re-projection); in steady state
  // the ADR is already in the graph from a prior push and resolves immediately.
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
    const children = (res.data?.spec?.[0]?.children ?? []) as Array<
      { uid: string } & Record<string, string>
    >;
    const orphanUids = children
      .filter((child) => !validXids.has(child[xidPredicate]))
      .map((child) => child.uid);

    if (orphanUids.length === 0) {
      return;
    }
    // `<uid> * * .` drops the orphan node's outgoing edges, but the Spec keeps a
    // forward `[uid]` edge (Spec.sections / Spec.acceptance_criteria) that Dgraph
    // set-unions on upsert, so a removed child lingers there as a dangling ref
    // unless its forward edge is deleted too.
    const deletes = orphanUids.map((uid) => `<${uid}> * * .`);

    if (forwardEdge) {
      deletes.push(
        ...orphanUids.map((uid) => `<${specUid}> <${forwardEdge}> <${uid}> .`),
      );
    }
    await txn.mutate({ deleteNquads: deletes.join("\n"), commitNow: true });
  });
}

/**
 * Upserts one AcceptanceCriterion node (xid = `${repo}|${filePath}|ac|${ordinal}`)
 * carrying its verbatim text + text_hash, linked back to the Spec via
 * `AcceptanceCriterion.spec`, plus its inline-link chunks (TestChunks via
 * `AcceptanceCriterion.validated_by`, CodeChunks via `AcceptanceCriterion.implemented_by`)
 * through the shared {@link projectLinkEdges}. Returns its uid for the forward
 * `Spec.acceptance_criteria` edge.
 */
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

/**
 * Upserts an AcceptanceCriterion per "Acceptance Criteria" segment and points
 * the Spec at them via `Spec.acceptance_criteria`. Specs without any such
 * segments write no nodes and leave the edge untouched. Parallel to
 * {@link projectSections}.
 */
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
async function projectBlocks(
  context: ProjectionContext,
  content: string,
): Promise<void> {
  const { dgraph, repo, filePath, specUid } = context;
  const validBlockXids = await projectDocumentBlocks(
    dgraph,
    repo,
    filePath,
    content,
    specUid,
  );

  await pruneOrphanBlocksByFile(dgraph, repo, filePath, validBlockXids);
}

export async function projectSpecFile(
  repo: string,
  filePath: string,
  content: string,
  dgraph: DgraphClientPort,
  embed: EmbedFn = getQueryEmbedding,
  force = false,
): Promise<{ projected: boolean }> {
  const contentHash = sha256(content);

  if (
    !force &&
    (await readSpecContentHash(dgraph, `${repo}|${filePath}`)) === contentHash
  ) {
    return { projected: false };
  }

  const title = extractTitle(content);
  const featureUid = await projectFeature(dgraph, repo, filePath);
  const specUid = await upsertByXid(dgraph, "Spec", `${repo}|${filePath}`, {
    "Spec.repo": repo,
    "Spec.file_path": filePath,
    ...(title !== null ? { "Spec.title": title } : {}),
    ...(featureUid ? { "Spec.feature": { uid: featureUid } } : {}),
  });

  // The hash is a completed-projection receipt, not an attempted-projection
  // marker: clear it now and persist it only after every child write below
  // succeeds. A projection that dies mid-file (txn abort under contention)
  // then leaves the gate open, so the next attempt re-projects the whole
  // file — hash-first left files permanently skipped with partial children.
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

  for (const segment of statementSegments) {
    const classification = classifyByHeuristic(segment, introOrdinals);

    await projectStatement(
      context,
      segment,
      sectionUidByHeading,
      classification,
    );
  }

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
