/** Linked-chunk projection + orphan pruning shared by Statement/AcceptanceCriterion projection: parses inline test/code links into TestChunk/CodeChunk edges, and sweeps stale children whose xid no longer matches the current segmentation. */

import type {
  DgraphClientPort,
  SpecLinkRef,
} from "../../outbound/spec-trace/deps.js";
import {
  parseTestLinksInStatement,
  parseCodeLinksInStatement,
} from "../../outbound/spec-trace/deps.js";
import {
  withTxn,
  upsertByXid,
  replaceEdge,
  type SpecTraceNodeType,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import { repoRelativeLinkTarget } from "./link-target-path.js";
import { fileScopedTestChunkXid } from "./test-chunk-identity.js";
import { gcOrphanChunks } from "./gc-orphan-chunks.js";
import { resolveAnchorLine } from "../../domain/spec-trace/resolve-anchor-line.js";
import { testTitleAt } from "../../domain/spec-trace/test-declarations.js";
import type { ProjectionContext } from "./project-spec-file-context.js";

/** Parses `[label](path#Lline)` parentheticals from a statement's text. */
type LinkParser = (statement: string) => SpecLinkRef[];

/** Per-node extra predicates beyond the shared repo/file_path/start_line set. */
type ExtraChunkFields = (link: SpecLinkRef) => Promise<Record<string, unknown>>;

/** Builds a linked chunk's full xid from the repo + resolved link. */
type ChunkXid = (repo: string, link: SpecLinkRef) => string;

/** File-scoped TestChunk xid (`${repo}|${file}`) — the shared identity coverage also keys on, so a spec link reconciles onto the coverage-bearing node. */
const fileScopedXid: ChunkXid = (repo, link) =>
  fileScopedTestChunkXid(repo, link.path);
/** Anchor-scoped CodeChunk xid (`${repo}|${path}|${hash}`): one node per cited line, which keeps its identity when the file moves around it. A link with no hash falls back to its line, or its label. */
const anchorScopedXid: ChunkXid = (repo, link) =>
  `${repo}|${link.path}|${link.hash ?? link.line ?? link.label}`;

/** One linked-chunk facet: how its links are parsed out of a statement, the node type they become, how each is identified, and any extra fields it carries. */
interface LinkedChunkKind {
  parse: LinkParser;
  nodeType: SpecTraceNodeType;
  buildXid: ChunkXid;
  extraFields?: ExtraChunkFields;
}

/** The `validated_by`/`implemented_by` predicate names for one owner node type (Statement or AcceptanceCriterion). */
export interface LinkPredicates {
  validatedBy: string;
  implementedBy: string;
}

/** Projects a text's inline links onto an owner node's TestChunk/CodeChunk edges, REPLACING them (not set-union) so re-projection can't leave stale refs; dropped chunks are orphan-GC'd. */
export async function projectLinkEdges(
  context: ProjectionContext,
  ownerUid: string,
  text: string,
  predicates: LinkPredicates,
): Promise<void> {
  const { dgraph } = context;
  const previous = await readLinkTargets(dgraph, ownerUid, predicates);
  const validated = await projectTestLinks(context, text);
  const implemented = await projectCodeLinks(context, text);

  await replaceEdge(dgraph, ownerUid, predicates.validatedBy, validated);
  await replaceEdge(dgraph, ownerUid, predicates.implementedBy, implemented);
  await gcDroppedChunks(dgraph, previous, { validated, implemented });
}

/** The uids an owner node currently points at on each link predicate. */
interface LinkTargets {
  validated: string[];
  implemented: string[];
}

/** Reads an owner's current TestChunk/CodeChunk link target uids on the given predicates. */
async function readLinkTargets(
  dgraph: DgraphClientPort,
  ownerUid: string,
  predicates: LinkPredicates,
): Promise<LinkTargets> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(linkTargetsQuery(predicates), {
      $uid: ownerUid,
    });
    const { node: nodes } = res.data;
    const node = (nodes?.[0] ?? {}) as {
      validated?: { uid: string }[];
      implemented?: { uid: string }[];
    };

    return {
      validated: (node.validated ?? []).map((ref) => ref.uid),
      implemented: (node.implemented ?? []).map((ref) => ref.uid),
    };
  });
}

