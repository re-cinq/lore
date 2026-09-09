/** Station-run failures as graph nodes (issue #1771): what failed, which files it named, and the sha that ended it — so `fix-ci` can ask what has failed here before instead of starting cold. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import {
  withTxn,
  upsertByXid,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import { parseFailureSites, namesCode } from "./failure-sites.js";
import type { FailureSite } from "./failure-sites.js";

/** One failed station-run attempt, as the Floor settles it. */
export interface FailureRecord {
  assemblyRunId: string;
  stationRunId: string;
  nodeId: string;
  iteration: number;
  failureClass: string | null;
  failureDetail: string | null;
  commit: string | null;
  occurredAt?: Date;
}

/** A past failure on a file, as `fix-ci` reads it back. */
export interface FailureHit {
  stationRunId: string;
  nodeId: string;
  iteration: number;
  failureClass: string;
  failureDetail: string;
  commit: string;
  occurredAt: string;
  /** The sha of the attempt that went green where this one failed; absent while the failure still stands. */
  resolvedByCommit?: string;
}

/** What one projection did. Zeroes with `projected: false` mean the failure named no code, not that the write failed. */
export interface FailureProjection {
  projected: boolean;
  files: number;
  chunks: number;
}

const NOT_PROJECTED: FailureProjection = {
  projected: false,
  files: 0,
  chunks: 0,
};

/** Detail is a diagnostic, not an archive — the whole log lives in the run's pod logs, and an unbounded blob on every failed attempt is what makes a graph unqueryable. */
const DETAIL_MAX = 2000;

/** Projects one failed attempt, or nothing at all when the failure names no code. Idempotent on the station run, so a redelivered event does not double-count. */
export async function projectFailure(
  dgraph: DgraphClientPort,
  repo: string,
  record: FailureRecord,
): Promise<FailureProjection> {
  const sites = codeSites(record);

  if (!sites.length) {
    return NOT_PROJECTED;
  }
  const failureUid = await upsertFailure(dgraph, repo, record);
  const files = await linkFiles(dgraph, repo, failureUid, sites);
  const chunks = await linkChunks(dgraph, repo, failureUid, sites);

  await upsertByXid(dgraph, "Repo", repo, {
    "Repo.failures": [{ uid: failureUid }],
  });

  return { projected: true, files, chunks };
}

/** Stamps the sha of the attempt that went green onto every unresolved failure this run left on the node, and reports how many it stamped. */
export async function resolveFailures(
  dgraph: DgraphClientPort,
  repo: string,
  key: { assemblyRunId: string; nodeId: string },
  resolvedByCommit: string,
): Promise<number> {
  const uids = await unresolvedUids(dgraph, repo, key);

  for (const uid of uids) {
    await withTxn(dgraph, (txn) =>
      txn.mutate({
        setJson: { uid, "Failure.resolved_by_commit": resolvedByCommit },
        commitNow: true,
      }),
    );
  }

  return uids.length;
}

/** Every failure recorded against `path`, newest first, each carrying the sha that ended it when one did. */
export async function failuresTouching(
  dgraph: DgraphClientPort,
  repo: string,
  path: string,
): Promise<FailureHit[]> {
  const rows = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(TOUCHING_QUERY, {
      $xid: `${repo}|${path}`,
    });
    const files = (res.data.f ?? []) as {
      failures?: GraphFailure[];
    }[];

    return files.flatMap((file) => file.failures ?? []);
  });

  return rows.map(toHit);
}

/** Reaps failures older than `cutoff` — past that, the retrospective episode carries the lesson in prose and the node is noise. */
export async function pruneFailures(
  dgraph: DgraphClientPort,
  repo: string,
  cutoff: Date,
): Promise<number> {
  const uids = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(STALE_QUERY, {
      $repo: repo,
      $cutoff: cutoff.toISOString(),
    });

    return ((res.data.f ?? []) as { uid: string }[]).map((row) => row.uid);
  });

  for (const uid of uids) {
    await withTxn(dgraph, (txn) =>
      txn.mutate({ deleteNquads: `<${uid}> * * .`, commitNow: true }),
    );
  }

  return uids.length;
}

interface GraphFailure {
  "Failure.station_run_id"?: string;
  "Failure.node_id"?: string;
  "Failure.iteration"?: number;
  "Failure.failure_class"?: string;
  "Failure.failure_detail"?: string;
  "Failure.commit"?: string;
  "Failure.occurred_at"?: string;
  "Failure.resolved_by_commit"?: string;
}

const FAILURE_FIELDS = `Failure.station_run_id
      Failure.node_id
      Failure.iteration
      Failure.failure_class
      Failure.failure_detail
      Failure.commit
      Failure.occurred_at
      Failure.resolved_by_commit`;

const TOUCHING_QUERY = `query q($xid: string) {
  f(func: eq(File.xid, $xid)) {
    failures: ~Failure.files (orderdesc: Failure.occurred_at) {
      ${FAILURE_FIELDS}
    }
  }
}`;

const UNRESOLVED_QUERY = `query q($repo: string, $run: string, $node: string) {
  f(func: eq(Failure.repo, $repo))
    @filter(eq(Failure.assembly_run_id, $run)
      AND eq(Failure.node_id, $node)
      AND NOT has(Failure.resolved_by_commit)) { uid }
}`;

const STALE_QUERY = `query q($repo: string, $cutoff: string) {
  f(func: eq(Failure.repo, $repo))
    @filter(lt(Failure.occurred_at, $cutoff)) { uid }
}`;

