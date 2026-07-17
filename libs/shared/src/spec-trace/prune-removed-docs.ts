/**
 * spec-traceability-graph — whole-file pruning. `runIngestGraph` only visits
 * files present in the repo tree, so a spec/ADR that was moved or deleted left
 * its whole subtree behind forever and the graph-driven web-UI kept rendering
 * it. This module finds graph documents whose `file_path` vanished from the
 * current tree selection and deletes their subtrees.
 *
 * Scope discipline: candidates pass through the SAME selection filter that
 * produced the tree files (prefixes / manifest patterns / glob), so a
 * glob-chunked run can only prune inside its own chunk and a manifest-pattern
 * change never mass-deletes out-of-pattern docs. An empty tree selection prunes
 * nothing — a bad or partial tree read must never wipe the graph. Known
 * residual: a chunk-glob run cannot prune a fully deleted directory (chunk
 * globs are derived from the current tree); the next unchunked ingest sweeps it.
 */

import type { DgraphClientPort } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import { pruneOrphanBlocksByFile } from "./project-blocks.js";
import { gcOrphanChunks } from "./gc-orphan-chunks.js";

/** Document node types with a whole-file subtree to prune. */
export type PrunableDocType = "Spec" | "ADR";

/**
 * Graph doc paths that are in scope for this run but absent from the tree
 * selection. Empty `selectedFiles` → no candidates (the bad-tree-read fuse).
 */
export function selectPruneCandidates(
  graphDocPaths: string[],
  selectedFiles: string[],
  isInScope: (path: string) => boolean,
): string[] {
  if (selectedFiles.length === 0) {
    return [];
  }
  const selected = new Set(selectedFiles);

  return graphDocPaths.filter((path) => isInScope(path) && !selected.has(path));
}

/**
 * The `file_path` of every document of `docType` for a repo. `docType` is a
 * trusted internal constant, never user input, so it is safe to interpolate
 * into the query predicates (same justification as `pruneOrphans`).
 */
export async function listGraphDocPaths(
  dgraph: DgraphClientPort,
  docType: PrunableDocType,
  repo: string,
): Promise<string[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($repo: string) {
        docs(func: eq(${docType}.repo, $repo)) { ${docType}.file_path }
      }`,
      { $repo: repo },
    );
    const docs = (res.data?.docs ?? []) as Array<Record<string, string>>;

    return docs
      .map((doc) => doc[`${docType}.file_path`])
      .filter((path): path is string => typeof path === "string");
  });
}

interface UidRef {
  uid: string;
}

interface LinkedChild extends UidRef {
  validated?: UidRef[];
  implemented?: UidRef[];
  links?: UidRef[];
}

const uids = (refs: UidRef[] | undefined): string[] =>
  (refs ?? []).map((ref) => ref.uid);

/**
 * Deletes a Spec's whole subtree: the Spec, its Statements, Sections,
 * AcceptanceCriteria and their TraceLinks, the `Repo.specs` edge, its Blocks,
 * plus GC of link-target chunks and the owning Feature — each only when
 * nothing else still owns them. A missing Spec is a no-op (idempotent).
 */
export async function deleteSpecSubtree(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<void> {
  const doomed = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($xid: string, $repo: string) {
        spec(func: eq(Spec.xid, $xid), first: 1) {
          uid
          feature: Spec.feature { uid }
          statements: ~Statement.spec {
            uid
            validated: Statement.validated_by { uid }
            implemented: Statement.implemented_by { uid }
            links: Statement.trace_links { uid }
          }
          sections: ~Section.spec { uid }
          acs: ~AcceptanceCriterion.spec {
            uid
            validated: AcceptanceCriterion.validated_by { uid }
            implemented: AcceptanceCriterion.implemented_by { uid }
            links: AcceptanceCriterion.trace_links { uid }
          }
        }
        root(func: eq(Repo.xid, $repo), first: 1) { uid }
      }`,
      { $xid: `${repo}|${filePath}`, $repo: repo },
    );
    const spec = (res.data?.spec?.[0] ?? null) as
      | ({ feature?: UidRef[] | UidRef } & {
          uid: string;
          statements?: LinkedChild[];
          sections?: UidRef[];
          acs?: LinkedChild[];
        })
      | null;

    if (!spec) {
      return null;
    }
    const children = [
      ...(spec.statements ?? []),
      ...(spec.acs ?? []),
    ] as LinkedChild[];
    const childUids = [
      ...children.map((child) => child.uid),
      ...uids(spec.sections),
      ...children.flatMap((child) => uids(child.links)),
    ];
    const deletes = [
      `<${spec.uid}> * * .`,
      ...childUids.map((uid) => `<${uid}> * * .`),
    ];
    const rootUid = ((res.data?.root ?? []) as Array<Record<string, string>>)[0]
      ?.uid;

    if (rootUid) {
      // `<uid> * * .` only drops OUTGOING edges — the Repo keeps a dangling
      // forward ref unless its edge is deleted explicitly (pruneOrphans lesson).
      deletes.push(`<${rootUid}> <Repo.specs> <${spec.uid}> .`);
    }
    await txn.mutate({ deleteNquads: deletes.join("\n"), commitNow: true });

    const feature = Array.isArray(spec.feature)
      ? spec.feature[0]
      : spec.feature;

    // Dedupe: TestChunks are file-scoped (xid `${repo}|${path}`), so many
    // statements/ACs in one spec point at the same chunk uid. Without the
    // Set, gcOrphanChunks runs its ownership query + delete once per duplicate
    // (all but the first a no-op) — a 40-statement spec would fire ~40
    // redundant txns instead of one.
    return {
      featureUid: feature?.uid,
      validatedUids: [
        ...new Set(children.flatMap((child) => uids(child.validated))),
      ],
      implementedUids: [
        ...new Set(children.flatMap((child) => uids(child.implemented))),
      ],
    };
  });

  if (!doomed) {
    return;
  }

  // An empty valid set makes the file-scoped Block sweep delete every Block.
  await pruneOrphanBlocksByFile(dgraph, repo, filePath, new Set());

  // Runs AFTER the node delete so the ownership query sees the post-delete
  // state: a chunk still validated by another doc, or carrying coverage,
  // survives.
  await gcOrphanChunks(dgraph, "TestChunk", doomed.validatedUids, []);
  await gcOrphanChunks(dgraph, "CodeChunk", doomed.implementedUids, []);

  if (doomed.featureUid) {
    await gcFeatureIfOrphan(dgraph, doomed.featureUid);
  }
}

