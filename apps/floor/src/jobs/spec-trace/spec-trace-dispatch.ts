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

import { ingestSpecTrace, type DgraphClientPort } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
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
