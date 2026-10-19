/** Station-run failures as graph nodes (issue #1771): what failed, which files it named, and the sha that ended it — so `fix-ci` can ask what has failed here before instead of starting cold. */

import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import {
  withTxn,
  upsertByXid,
} from "../../outbound/spec-trace/dgraph-upsert.js";
import { parseFailureSites, namesCode } from "./failure-sites.js";
import type { FailureSite } from "./failure-sites.js";

export {
  failuresTouching,
  type FailureHit,
} from "../../outbound/spec-trace/failure-reads.js";

/** One failed station-run attempt, as the Floor settles it. */
export interface FailureRecord {
  assemblyRunId: string;
  stationRunId: string;
  nodeId: string;
  iteration: number;
  failureClass: string | null;
  failureDetail: string | null;
  commit: string | null;
  /** When the attempt failed. A Date in-process, an ISO STRING once it has crossed the ingest event's JSON — which is how it always arrives in production. */
  occurredAt?: Date | string;
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
    "Failure.occurred_at": instantOf(record.occurredAt).toISOString(),
  };
}

/** The instant a value names, whichever side of the ingest JSON it arrived from. `new Date` both clones a Date and parses an ISO string, so one call covers both. */
function instantOf(value: Date | string | undefined): Date {
  return value === undefined ? new Date() : new Date(value);
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
