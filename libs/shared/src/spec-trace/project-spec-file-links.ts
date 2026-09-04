/** Linked-chunk projection + orphan pruning shared by Statement/AcceptanceCriterion projection: parses inline test/code links into TestChunk/CodeChunk edges, and sweeps stale children whose xid no longer matches the current segmentation. */

import type { DgraphClientPort, SpecLinkRef } from "./deps.js";
import {
  parseTestLinksInStatement,
  parseCodeLinksInStatement,
} from "./deps.js";
import {
  withTxn,
  upsertByXid,
  replaceEdge,
  type SpecTraceNodeType,
} from "./dgraph-upsert.js";
import { repoRelativeLinkTarget } from "./link-target-path.js";
import { fileScopedTestChunkXid } from "./test-chunk-identity.js";
import { gcOrphanChunks } from "./gc-orphan-chunks.js";
import type { ProjectionContext } from "./project-spec-file.js";

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

/** Parses inline links in `text`, upserts one chunk node of `nodeType` per link, and returns their uids; shared by the file-scoped `validated_by` (TestChunk) and line-scoped `implemented_by` (CodeChunk) facets. */
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
export async function pruneOrphans(
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
