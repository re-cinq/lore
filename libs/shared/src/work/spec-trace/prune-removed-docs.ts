/** Whole-file graph pruning: deletes the subtree of any Spec/ADR whose `file_path` vanished from the tree selection. Bad-tree-read fuse refuses a candidate set >2 docs and >50% of in-scope docs (bypassable via `force`); anchor-deleted-last (doc node + Repo edge) for crash-resume convergence. */

import type {
  DgraphClientPort,
  DgraphTxn,
  UidRef,
} from "../../outbound/spec-trace/deps.js";
import { withTxn } from "../../outbound/spec-trace/dgraph-upsert.js";
import { pruneOrphanBlocksByFile } from "./project-blocks.js";
import { gcOrphanChunks } from "./gc-orphan-chunks.js";
import { uids, firstOf } from "./uid-refs.js";

export { uids, firstOf } from "./uid-refs.js";

/** Document node types with a whole-file subtree to prune. */
export type PrunableDocType = "Spec" | "ADR";

/** The prune selection, or its refusal — `refused-suspicious-tree` means the candidates look like a partial tree read, not real deletions; caller must prune nothing. */
export type PruneSelection =
  | { outcome: "ok"; candidates: string[] }
  | {
      outcome: "refused-suspicious-tree";
      candidateCount: number;
      inScopeDocCount: number;
    };

/** The refusal per the proportional bad-tree-read fuse (>2 candidates AND >50% of in-scope docs), or null when the candidate set is trustworthy. */
function badTreeReadRefusal(
  candidates: string[],
  inScopeDocs: string[],
): PruneSelection | null {
  if (candidates.length <= 2 || candidates.length * 2 <= inScopeDocs.length) {
    return null;
  }

  return {
    outcome: "refused-suspicious-tree",
    candidateCount: candidates.length,
    inScopeDocCount: inScopeDocs.length,
  };
}

/** Graph doc paths in scope but absent from the tree selection, or a refusal per the proportional bad-tree-read fuse (>2 candidates AND >50% of in-scope docs); empty selection always passes with zero candidates; `force` bypasses the fuse but not the empty guard. */
export function selectPruneCandidates(
  graphDocPaths: string[],
  selectedFiles: string[],
  isInScope: (path: string) => boolean,
  force = false,
): PruneSelection {
  if (selectedFiles.length === 0) {
    return { outcome: "ok", candidates: [] };
  }
  const selected = new Set(selectedFiles);
  const inScopeDocs = graphDocPaths.filter(isInScope);
  const candidates = inScopeDocs.filter((path) => !selected.has(path));
  const refusal = force ? null : badTreeReadRefusal(candidates, inScopeDocs);

  return refusal ?? { outcome: "ok", candidates };
}

/** The `file_path` of every document of `docType` for a repo; `docType` is a trusted internal constant, safe to interpolate into query predicates. */
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
    const docs = (res.data.docs ?? []) as Array<Record<string, string>>;

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

type QueriedSpec = { feature?: UidRef[] | UidRef } & {
  uid: string;
  statements?: LinkedChild[];
  sections?: UidRef[];
  acs?: LinkedChild[];
};

/** Every node the spec owns outright: its statements and ACs, its sections, and the TraceLinks those children point at. */
function subtreeChildUids(
  children: LinkedChild[],
  sections: UidRef[] | undefined,
): string[] {
  return [
    ...children.map((child) => child.uid),
    ...uids(sections),
    ...children.flatMap((child) => uids(child.links)),
  ];
}

/** Dedupe: TestChunks are file-scoped, so many statements/ACs point at the same chunk uid — without the Set a 40-statement spec fires ~40 redundant gcOrphanChunks txns. */
function uniqueLinkTargets(
  children: LinkedChild[],
  edge: "validated" | "implemented",
): string[] {
  return [...new Set(children.flatMap((child) => uids(child[edge])))];
}

/** Assembles the doomed subtree from a raw query result's `spec`/`root` payloads. */
function buildDoomedSpecSubtree(
  spec: QueriedSpec,
  rootUid: string | undefined,
): DoomedSpecSubtree {
  const children = [
    ...(spec.statements ?? []),
    ...(spec.acs ?? []),
  ] as LinkedChild[];
  const feature = Array.isArray(spec.feature) ? spec.feature[0] : spec.feature;

  return {
    specUid: spec.uid,
    rootUid,
    childUids: subtreeChildUids(children, spec.sections),
    featureUid: feature?.uid,
    validatedUids: uniqueLinkTargets(children, "validated"),
    implementedUids: uniqueLinkTargets(children, "implemented"),
  };
}

