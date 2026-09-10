/** Routes a spec-trace trigger onto the ingest assembly line by kind (specs/ingest-station FR6): repo-read kinds (specs/adrs) self-chunk a force pass into per-directory events; payload kinds (test-report/coverage) fetch the body back by reference (FR3). */

import { chunkGlobsForKind, PAYLOAD_INGEST_KINDS } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { EventInput } from "../../domain/event-types.js";
import type { AssemblyRunStartInput } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { graphIngestAuditEntry } from "./spec-trace-audit.js";
import type { AuditLogEntry } from "@re-cinq/lore-shared/project/audit/audit-port.js";
import { ingestSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";

/** Kinds whose data is read from the repo (not carried in the trigger payload). */
const REPO_READ_KINDS = new Set(["specs", "adrs"]);
/** Kinds whose body rides the scheduling event and reaches the pod by reference. */
const PAYLOAD_KINDS = PAYLOAD_INGEST_KINDS;

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

type DispatchResult = { logLine: string; audit: AuditLogEntry };

export async function dispatchSpecTrace(
  repo: string,
  kind: string,
  payload: unknown,
  deps: SpecTraceDispatchDeps,
): Promise<DispatchResult> {
  if (!REPO_READ_KINDS.has(kind)) {
    return dispatchPayloadKind(repo, kind, payload, deps);
  }

  const p = (payload ?? {}) as RepoReadPayload;

  return p.force && !p.glob
    ? dispatchForceChunk(repo, kind, p, deps)
    : dispatchRepoReadKind(repo, kind, p, deps);
}

/** Payload kinds (test-report/coverage): the pod fetches the body back by reference (FR3/FR6), never inline. */
async function dispatchPayloadKind(
  repo: string,
  kind: string,
  payload: unknown,
  deps: SpecTraceDispatchDeps,
): Promise<DispatchResult> {
  enforcePayloadDispatchable(repo, kind, deps);

  const p = (payload ?? {}) as RepoReadPayload;
  const ref = p.commit || p.branch || "main";
  const lineId = await startPayloadLine(repo, kind, ref, deps);

  return routedResult(
    repo,
    kind,
    `routed to ingest line ${lineId.slice(0, 8)} (payload by reference, event ${deps.eventId})`,
  );
}

/** What a payload dispatch cannot proceed without: a known kind, somewhere to run it, and — since the pod fetches the body BY REFERENCE (FR3) — the scheduling event id to fetch it with. */
function enforcePayloadDispatchable(
  repo: string,
  kind: string,
  deps: SpecTraceDispatchDeps,
): void {
  enforceTrue(
    PAYLOAD_KINDS.has(kind),
    Error,
    `unknown spec-trace kind "${kind}"`,
  );
  enforceStartLine(repo, kind, deps);
  enforceTrue(
    typeof deps.eventId === "string" && deps.eventId.length > 0,
    Error,
    `spec-trace payload kind "${kind}" for ${repo} requires the scheduling eventId — the pod fetches the body by reference (FR3)`,
  );
}

/** The inline projector was retired (specs/ingest-station FR6), so a dispatch with no `startLine` has nothing to run on. */
function enforceStartLine(
  repo: string,
  kind: string,
  deps: SpecTraceDispatchDeps,
): void {
  enforceTrue(
    deps.startLine !== undefined,
    Error,
    `spec-trace ${kind} for ${repo} requires the startLine dep — the inline projector was retired (specs/ingest-station FR6)`,
  );
}

/** Starts the ingest line for a payload kind. Lease key carries the scheduling event's id — each POSTed chunk is DISTINCT data (specs/ingest-station), so chunks never share a lease. */
async function startPayloadLine(
  repo: string,
  kind: string,
  ref: string,
  deps: SpecTraceDispatchDeps,
): Promise<string> {
  const { eventId } = deps;

  return deps.startLine!({
    blueprintName: "ingest",
    repo,
    branch: ingestLineBranch(kind, ref, eventId),
    subjectKey: ingestSubject(kind, ref, eventId),
    args: { kind, ref, payload_event_id: eventId },
  });
}

/** The ingest line's branch, per kind so the specs/adrs/test-report lines of one push do not collide. */
function ingestLineBranch(kind: string, ref: string, chunk?: string): string {
  const base = `ingest/${kind}/${ref}`;

  return chunk ? `${base}/${chunk}` : base;
}

/** The log line and the audit entry a routed dispatch produces. The audit message defaults to the log message; a caller passes `auditMessage` only when the audit trail wants the kind spelled out again. */
function routedResult(
  repo: string,
  kind: string,
  message: string,
  auditMessage: string = message,
): DispatchResult {
  return {
    logLine: `[floor] spec-trace ${kind} ${repo}: ${message}`,
    audit: graphIngestAuditEntry(repo, {
      kind,
      projected: 0,
      skipped: 0,
      failed: 0,
      failedFiles: [],
      status: "completed",
      message: auditMessage,
    }),
  };
}

/** A force pass with no glob re-projects EVERY file — one pod would blow the station deadline, so self-chunk one child event per top-level directory. */
async function dispatchForceChunk(
  repo: string,
  kind: string,
  p: RepoReadPayload,
  deps: SpecTraceDispatchDeps,
): Promise<DispatchResult> {
  enforceTrue(
    deps.insertEvent !== undefined,
    Error,
    "self-chunking a force projection requires the insertEvent dep",
  );
  const ref = p.commit || p.branch || undefined;
  const globs = await emitChunkEvents(repo, kind, ref, deps);
  const message = `force chunked into ${globs} per-directory event(s)`;

  return routedResult(repo, kind, message, `${kind}: ${message}`);
}

/** Splits a forced reprojection into one event per directory and emits them. Returns how many were emitted. */
async function emitChunkEvents(
  repo: string,
  kind: string,
  ref: string | undefined,
  deps: SpecTraceDispatchDeps,
): Promise<number> {
  const project = await deps.projectFor(repo);
  const globs = chunkGlobsForKind(kind, await project.repo.tree(ref));

  for (const glob of globs) {
    await deps.insertEvent!(chunkEventInput(repo, kind, ref, glob));
  }

  return globs.length;
}

/** One child event for one directory. The dedupe key carries the ref and the glob, so a re-forced commit collapses onto the same events instead of projecting the repo twice. */
function chunkEventInput(
  repo: string,
  kind: string,
  ref: string | undefined,
  glob: string,
): EventInput {
  return {
    eventName: "internal.ingest.spec_trace",
    source: "internal",
    dedupeKey: `spec-trace-force:${kind}:${ref ?? "head"}:${glob}`,
    params: {
      kind,
      repo,
      payload: { ...(ref ? { commit: ref } : {}), force: true, glob },
    },
  };
}

/** Repo-read kinds (specs/adrs), normal path: one ingest-station line per payload, clone pinned via args.ref (FR2/FR6). */
async function dispatchRepoReadKind(
  repo: string,
  kind: string,
  p: RepoReadPayload,
  deps: SpecTraceDispatchDeps,
): Promise<DispatchResult> {
  enforceStartLine(repo, kind, deps);

  const ref = p.commit || p.branch || "main";
  const lineId = await deps.startLine!(repoReadLineInput(repo, kind, ref, p));

  return routedResult(
    repo,
    kind,
    `routed to ingest line ${lineId.slice(0, 8)} at ${ref.slice(0, 12)}`,
  );
}

/** The ingest-line start for a repo-read kind. The pod clones at args.ref; the branch only has to be distinct per kind. */
function repoReadLineInput(
  repo: string,
  kind: string,
  ref: string,
  p: RepoReadPayload,
): AssemblyRunStartInput {
  return {
    blueprintName: "ingest",
    repo,
    branch: ingestLineBranch(kind, ref, p.glob),
    subjectKey: ingestSubject(kind, ref, p.glob),
    args: {
      kind,
      ref,
      ...(p.glob ? { glob: p.glob } : {}),
      ...(p.force ? { force: "true" } : {}),
    },
  };
}
