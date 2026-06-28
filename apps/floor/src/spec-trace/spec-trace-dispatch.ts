/**
 * Routes a posted spec-trace trigger (`/api/trigger/spec-trace`) to the right
 * ingest path by kind, returning a normalized log line + audit entry for the
 * caller to surface. Two families:
 *   - repo-read kinds (specs/adrs): read the repo's markdown at the posted ref
 *     and project it via {@link projectRepoGraph} — the same core the task path
 *     runs. Docs no longer flow as pipeline tasks; this is their only lane.
 *   - payload kinds (test-report/coverage): the data is in the posted payload,
 *     so delegate to the shared {@link ingestSpecTrace}.
 */

import { ingestSpecTrace, type DgraphClientPort } from "@re-cinq/lore-shared";
import { projectRepoGraph, type RepoReader } from "./graph-ingest-handler.js";
import {
  specTraceAuditEntry,
  specTraceLogLine,
  graphIngestAuditEntry,
  graphIngestLogLine,
} from "./spec-trace-audit.js";
import type { AuditLogEntry } from "../kernel/repositories/index.js";

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

export async function dispatchSpecTrace(
  repo: string,
  kind: string,
  payload: unknown,
  deps: SpecTraceDispatchDeps,
): Promise<{ logLine: string; audit: AuditLogEntry }> {
  if (REPO_READ_KINDS.has(kind)) {
    const p = (payload ?? {}) as RepoReadPayload;
    const project = await deps.projectFor(repo);
    const summary = await projectRepoGraph(
      { kind, repo, ref: p.commit || p.branch || undefined, glob: p.glob, force: p.force },
      { repo: project.repo, dgraph: deps.dgraph },
    );
    return { logLine: graphIngestLogLine(repo, summary), audit: graphIngestAuditEntry(repo, summary) };
  }

  const outcome = await ingestSpecTrace(deps.dgraph, repo, kind, payload);
  return { logLine: specTraceLogLine(repo, outcome), audit: specTraceAuditEntry(repo, outcome) };
}
