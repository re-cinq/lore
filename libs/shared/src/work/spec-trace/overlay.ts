/** The per-run branch overlay's lifecycle (issue #1769): the anchor a run's branch-scoped chunks hang off, and the drop that removes them when the run ends. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import {
  withTxn,
  upsertByXid,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import {
  overlayScope,
  type TraceScope,
} from "../../domain/spec-trace/trace-scope.js";

/** The edges an overlay anchors its nodes on — the drop walks exactly these to find what to delete. */
const ANCHORED_EDGES = [
  "Overlay.code_chunks",
  "Overlay.test_chunks",
  "Overlay.test_suites",
  "Overlay.coverage",
  "Overlay.files",
] as const;

/** Uids per delete mutation; a run that touched hundreds of files would otherwise send one enormous N-Quads body. */
const DELETE_BATCH = 500;

/** One run's overlay: which branch it describes and the commit its line numbers are expressed in. */
export interface OverlayRecord {
  assemblyRunId: string;
  repo: string;
  branch: string;
  headCommit: string;
  writtenAt: string;
}

interface GraphOverlay {
  uid?: string;
  "Overlay.repo"?: string;
  "Overlay.assembly_run_id"?: string;
  "Overlay.branch"?: string;
  "Overlay.head_commit"?: string;
  "Overlay.written_at"?: string;
}

const OVERLAY_FIELDS = `uid
    Overlay.repo
    Overlay.assembly_run_id
    Overlay.branch
    Overlay.head_commit
    Overlay.written_at`;

const READ_QUERY = `query q($xid: string) {
  ov(func: eq(Overlay.xid, $xid)) { ${OVERLAY_FIELDS} }
}`;

const LIST_QUERY = `query q($repo: string) {
  ov(func: eq(Overlay.repo, $repo)) { ${OVERLAY_FIELDS} }
}`;

const ANCHORED_QUERY = `query q($xid: string) {
  ov(func: eq(Overlay.xid, $xid)) {
    uid
${ANCHORED_EDGES.map((edge) => `    ${edge} { uid }`).join("\n")}
  }
}`;

function toRecord(row: GraphOverlay): OverlayRecord {
  return {
    assemblyRunId: row["Overlay.assembly_run_id"] ?? "",
    repo: row["Overlay.repo"] ?? "",
    branch: row["Overlay.branch"] ?? "",
    headCommit: row["Overlay.head_commit"] ?? "",
    writtenAt: row["Overlay.written_at"] ?? "",
  };
}

/** Stamps the run's overlay anchor with the branch head its chunks are expressed in — the overlay's answer to `Repo.trace_commit`. */
export async function upsertOverlay(
  dgraph: DgraphClientPort,
  scope: TraceScope,
  meta: { branch: string; headCommit: string; at?: Date },
): Promise<string> {
  return upsertByXid(dgraph, "Overlay", scope.key, {
    "Overlay.repo": scope.repo,
    "Overlay.assembly_run_id": scope.assemblyRunId,
    "Overlay.branch": meta.branch,
    "Overlay.head_commit": meta.headCommit,
    "Overlay.written_at": (meta.at ?? new Date()).toISOString(),
  });
}

/** The overlay a run wrote, or null when it never wrote one. */
export async function readOverlay(
  dgraph: DgraphClientPort,
  repo: string,
  assemblyRunId: string,
): Promise<OverlayRecord | null> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(READ_QUERY, {
      $xid: overlayScope(repo, assemblyRunId).key,
    });

    return (res.data.ov ?? []) as GraphOverlay[];
  });

  return rows.length ? toRecord(rows[0]) : null;
}

/** Every overlay a repo currently holds — the sweep's input for runs whose drop never ran. */
export async function listOverlays(
  dgraph: DgraphClientPort,
  repo: string,
): Promise<OverlayRecord[]> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(LIST_QUERY, { $repo: repo });

    return (res.data.ov ?? []) as GraphOverlay[];
  });

  return rows.map(toRecord);
}

/** Every uid the overlay owns, the anchor last so a partial delete still leaves the anchor to retry from. */
async function anchoredUids(
  dgraph: DgraphClientPort,
  xid: string,
): Promise<string[]> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(ANCHORED_QUERY, { $xid: xid });

    return (res.data.ov ?? []) as Record<string, unknown>[];
  });

  if (!rows.length) {
    return [];
  }
  const anchor = rows[0];
  const owned = ANCHORED_EDGES.flatMap(
    (edge) => (anchor[edge] ?? []) as { uid: string }[],
  ).map((ref) => ref.uid);

  return [...new Set(owned), anchor.uid as string];
}

async function deleteUids(
  dgraph: DgraphClientPort,
  uids: string[],
): Promise<void> {
  for (let at = 0; at < uids.length; at += DELETE_BATCH) {
    const batch = uids.slice(at, at + DELETE_BATCH);

    await withTxn(dgraph, (txn) =>
      txn.mutate({
        deleteNquads: batch.map((uid) => `<${uid}> * * .`).join("\n"),
        commitNow: true,
      }),
    );
  }
}

/** Deletes everything the run's overlay anchors plus the anchor itself, and reports how many nodes went. Safe to call twice: a run with no overlay drops nothing. */
export async function dropOverlay(
  dgraph: DgraphClientPort,
  repo: string,
  assemblyRunId: string,
): Promise<number> {
  const uids = await anchoredUids(
    dgraph,
    overlayScope(repo, assemblyRunId).key,
  );

  await deleteUids(dgraph, uids);

  return uids.length;
}
