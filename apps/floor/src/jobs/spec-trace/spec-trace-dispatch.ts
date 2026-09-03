/** Routes a spec-trace trigger onto the ingest assembly line by kind (specs/ingest-station FR6): repo-read kinds (specs/adrs) self-chunk a force pass into per-directory events; payload kinds (test-report/coverage) fetch the body back by reference (FR3). */

import { chunkGlobsForKind } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { EventInput } from "../../main-loop/types.js";
import type { AssemblyRunStartInput } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { graphIngestAuditEntry } from "./spec-trace-audit.js";
import type { AuditLogEntry } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import { ingestSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";

/** Kinds whose data is read from the repo (not carried in the trigger payload). */
const REPO_READ_KINDS = new Set(["specs", "adrs"]);
/** Kinds whose body rides the scheduling event and reaches the pod by reference. */
const PAYLOAD_KINDS = new Set(["test-report", "coverage"]);

/** The tree-listing seam the force self-chunking needs (the only repo read left). */
export interface RepoReader {
  tree(ref?: string): Promise<string[]>;
}

interface RepoReadPayload {
  commit?: string;
  branch?: string;
  glob?: string;
  force?: boolean;
}

export interface SpecTraceDispatchDeps {
  projectFor: (repo: string) => Promise<{ repo: RepoReader }>;
  /** Required for the force-without-glob path, which self-chunks into child events. */
  insertEvent?: (input: EventInput) => Promise<void>;
  /** Starts the ingest-station line — the ONLY execution path (FR6). */
  startLine?: (input: AssemblyRunStartInput) => Promise<string>;
  /** Event id: payload kinds pass body by reference (FR3), never inline. */
  eventId?: string;
}

/** The ingest line's branch, per kind so the specs/adrs/test-report lines of one push do not collide. */
function ingestLineBranch(kind: string, ref: string, chunk?: string): string {
  const base = `ingest/${kind}/${ref}`;

  return chunk ? `${base}/${chunk}` : base;
}

function routedResult(
  repo: string,
  kind: string,
  message: string,
): { logLine: string; audit: AuditLogEntry } {
  return {
    logLine: `[floor] spec-trace ${kind} ${repo}: ${message}`,
    audit: graphIngestAuditEntry(repo, {
      kind,
      projected: 0,
      skipped: 0,
      failed: 0,
      failedFiles: [],
      status: "completed",
      message,
    }),
  };
}

/** Payload kinds (test-report/coverage): the pod fetches the body back by reference (FR3/FR6), never inline. */
async function dispatchPayloadKind(
  repo: string,
  kind: string,
  payload: unknown,
  deps: SpecTraceDispatchDeps,
): Promise<{ logLine: string; audit: AuditLogEntry }> {
  enforceTrue(
    PAYLOAD_KINDS.has(kind),
    Error,
    `unknown spec-trace kind "${kind}"`,
  );
  enforceTrue(
    deps.startLine !== undefined,
    Error,
    `spec-trace ${kind} for ${repo} requires the startLine dep — the inline projector was retired (specs/ingest-station FR6)`,
  );
  enforceTrue(
    typeof deps.eventId === "string" && deps.eventId.length > 0,
    Error,
    `spec-trace payload kind "${kind}" for ${repo} requires the scheduling eventId — the pod fetches the body by reference (FR3)`,
  );
  const p = (payload ?? {}) as RepoReadPayload;
  const ref = p.commit || p.branch || "main";
  // Lease key carries the scheduling event's id — each POSTed chunk is DISTINCT data (specs/ingest-station), so chunks never share a lease.
  const lineId = await deps.startLine!({
    blueprintName: "ingest",
    repo,
    branch: ingestLineBranch(kind, ref, deps.eventId),
    subjectKey: ingestSubject(kind, ref, deps.eventId),
    args: { kind, ref, payload_event_id: deps.eventId },
  });

  return routedResult(
    repo,
    kind,
    `routed to ingest line ${lineId.slice(0, 8)} (payload by reference, event ${deps.eventId})`,
  );
}

/** Repo-read kinds (specs/adrs), normal path: one ingest-station line per payload, clone pinned via args.ref (FR2/FR6). */
async function dispatchRepoReadKind(
  repo: string,
  kind: string,
  p: RepoReadPayload,
  deps: SpecTraceDispatchDeps,
): Promise<{ logLine: string; audit: AuditLogEntry }> {
  enforceTrue(
    deps.startLine !== undefined,
    Error,
    `spec-trace ${kind} for ${repo} requires the startLine dep — the inline projector was retired (specs/ingest-station FR6)`,
  );
  const ref = p.commit || p.branch || "main";
  const lineId = await deps.startLine!({
    blueprintName: "ingest",
    repo,
    // The pod clones at args.ref; the branch only has to be distinct per kind.
    branch: ingestLineBranch(kind, ref, p.glob),
    subjectKey: ingestSubject(kind, ref, p.glob),
    args: {
      kind,
      ref,
      ...(p.glob ? { glob: p.glob } : {}),
      ...(p.force ? { force: "true" } : {}),
    },
  });

  return routedResult(
    repo,
    kind,
    `routed to ingest line ${lineId.slice(0, 8)} at ${ref.slice(0, 12)}`,
  );
}

/** A force pass with no glob re-projects EVERY file — one pod would blow the station deadline, so self-chunk one child event per top-level directory. */
async function dispatchForceChunk(
  repo: string,
  kind: string,
  p: RepoReadPayload,
  deps: SpecTraceDispatchDeps,
): Promise<{ logLine: string; audit: AuditLogEntry }> {
  enforceTrue(
    deps.insertEvent !== undefined,
    Error,
    "self-chunking a force projection requires the insertEvent dep",
  );
  const project = await deps.projectFor(repo);
  const ref = p.commit || p.branch || undefined;
  const globs = chunkGlobsForKind(kind, await project.repo.tree(ref));

  for (const glob of globs) {
    await deps.insertEvent!({
      eventName: "internal.ingest.spec_trace",
      source: "internal",
      dedupeKey: `spec-trace-force:${kind}:${ref ?? "head"}:${glob}`,
      params: {
        kind,
        repo,
        payload: { ...(ref ? { commit: ref } : {}), force: true, glob },
      },
    });
  }
  const message = `force chunked into ${globs.length} per-directory event(s)`;

  return {
    logLine: `[floor] spec-trace ${kind} ${repo}: ${message}`,
    audit: graphIngestAuditEntry(repo, {
      kind,
      projected: 0,
      skipped: 0,
      failed: 0,
      failedFiles: [],
      status: "completed",
      message: `${kind}: ${message}`,
    }),
  };
}

export async function dispatchSpecTrace(
  repo: string,
  kind: string,
  payload: unknown,
  deps: SpecTraceDispatchDeps,
): Promise<{ logLine: string; audit: AuditLogEntry }> {
  if (!REPO_READ_KINDS.has(kind)) {
    return dispatchPayloadKind(repo, kind, payload, deps);
  }

  const p = (payload ?? {}) as RepoReadPayload;

  return p.force && !p.glob
    ? dispatchForceChunk(repo, kind, p, deps)
    : dispatchRepoReadKind(repo, kind, p, deps);
}
