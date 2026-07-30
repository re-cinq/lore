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
 *
 * Crash safety: each subtree delete cleans chunks, Feature, and Blocks FIRST
 * and drops the doc node + its Repo edge LAST in one atomic mutation — the
 * doc node is the resume anchor (the projector's `content_hash`-written-last
 * receipt, inverted for deletion). An interrupted prune leaves the doc in
 * `listGraphDocPaths`, so the next run re-picks it and converges.
 */

import type { DgraphClientPort, DgraphTxn, UidRef } from "./deps.js";
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

interface LinkedChild extends UidRef {
  validated?: UidRef[];
  implemented?: UidRef[];
  links?: UidRef[];
}

const uids = (refs: UidRef[] | undefined): string[] =>
  (refs ?? []).map((ref) => ref.uid);

interface DoomedSpecSubtree {
  specUid: string;
  rootUid?: string;
  childUids: string[];
  featureUid?: string;
  validatedUids: string[];
  implementedUids: string[];
}

const SPEC_SUBTREE_QUERY = `query q($xid: string, $repo: string) {
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
}`;

/**
 * Reads the Spec subtree slated for deletion: the Spec uid, every child uid
 * (Statements, Sections, AcceptanceCriteria, their TraceLinks), the Repo root
 * uid, the owning Feature uid, and the link-target chunk uids for GC.
 * Runs inside the caller's txn so the final delete can re-read and mutate in
 * one transaction. Returns null when no such Spec exists.
 */
async function querySpecSubtree(
  txn: DgraphTxn,
  repo: string,
  filePath: string,
): Promise<DoomedSpecSubtree | null> {
  const res = await txn.queryWithVars(SPEC_SUBTREE_QUERY, {
    $xid: `${repo}|${filePath}`,
    $repo: repo,
  });
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
  const rootUid = ((res.data?.root ?? []) as Array<Record<string, string>>)[0]
    ?.uid;
  const feature = Array.isArray(spec.feature) ? spec.feature[0] : spec.feature;

  // Dedupe: TestChunks are file-scoped (xid `${repo}|${path}`), so many
  // statements/ACs in one spec point at the same chunk uid. Without the
  // Set, gcOrphanChunks runs its ownership query + delete once per duplicate
  // (all but the first a no-op) — a 40-statement spec would fire ~40
  // redundant txns instead of one.
  return {
    specUid: spec.uid,
    rootUid,
    childUids,
    featureUid: feature?.uid,
    validatedUids: [
      ...new Set(children.flatMap((child) => uids(child.validated))),
    ],
    implementedUids: [
      ...new Set(children.flatMap((child) => uids(child.implemented))),
    ],
  };
}

/**
 * Deletes a Spec's whole subtree: the Spec, its Statements, Sections,
 * AcceptanceCriteria and their TraceLinks, the `Repo.specs` edge, its Blocks,
 * plus GC of link-target chunks and the owning Feature — each only when
 * nothing else still owns them. A missing Spec is a no-op (idempotent).
 * Anchor-deleted-last for crash resume — see the module header.
 */
export async function deleteSpecSubtree(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<void> {
  const doomed = await withTxn(dgraph, (txn) =>
    querySpecSubtree(txn, repo, filePath),
  );

  if (!doomed) {
    return;
  }

  // The ownership queries see the doomed Statements/ACs still alive, so their
  // uids are excluded: a chunk owned ONLY by this spec's children is orphaned,
  // while one still validated by another doc, or carrying coverage, survives.
  const doomedOwners = new Set(doomed.childUids);

  await gcOrphanChunks(
    dgraph,
    "TestChunk",
    doomed.validatedUids,
    [],
    doomedOwners,
  );
  await gcOrphanChunks(
    dgraph,
    "CodeChunk",
    doomed.implementedUids,
    [],
    doomedOwners,
  );

  if (doomed.featureUid) {
    await gcFeatureIfOrphan(dgraph, doomed.featureUid, doomed.specUid);
  }

  // An empty valid set makes the file-scoped Block sweep delete every Block.
  await pruneOrphanBlocksByFile(dgraph, repo, filePath, new Set());

  // The final atomic step: re-query inside the mutating txn so the delete
  // acts on fresh uids rather than the earlier read's snapshot (Dgraph only
  // detects write-write conflicts, so the double read is the staleness guard).
  await withTxn(dgraph, async (txn) => {
    const target = await querySpecSubtree(txn, repo, filePath);

    if (!target) {
      return;
    }
    const deletes = [
      `<${target.specUid}> * * .`,
      ...target.childUids.map((uid) => `<${uid}> * * .`),
    ];

    if (target.rootUid) {
      // `<uid> * * .` only drops OUTGOING edges — the Repo keeps a dangling
      // forward ref unless its edge is deleted explicitly (pruneOrphans lesson).
      deletes.push(`<${target.rootUid}> <Repo.specs> <${target.specUid}> .`);
    }
    await txn.mutate({ deleteNquads: deletes.join("\n"), commitNow: true });
  });
}

/**
 * Deletes a Feature node once no Spec other than `excludedSpecUid` points at
 * it. The exclusion lets the GC run while the doomed Spec still exists (it is
 * deleted last as the prune's resume anchor), and makes a resumed run converge:
 * a Feature already deleted by a prior attempt just re-checks as ownerless.
 */
async function gcFeatureIfOrphan(
  dgraph: DgraphClientPort,
  featureUid: string,
  excludedSpecUid: string,
): Promise<void> {
  await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($uid: string) {
        node(func: uid($uid)) { owners: ~Spec.feature { uid } }
      }`,
      { $uid: featureUid },
    );
    const owners = (res.data?.node?.[0]?.owners ?? []) as UidRef[];
    const remaining = owners.filter((owner) => owner.uid !== excludedSpecUid);

    if (remaining.length === 0) {
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
 * Statements'/AcceptanceCriteria's `trace_links` edges), and its Blocks.
 * Missing ADR → no-op.
 * Same anchor-deleted-last order as {@link deleteSpecSubtree}.
 */
export async function deleteAdrSubtree(
  dgraph: DgraphClientPort,
  repo: string,
  filePath: string,
): Promise<void> {
  const exists = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(
      `query q($xid: string) {
        adr(func: eq(ADR.xid, $xid), first: 1) { uid }
      }`,
      { $xid: `${repo}|${filePath}` },
    );

    return (res.data?.adr ?? []).length > 0;
  });

  if (!exists) {
    return;
  }

  await pruneOrphanBlocksByFile(dgraph, repo, filePath, new Set());

  await withTxn(dgraph, async (txn) => {
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
            acOwners: ~AcceptanceCriterion.trace_links { uid }
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
      links?: Array<UidRef & { stmt?: UidRef[] | UidRef; acOwners?: UidRef[] }>;
    } | null;

    if (!adr) {
      return;
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

      // Symmetric to the Statement back-edge above: an AcceptanceCriterion
      // owning this TraceLink would keep a dangling `trace_links` forward ref.
      for (const ownerUid of uids(link.acOwners)) {
        deletes.push(
          `<${ownerUid}> <AcceptanceCriterion.trace_links> <${link.uid}> .`,
        );
      }
    }
    const rootUid = ((res.data?.root ?? []) as Array<Record<string, string>>)[0]
      ?.uid;

    if (rootUid) {
      deletes.push(`<${rootUid}> <Repo.adrs> <${adr.uid}> .`);
    }
    await txn.mutate({ deleteNquads: deletes.join("\n"), commitNow: true });
  });
}