/** The query reading one owner node's link targets on both predicates. */
function linkTargetsQuery({
  validatedBy,
  implementedBy,
}: LinkPredicates): string {
  return `query q($uid: string) {
        node(func: uid($uid)) {
          validated: ${validatedBy} { uid }
          implemented: ${implementedBy} { uid }
        }
      }`;
}

/** Resolves the actual test name at a link's cited line, falling back to the label when the file is unreadable or no declaration sits at or above the line. */
export async function resolveTestName(
  link: Pick<SpecLinkRef, "label" | "path" | "line">,
  readLinked: ProjectionContext["readLinked"],
): Promise<string> {
  if (!readLinked || link.line == null) {return link.label;}
  const content = await readLinked(link.path);

  return content != null
    ? (testTitleAt(content, link.line) ?? link.label)
    : link.label;
}

/** The test chunks this text links to. A test's xid is FILE-scoped rather than line-scoped: a test keeps its identity when the file above it grows, and re-anchoring on every shifted line would churn the graph for no change in meaning. */
async function projectTestLinks(
  context: ProjectionContext,
  text: string,
): Promise<string[]> {
  return projectLinkedChunks(context, text, {
    parse: parseTestLinksInStatement,
    nodeType: "TestChunk",
    buildXid: fileScopedXid,
    extraFields: async (link) => ({
      "TestChunk.test_name": await resolveTestName(link, context.readLinked),
      "TestChunk.link_label": link.label,
      ...anchorHashField("TestChunk", link),
    }),
  });
}

/** The code chunks this text links to, keyed by the content hash of the cited line: a cited line that moves is the same line. */
async function projectCodeLinks(
  context: ProjectionContext,
  text: string,
): Promise<string[]> {
  return projectLinkedChunks(context, text, {
    parse: parseCodeLinksInStatement,
    nodeType: "CodeChunk",
    buildXid: anchorScopedXid,
    extraFields: async (link) => anchorHashField("CodeChunk", link),
  });
}

function anchorHashField(
  nodeType: SpecTraceNodeType,
  link: SpecLinkRef,
): Record<string, string> {
  return link.hash === null ? {} : { [`${nodeType}.anchor_hash`]: link.hash };
}

/** Parses inline links in `text`, upserts one chunk node of `nodeType` per link, and returns their uids; shared by the file-scoped `validated_by` (TestChunk) and line-scoped `implemented_by` (CodeChunk) facets. */
async function projectLinkedChunks(
  context: ProjectionContext,
  text: string,
  kind: LinkedChunkKind,
): Promise<string[]> {
  const uids: string[] = [];

  for (const written of resolvedLinks(context.filePath, text, kind.parse)) {
    uids.push(await upsertOneLink(context, written, kind));
  }

  return uids;
}

async function upsertOneLink(
  context: ProjectionContext,
  written: SpecLinkRef,
  kind: LinkedChunkKind,
): Promise<string> {
  const { nodeType, buildXid, extraFields = async () => ({}) } = kind;
  const link = await anchoredLink(context, written);

  return upsertByXid(
    context.dgraph,
    nodeType,
    buildXid(context.repo, link),
    chunkFields(context.repo, link, nodeType, await extraFields(link)),
  );
}

/** The chunks a text's links would point at, and whether each hashed link still sits on the line the text gives it. */
export interface PlannedLinks {
  validated: string[];
  implemented: string[];
  linksInSync: boolean;
}

/** What {@link projectLinkEdges} would write for `text`, without writing it: a cited line that moved changes the chunk though the text did not, so it counts as out of sync. */
export async function plannedLinks(
  context: Pick<ProjectionContext, "repo" | "filePath" | "readLinked">,
  text: string,
): Promise<PlannedLinks> {
  const tests = await anchoredLinks(context, text, parseTestLinksInStatement);
  const code = await anchoredLinks(context, text, parseCodeLinksInStatement);

  return {
    validated: tests.map(({ link }) => fileScopedXid(context.repo, link)),
    implemented: code.map(({ link }) => anchorScopedXid(context.repo, link)),
    linksInSync: [...tests, ...code].every(
      ({ link, written }) => link.line === written.line,
    ),
  };
}

