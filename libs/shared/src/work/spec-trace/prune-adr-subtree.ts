/** ADR whole-file subtree deletion: node, `Repo.adrs` edge, incoming decided_by/supersedes refs, targeting TraceLinks, and Blocks. Same anchor-deleted-last order as the Spec subtree deleter it sits beside. */

import type { DgraphClientPort, DgraphTxn, UidRef } from "./deps.js";
import { withTxn } from "./dgraph-upsert.js";
import { pruneOrphanBlocksByFile } from "./project-blocks.js";
import { firstOf, uids } from "./uid-refs.js";

/** Deletes an ADR's subtree (node, Repo.adrs edge, incoming decided_by/supersedes refs, targeting TraceLinks, Blocks); missing ADR is a no-op; same anchor-deleted-last order as {@link deleteSpecSubtree}. */
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

    return (res.data.adr ?? []).length > 0;
  });

  if (!exists) {
    return;
  }

  await pruneOrphanBlocksByFile(dgraph, repo, filePath, new Set());

  await withTxn(dgraph, (txn) => deleteAdrTxn(txn, repo, filePath));
}

const DELETE_ADR_QUERY = `query q($xid: string, $repo: string) {
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
}`;

async function deleteAdrTxn(
  txn: DgraphTxn,
  repo: string,
  filePath: string,
): Promise<void> {
  const res = await txn.queryWithVars(DELETE_ADR_QUERY, {
    $xid: `${repo}|${filePath}`,
    $repo: repo,
  });
  const adr = firstOf(res.data.adr as QueriedAdr[] | undefined);

  if (!adr) {
    return;
  }
  const rootUid = firstOf(
    res.data.root as Array<Record<string, string>> | undefined,
  )?.uid;
  const deletes = buildAdrDeletes(adr, rootUid);

  await txn.mutate({ deleteNquads: deletes.join("\n"), commitNow: true });
}

type QueriedAdr = {
  uid: string;
  citers?: UidRef[];
  acCiters?: UidRef[];
  superseders?: UidRef[];
  links?: Array<UidRef & { stmt?: UidRef[] | UidRef; acOwners?: UidRef[] }>;
};

/** Back-references naming `adr.uid` that also need deleting, plus the ADR node itself and its `Repo.adrs` edge. */
function buildAdrDeletes(
  adr: QueriedAdr,
  rootUid: string | undefined,
): string[] {
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
    ...(adr.links ?? []).flatMap((link) => adrLinkDeletes(link)),
  ];

  if (rootUid) {
    deletes.push(`<${rootUid}> <Repo.adrs> <${adr.uid}> .`);
  }

  return deletes;
}

/** Deletes for one incoming TraceLink: the link node itself, the citing Statement's forward ref (if any), and every citing AcceptanceCriterion's forward ref (symmetric back-edge — an owner would otherwise keep a dangling `trace_links` ref). */
function adrLinkDeletes(
  link: NonNullable<QueriedAdr["links"]>[number],
): string[] {
  const stmt = Array.isArray(link.stmt) ? link.stmt[0] : link.stmt;
  const deletes = [`<${link.uid}> * * .`];

  if (stmt) {
    deletes.push(`<${stmt.uid}> <Statement.trace_links> <${link.uid}> .`);
  }
  deletes.push(
    ...uids(link.acOwners).map(
      (ownerUid) =>
        `<${ownerUid}> <AcceptanceCriterion.trace_links> <${link.uid}> .`,
    ),
  );

  return deletes;
}