const CHUNKS_QUERY = `query q($repo: string, $fp: string) {
  c(func: eq(CodeChunk.file_path, $fp)) @filter(eq(CodeChunk.repo, $repo)) {
    uid
    CodeChunk.start_line
    CodeChunk.end_line
  }
}`;

const HIT_FIELDS = [
  ["stationRunId", "Failure.station_run_id"],
  ["nodeId", "Failure.node_id"],
  ["failureClass", "Failure.failure_class"],
  ["failureDetail", "Failure.failure_detail"],
  ["commit", "Failure.commit"],
  ["occurredAt", "Failure.occurred_at"],
] as const;

function toHit(row: GraphFailure): FailureHit {
  const resolved = row["Failure.resolved_by_commit"];
  const strings = Object.fromEntries(
    HIT_FIELDS.map(([field, predicate]) => [field, row[predicate] ?? ""]),
  ) as Omit<FailureHit, "iteration" | "resolvedByCommit">;

  return {
    ...strings,
    iteration: row["Failure.iteration"] ?? 0,
    ...(resolved ? { resolvedByCommit: resolved } : {}),
  };
}

/** The files this failure implicates, or none when its class names infrastructure rather than code. */
function codeSites(record: FailureRecord): FailureSite[] {
  if (!namesCode(record.failureClass)) {
    return [];
  }

  return parseFailureSites(record.failureDetail ?? "");
}

/** One node per station-run ATTEMPT — the xid makes a redelivered terminal event an update rather than a duplicate. */
async function upsertFailure(
  dgraph: DgraphClientPort,
  repo: string,
  record: FailureRecord,
): Promise<string> {
  return upsertByXid(
    dgraph,
    "Failure",
    `${repo}|failure:${record.stationRunId}`,
    failureFields(repo, record),
  );
}

function failureFields(repo: string, record: FailureRecord) {
  return {
    "Failure.repo": repo,
    "Failure.assembly_run_id": record.assemblyRunId,
    "Failure.station_run_id": record.stationRunId,
    "Failure.node_id": record.nodeId,
    "Failure.iteration": record.iteration,
    "Failure.failure_class": record.failureClass ?? "unknown",
    "Failure.failure_detail": (record.failureDetail ?? "").slice(0, DETAIL_MAX),
    "Failure.commit": record.commit ?? "",
    "Failure.occurred_at": (record.occurredAt ?? new Date()).toISOString(),
  };
}

/** Points the failure at a File node per distinct path it named, minting the node when coverage never has. */
async function linkFiles(
  dgraph: DgraphClientPort,
  repo: string,
  failureUid: string,
  sites: FailureSite[],
): Promise<number> {
  const paths = [...new Set(sites.map((site) => site.path))];
  const uids: string[] = [];

  for (const path of paths) {
    uids.push(
      await upsertByXid(dgraph, "File", `${repo}|${path}`, {
        "File.repo": repo,
        "File.path": path,
      }),
    );
  }
  await setEdge(dgraph, failureUid, "Failure.files", uids);

  return uids.length;
}

/** Points the failure at every CodeChunk whose range contains a line it named; a repo with no projected chunks simply links none. */
async function linkChunks(
  dgraph: DgraphClientPort,
  repo: string,
  failureUid: string,
  sites: FailureSite[],
): Promise<number> {
  const located = sites.filter((site) => site.line !== undefined);
  const found = await Promise.all(
    located.map((site) => chunksAtLine(dgraph, repo, site)),
  );
  const uids = new Set(found.flat());

  await setEdge(dgraph, failureUid, "Failure.chunks", [...uids]);

  return uids.size;
}

async function chunksAtLine(
  dgraph: DgraphClientPort,
  repo: string,
  site: FailureSite,
): Promise<string[]> {
  const chunks = await withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(CHUNKS_QUERY, {
      $repo: repo,
      $fp: site.path,
    });

    return (res.data.c ?? []) as {
      uid: string;
      "CodeChunk.start_line"?: number;
      "CodeChunk.end_line"?: number;
    }[];
  });

  return chunks
    .filter((chunk) => containsLine(chunk, site.line!))
    .map((chunk) => chunk.uid);
}

function containsLine(
  chunk: { "CodeChunk.start_line"?: number; "CodeChunk.end_line"?: number },
  line: number,
): boolean {
  const start = chunk["CodeChunk.start_line"] ?? 0;
  const end = chunk["CodeChunk.end_line"] ?? 0;

  return start > 0 && end >= start && line >= start && line <= end;
}

async function setEdge(
  dgraph: DgraphClientPort,
  uid: string,
  predicate: string,
  targets: string[],
): Promise<void> {
  if (!targets.length) {
    return;
  }
  await withTxn(dgraph, (txn) =>
    txn.mutate({
      setJson: { uid, [predicate]: targets.map((target) => ({ uid: target })) },
      commitNow: true,
    }),
  );
}

async function unresolvedUids(
  dgraph: DgraphClientPort,
  repo: string,
  key: { assemblyRunId: string; nodeId: string },
): Promise<string[]> {
  return withTxn(dgraph, async (txn) => {
    const res = await txn.queryWithVars(UNRESOLVED_QUERY, {
      $repo: repo,
      $run: key.assemblyRunId,
      $node: key.nodeId,
    });

    return ((res.data.f ?? []) as { uid: string }[]).map((row) => row.uid);
  });
}