async function anchoredLinks(
  context: Pick<ProjectionContext, "filePath" | "readLinked">,
  text: string,
  parse: LinkParser,
): Promise<Array<{ written: SpecLinkRef; link: SpecLinkRef }>> {
  return Promise.all(
    resolvedLinks(context.filePath, text, parse).map(async (written) => ({
      written,
      link: await anchoredLink(context, written),
    })),
  );
}

/** The link at the line its content hash now sits on in the cited file, when the projection can read it. */
async function anchoredLink(
  { readLinked }: Pick<ProjectionContext, "readLinked">,
  link: SpecLinkRef,
): Promise<SpecLinkRef> {
  if (!readLinked || link.hash === null) {
    return link;
  }

  return {
    ...link,
    line: resolveAnchorLine(link, await readLinked(link.path)),
  };
}

/** The parsed links of `text` whose targets resolve to a repo-relative path for xid/coverage joins; anchors and repo-escaping paths are dropped. */
function resolvedLinks(
  filePath: string,
  text: string,
  parse: LinkParser,
): SpecLinkRef[] {
  return parse(text)
    .map((parsed) => ({
      ...parsed,
      path: repoRelativeLinkTarget(filePath, parsed.path),
    }))
    .filter((link): link is SpecLinkRef => link.path !== null);
}

/** One linked chunk's own predicates: the shared repo/file_path pair, its facet's extras, and the start line when the link names one. */
function chunkFields(
  repo: string,
  link: SpecLinkRef,
  nodeType: SpecTraceNodeType,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    [`${nodeType}.repo`]: repo,
    [`${nodeType}.file_path`]: link.path,
    ...extra,
    ...(link.line != null ? { [`${nodeType}.start_line`]: link.line } : {}),
  };
}

/** A dropped chunk is deleted only if nothing else owns it (another link, or a Coverage row). */
async function gcDroppedChunks(
  dgraph: DgraphClientPort,
  previous: LinkTargets,
  current: LinkTargets,
): Promise<void> {
  await gcOrphanChunks(dgraph, "TestChunk", {
    previous: previous.validated,
    current: current.validated,
  });
  await gcOrphanChunks(dgraph, "CodeChunk", {
    previous: previous.implemented,
    current: current.implemented,
  });
}

/** Deletes every `nodeType` child linked to this Spec whose xid isn't in `validXids` — upsert-by-xid never removes nodes, so this reverse-edge sweep is what keeps re-projection idempotent. */
export async function pruneOrphans(
  context: ProjectionContext,
  nodeType: SpecTraceNodeType,
  validXids: Set<string>,
  forwardEdge?: string,
): Promise<void> {
  const { dgraph, repo, filePath, specUid } = context;
  const specXid = `${repo}|${filePath}`;
  const children = await readSpecChildren(dgraph, specXid, nodeType);
  const orphanUids = children
    .filter((child) => !validXids.has(child.xid))
    .map((child) => child.uid);

  if (orphanUids.length === 0) {
    return;
  }
  await deleteNquads(
    dgraph,
    orphanDeleteNquads(orphanUids, specUid, forwardEdge),
  );
}

/** Reads this Spec's `nodeType` children through the reverse `.spec` edge, as uid + xid pairs. */
async function readSpecChildren(
  dgraph: DgraphClientPort,
  specXid: string,
  nodeType: SpecTraceNodeType,
): Promise<Array<{ uid: string; xid: string }>> {
  const xidPredicate = `${nodeType}.xid`;

  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(specChildrenQuery(nodeType), {
      $xid: specXid,
    });
    const spec = (res.data.spec ?? []) as Array<{
      children?: Array<{ uid: string } & Record<string, string>>;
    }>;

    return (spec[0]?.children ?? []).map((child) => ({
      uid: child.uid,
      xid: child[xidPredicate],
    }));
  });
}

/** The query reading a Spec's `nodeType` children on the reverse `.spec` edge, each with its uid and xid. */
function specChildrenQuery(nodeType: SpecTraceNodeType): string {
  return `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) { children: ~${nodeType}.spec { uid ${nodeType}.xid } }
      }`;
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

/** Commits one delete-nquads mutation in its own txn. */
async function deleteNquads(
  dgraph: DgraphClientPort,
  nquads: string,
): Promise<void> {
  await withTxn(dgraph, async (txn) => {
    await txn.mutate({ deleteNquads: nquads, commitNow: true });
  });
}