/** Reads the Spec subtree slated for deletion (Spec/children/Repo-root/Feature/link-target uids); called both read-only (GC inputs) and inside the final mutating txn (fresh-uid staleness guard). Null if no such Spec. */
async function querySpecSubtree(
  txn: DgraphTxn,
  repo: string,
  filePath: string,
): Promise<DoomedSpecSubtree | null> {
  const res = await txn.queryWithVars(SPEC_SUBTREE_QUERY, {
    $xid: `${repo}|${filePath}`,
    $repo: repo,
  });
  const spec = firstOf(res.data.spec as QueriedSpec[] | undefined);

  if (!spec) {
    return null;
  }
  const rootUid = firstOf(
    res.data.root as Array<Record<string, string>> | undefined,
  )?.uid;

  return buildDoomedSpecSubtree(spec, rootUid);
}

/** Collects what the spec's subtree was the last owner of. The ownership queries still see the doomed Statements and ACs alive, so their uids are excluded from the owner check — otherwise a chunk owned ONLY by this spec's children would look owned and survive as an orphan. The Feature goes too, but only once nothing else claims it. */
async function gcSpecLeavings(
  dgraph: DgraphClientPort,
  doomed: SpecSubtree,
): Promise<void> {
  const excludeOwners = new Set(doomed.childUids);

  await gcOrphanChunks(dgraph, "TestChunk", {
    previous: doomed.validatedUids,
    current: [],
    excludeOwners,
  });
  await gcOrphanChunks(dgraph, "CodeChunk", {
    previous: doomed.implementedUids,
    current: [],
    excludeOwners,
  });

  if (doomed.featureUid) {
    await gcFeatureIfOrphan(dgraph, doomed.featureUid, doomed.specUid);
  }
}

/** What {@link querySpecSubtree} returns when the spec exists. */
type SpecSubtree = NonNullable<Awaited<ReturnType<typeof querySpecSubtree>>>;

/** Re-queries inside the mutating txn so the delete acts on fresh uids, not the earlier read's snapshot (Dgraph only detects write-write conflicts). */
async function deleteSpecSubtreeTxn(
  txn: DgraphTxn,
  repo: string,
  filePath: string,
): Promise<void> {
  const target = await querySpecSubtree(txn, repo, filePath);

  if (!target) {
    return;
  }
  const deletes = [
    `<${target.specUid}> * * .`,
    ...target.childUids.map((uid) => `<${uid}> * * .`),
  ];

  if (target.rootUid) {
    // `<uid> * * .` only drops OUTGOING edges — the Repo keeps a dangling forward ref unless its edge is deleted explicitly.
    deletes.push(`<${target.rootUid}> <Repo.specs> <${target.specUid}> .`);
  }
  await txn.mutate({ deleteNquads: deletes.join("\n"), commitNow: true });
}

/** Deletes a Spec's whole subtree plus GC of link-target chunks and the owning Feature (only when ownerless); missing Spec is a no-op; anchor-deleted-last for crash resume. */
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

  await gcSpecLeavings(dgraph, doomed);

  // An empty valid set makes the file-scoped Block sweep delete every Block.
  await pruneOrphanBlocksByFile(dgraph, repo, filePath, new Set());

  await withTxn(dgraph, (txn) => deleteSpecSubtreeTxn(txn, repo, filePath));
}

/** The Specs still pointing at this Feature, ignoring the one being deleted. */
async function remainingFeatureOwners(
  txn: DgraphTxn,
  featureUid: string,
  excludedSpecUid: string,
): Promise<UidRef[]> {
  const res = await txn.queryWithVars(
    `query q($uid: string) {
        node(func: uid($uid)) { owners: ~Spec.feature { uid } }
      }`,
    { $uid: featureUid },
  );
  const nodes = (res.data.node ?? []) as Array<{ owners?: UidRef[] }>;
  const owners = nodes[0]?.owners ?? [];

  return owners.filter((owner) => owner.uid !== excludedSpecUid);
}

/** Deletes a Feature node once no Spec other than `excludedSpecUid` points at it — lets GC run while the doomed Spec (the resume anchor) still exists, and re-checking makes a resumed run converge. */
async function gcFeatureIfOrphan(
  dgraph: DgraphClientPort,
  featureUid: string,
  excludedSpecUid: string,
): Promise<void> {
  await withTxn(dgraph, async (txn) => {
    const remaining = await remainingFeatureOwners(
      txn,
      featureUid,
      excludedSpecUid,
    );

    if (remaining.length === 0) {
      await txn.mutate({
        deleteNquads: `<${featureUid}> * * .`,
        commitNow: true,
      });
    }
  });
}

export { deleteAdrSubtree } from "./prune-adr-subtree.js";
