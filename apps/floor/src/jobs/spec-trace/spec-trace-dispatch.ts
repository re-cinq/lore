/**
 * Routes a spec-trace trigger onto the ingest assembly line by kind (FR6,
 * specs/ingest-station: the Floor is pure orchestration — every dgraph write
 * happens in an ingest-station pod). Two families:
 *   - repo-read kinds (specs/adrs): the pod projects its own clone; the repo is
 *     only read HERE to self-chunk a force-without-glob pass into per-directory
 *     child events (each seconds-long, so no pod outlives its deadline).
 *   - payload kinds (test-report/coverage): the body stays on the scheduling
 *     event; the pod fetches it back by reference (FR3).
 */

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
  /** The scheduling event's id — payload kinds hand their body off by
   *  reference through it (FR3), never inline through station_input. */
  eventId?: string;
}

/** The ingest line's branch — the ref the pod clones at, per kind so the
 *  specs/adrs/test-report lines of one push do not collide. */
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

export async function dispatchSpecTrace(
  repo: string,
  kind: string,
  payload: unknown,
  deps: SpecTraceDispatchDeps,
): Promise<{ logLine: string; audit: AuditLogEntry }> {
  if (!REPO_READ_KINDS.has(kind)) {
    enforceTrue(
      PAYLOAD_KINDS.has(kind),
      Error,
      `unknown spec-trace kind "${kind}"`,
    );

    // FR3/FR6: payload kinds ride the ingest line too — the station fetches the
    // body back by reference (a test report is ~1 MB; station_input is an argv
    // element), so the scheduling event's id is mandatory.
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
    // The lease key carries the scheduling event's id: each POSTed chunk of one
    // commit's report is DISTINCT data (specs/ingest-station: one pod per event
    // payload), so chunks must never take each other's lease — only a re-drive
    // of the same event dedupes.
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

  const p = (payload ?? {}) as RepoReadPayload;

  if (!(p.force && !p.glob)) {
    // FR2/FR6: docs projection runs ONLY in an ingest-station pod — one line
    // per payload, the clone pinned to the commit via args.ref.
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

  // A force pass with no glob re-projects EVERY file with per-statement
  // embeddings — as one pod it would blow the station deadline. Self-chunk
  // instead: one child event per top-level directory, each seconds-long.
  // Chunks carry a glob, so they can never re-chunk.
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