/** Deletes a Feature node once no Spec points at it any more. */
async function gcFeatureIfOrphan(
  dgraph: DgraphClientPort,
  featureUid: string,
): Promise<void> {
  await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($uid: string) {
        node(func: uid($uid)) { owners: ~Spec.feature { uid } }
      }`,
      { $uid: featureUid },
    );
    const owners = (res.data?.node?.[0]?.owners ?? []) as UidRef[];

    if (owners.length === 0) {
      await txn.mutate({
        deleteNquads: `<${featureUid}> * * .`,
        commitNow: true,
      });
    }
  });
}

/**
 * Deletes an ADR's subtree: the ADR node, the `Repo.adrs` edge, incoming
 * `Statement.decided_by` / `AcceptanceCriterion.decided_by` /
 * `ADR.supersedes` refs, the TraceLinks targeting it (and their owning
 * statements' `trace_links` edges), and its Blocks. Missing ADR → no-op.
 */
export async function deleteAdrSubtree(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<void> {
  const found = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($xid: string, $repo: string) {
        adr(func: eq(ADR.xid, $xid), first: 1) {
          uid
          citers: ~Statement.decided_by { uid }
          acCiters: ~AcceptanceCriterion.decided_by { uid }
          superseders: ~ADR.supersedes { uid }
          links: ~TraceLink.target {
            uid
            stmt: TraceLink.statement { uid }
          }
        }
        root(func: eq(Repo.xid, $repo), first: 1) { uid }
      }`,
      { $xid: `${repo}|${filePath}`, $repo: repo },
    );
    const adr = (res.data?.adr?.[0] ?? null) as {
      uid: string;
      citers?: UidRef[];
      acCiters?: UidRef[];
      superseders?: UidRef[];
      links?: Array<UidRef & { stmt?: UidRef[] | UidRef }>;
    } | null;

    if (!adr) {
      return false;
    }
    const deletes = [
      `<${adr.uid}> * * .`,
      ...uids(adr.citers).map(
        (uid) => `<${uid}> <Statement.decided_by> <${adr.uid}> .`,
      ),
      ...uids(adr.acCiters).map(
        (uid) => `<${uid}> <AcceptanceCriterion.decided_by> <${adr.uid}> .`,
      ),
      ...uids(adr.superseders).map(
        (uid) => `<${uid}> <ADR.supersedes> <${adr.uid}> .`,
      ),
    ];

    for (const link of adr.links ?? []) {
      deletes.push(`<${link.uid}> * * .`);
      const stmt = Array.isArray(link.stmt) ? link.stmt[0] : link.stmt;

      if (stmt) {
        deletes.push(`<${stmt.uid}> <Statement.trace_links> <${link.uid}> .`);
      }
    }
    const rootUid = ((res.data?.root ?? []) as Array<Record<string, string>>)[0]
      ?.uid;

    if (rootUid) {
      deletes.push(`<${rootUid}> <Repo.adrs> <${adr.uid}> .`);
    }
    await txn.mutate({ deleteNquads: deletes.join("\n"), commitNow: true });

    return true;
  });

  if (found) {
    await pruneOrphanBlocksByFile(dgraph, repo, filePath, new Set());
  }
}
