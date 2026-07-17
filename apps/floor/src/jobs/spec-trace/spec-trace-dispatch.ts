/**
 * Routes a posted spec-trace trigger (`/api/trigger/spec-trace`) to the right
 * ingest path by kind, returning a normalized log line + audit entry for the
 * caller to surface. Two families:
 *   - repo-read kinds (specs/adrs): read the repo's markdown at the posted ref
 *     and project it via {@link projectRepoGraph}. Docs never flow as pipeline
 *     tasks; this is their only lane.
 *   - payload kinds (test-report/coverage): the data is in the posted payload,
 *     so delegate to the shared {@link ingestSpecTrace}. Tests are CI-only too
 *     (lore-tests.yml POSTs /test-report + /coverage) — no pipeline task.
 */

import {
  ingestSpecTrace,
  chunkGlobsForKind,
  type DgraphClientPort,
} from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { EventInput } from "../../main-loop/types.js";
import type { AssemblyLineStartInput } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import { projectRepoGraph, type RepoReader } from "./graph-ingest-handler.js";
import {
  specTraceAuditEntry,
  specTraceLogLine,
  graphIngestAuditEntry,
  graphIngestLogLine,
} from "./spec-trace-audit.js";
import type { AuditLogEntry } from "@re-cinq/lore-shared/project/audit/audit-port.js";

/** Kinds whose data is read from the repo (not carried in the trigger payload). */
const REPO_READ_KINDS = new Set(["specs", "adrs"]);

interface RepoReadPayload {
  commit?: string;
  branch?: string;
  glob?: string;
  force?: boolean;
}

export interface SpecTraceDispatchDeps {
  dgraph: DgraphClientPort;
  projectFor: (repo: string) => Promise<{ repo: RepoReader }>;
  /** Required for the force-without-glob path, which self-chunks into child events. */
  insertEvent?: (input: EventInput) => Promise<void>;
  /** When present, docs kinds run as an ingest-station line (FR2) instead of
   *  projecting inline; the returned id names the started line. */
  startLine?: (input: AssemblyLineStartInput) => Promise<string>;
}

/**
 * The event-retry gate for the repo-read kinds: their per-file failures are
 * swallowed into the summary (per-file isolation), so the handler must throw
 * for the event loop to re-drive them — the content_hash gate makes a retry
 * re-project only the unfinished files. Payload kinds throw on their own.
 * The message lands in `pipeline.events.error`, file list included.
 */
export function enforceProjectionComplete(
  repo: string,
  kind: string,
  failedFiles: readonly string[],
): void {
  enforceTrue(
    failedFiles.length === 0,
    Error,
    `spec-trace ${kind} for ${repo}: ${failedFiles.length} file(s) failed to project ` +
      `(${failedFiles.join(", ")}) — throwing so the event queue re-drives them`,
  );
}

export async function dispatchSpecTrace(
  repo: string,
  kind: string,
  payload: unknown,
  deps: SpecTraceDispatchDeps,
): Promise<{ logLine: string; audit: AuditLogEntry; failedFiles: string[] }> {
  if (REPO_READ_KINDS.has(kind)) {
    const p = (payload ?? {}) as RepoReadPayload;
    const project = await deps.projectFor(repo);

    // A force pass with no glob re-projects EVERY file with per-statement
    // embeddings — as one event it outlives the bus's 600s visibility timeout
    // and its handler becomes an uncancellable zombie (2026-07-16). Self-chunk
    // instead: one child event per top-level directory, each seconds-long, run
    // one at a time by the spec_trace serial family. Chunks carry a glob, so
    // they can never re-chunk.
    if (p.force && !p.glob) {
      enforceTrue(
        deps.insertEvent !== undefined,
        Error,
        "self-chunking a force projection requires the insertEvent dep",
      );
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
      const logLine = `[floor] spec-trace ${kind} ${repo}: force chunked into ${globs.length} per-directory event(s)`;

      return {
        logLine,
        audit: graphIngestAuditEntry(repo, {
          kind,
          projected: 0,
          skipped: 0,
          failed: 0,
          failedFiles: [],
          status: "completed",
          message: `${kind}: force chunked into ${globs.length} per-directory event(s)`,
        }),
        failedFiles: [],
      };
    }

    // FR2 (specs/ingest-station): with a line starter wired, docs projection
    // runs in an ingest-station pod — one line per payload, the clone pinned to
    // the commit via the line's branch field (full clone + git checkout <ref>).
    // The inline path below remains only for callers without the seam and dies
    // with FR6.
    if (deps.startLine) {
      const ref = p.commit || p.branch || "main";
      const lineId = await deps.startLine({
        definitionName: "ingest",
        repo,
        branch: ref,
        args: {
          kind,
          ...(p.glob ? { glob: p.glob } : {}),
          ...(p.force ? { force: "true" } : {}),
        },
      });
      const message = `${kind}: routed to ingest line ${lineId.slice(0, 8)} at ${ref.slice(0, 12)}`;

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
        failedFiles: [],
      };
    }
    const summary = await projectRepoGraph(
      {
        kind,
        repo,
        ref: p.commit || p.branch || undefined,
        glob: p.glob,
        force: p.force,
      },
      { repo: project.repo, dgraph: deps.dgraph },
    );

    return {
      logLine: graphIngestLogLine(repo, summary),
      audit: graphIngestAuditEntry(repo, summary),
      failedFiles: summary.failedFiles,
    };
  }

  const outcome = await ingestSpecTrace(deps.dgraph, repo, kind, payload);

  return {
    logLine: specTraceLogLine(repo, outcome),
    audit: specTraceAuditEntry(repo, outcome),
    failedFiles: [],
  };
}
