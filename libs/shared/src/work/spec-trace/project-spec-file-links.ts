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
import type { ProjectionContext } from "./project-spec-file-context.js";

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

/** One linked-chunk facet: how its links are parsed out of a statement, the node type they become, how each is identified, and any extra fields it carries. */
interface LinkedChunkKind {
  parse: LinkParser;
  nodeType: SpecTraceNodeType;
  buildXid: ChunkXid;
  extraFields?: ExtraChunkFields;
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
  extraFields: ExtraChunkFields,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    [`${nodeType}.repo`]: repo,
    [`${nodeType}.file_path`]: link.path,
    ...extraFields(link),
  };

  if (link.line != null) {
    fields[`${nodeType}.start_line`] = link.line;
  }

  return fields;
}

/** Parses inline links in `text`, upserts one chunk node of `nodeType` per link, and returns their uids; shared by the file-scoped `validated_by` (TestChunk) and line-scoped `implemented_by` (CodeChunk) facets. */
async function projectLinkedChunks(
  context: ProjectionContext,
  text: string,
  { parse, nodeType, buildXid, extraFields = () => ({}) }: LinkedChunkKind,
): Promise<string[]> {
  const { dgraph, repo, filePath } = context;
  const uids: string[] = [];

  for (const link of resolvedLinks(filePath, text, parse)) {
    uids.push(
      await upsertByXid(
        dgraph,
        nodeType,
        buildXid(repo, link),
        chunkFields(repo, link, nodeType, extraFields),
      ),
    );
  }

  return uids;
}

/** The `validated_by`/`implemented_by` predicate names for one owner node type (Statement or AcceptanceCriterion). */
export interface LinkPredicates {
  validatedBy: string;
  implementedBy: string;
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
    extraFields: (link) => ({
      "TestChunk.test_name": link.label,
      "TestChunk.link_label": link.label,
    }),
  });
}

/** The code chunks this text links to, keyed by LINE range — a code link names a span, and a span that moves is a different span. */
async function projectCodeLinks(
  context: ProjectionContext,
  text: string,
): Promise<string[]> {
  return projectLinkedChunks(context, text, {
    parse: parseCodeLinksInStatement,
    nodeType: "CodeChunk",
    buildXid: lineScopedXid,
  });
}

/** The uids an owner node currently points at on each link predicate. */
interface LinkTargets {
  validated: string[];
  implemented: string[];
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
    const node = (res.data.node?.[0] ?? {}) as {
      validated?: { uid: string }[];
      implemented?: { uid: string }[];
    };

    return {
      validated: (node.validated ?? []).map((ref) => ref.uid),
      implemented: (node.implemented ?? []).map((ref) => ref.uid),
    };
  });
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

/** The query reading a Spec's `nodeType` children on the reverse `.spec` edge, each with its uid and xid. */
function specChildrenQuery(nodeType: SpecTraceNodeType): string {
  return `query q($xid: string) {
        spec(func: eq(Spec.xid, $xid)) { children: ~${nodeType}.spec { uid ${nodeType}.xid } }
      }`;
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

/** Commits one delete-nquads mutation in its own txn. */
async function deleteNquads(
  dgraph: DgraphClientPort,
  nquads: string,
): Promise<void> {
  await withTxn(dgraph, async (txn) => {
    await txn.mutate({ deleteNquads: nquads, commitNow: true });
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
