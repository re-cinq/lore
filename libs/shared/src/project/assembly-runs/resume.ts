// The pure rules of a `resumeFrom` start (specs/fork-rerun-from-node FR1–FR4).
//
// Both adapters route through this so the InMemory double stays the behavioural
// spec of the Pg one: same rejections, same messages, same inherited prefix. It
// is deliberately IO-free — the adapter reads the source line and its node rows,
// this decides whether the fork is legal and how much of the history it carries,
// and only then does the adapter write. Every property checked here is immutable
// on a terminal line, so validating before the write opens no race.

import { enforceTrue } from "../../lib/enforce.js";
import type {
  StationRunRecord,
  AssemblyRunRecord,
  AssemblyRunStartInput,
} from "./assembly-runs-port.js";

/** Index (in visit order) of the latest COMPLETED row for `nodeId` — or, with
 *  `iteration`, of exactly that completed visit. -1 when no such row exists.
 *  Naming the iteration is what makes a loop retry exact: the latest row of a
 *  node that ran again after the retry target would keep more history than the
 *  target's own prefix. */
export function resumeCutoffIndex(
  nodes: StationRunRecord[],
  nodeId: string,
  iteration?: number,
): number {
  const isCompletedVisit = (row: StationRunRecord): boolean =>
    row.nodeId === nodeId && row.outcome !== null;
  const matchesIteration = (row: StationRunRecord): boolean =>
    iteration === undefined || row.iteration === iteration;

  for (let i = nodes.length - 1; i >= 0; i--) {
    if (isCompletedVisit(nodes[i]) && matchesIteration(nodes[i])) {
      return i;
    }
  }

  return -1;
}

/** The validated fork: the source row (proven present and terminal) and the node
 *  rows the fork inherits. */
export interface ResumePrefix {
  source: AssemblyRunRecord;
  prefix: StationRunRecord[];
}

/**
 * Validate a `resumeFrom` start against its source line and return the node rows
 * the fork inherits — the source's visit history through the chosen node's latest
 * completed row, inclusive, so earlier iterations of that node ride along.
 *
 * Throws before the caller writes anything.
 */
export function resolveResumePrefix(
  input: AssemblyRunStartInput,
  source: AssemblyRunRecord | null,
  nodes: StationRunRecord[],
): ResumePrefix {
  const resumeFrom = input.resumeFrom;

  enforceTrue(
    resumeFrom,
    Error,
    "resolveResumePrefix called without resumeFrom",
  );
  enforceTrue(
    input.branch === undefined,
    Error,
    "resume-from start inherits branch from the source line — do not pass it",
  );
  enforceTrue(
    input.taskId === undefined,
    Error,
    "resume-from start inherits taskId from the source line — do not pass it",
  );
  enforceTrue(
    input.blueprintHash,
    Error,
    "resume-from start requires definitionHash — the current definition's content hash",
  );
  enforceTrue(
    source,
    Error,
    `resume-from source line "${resumeFrom.lineId}" not found`,
  );
  enforceTrue(
    source.repo === input.repo,
    Error,
    `resume-from source line "${source.id}" belongs to repo "${source.repo}", not "${input.repo}"`,
  );
  enforceTrue(
    source.blueprintName === input.blueprintName,
    Error,
    `resume-from source line "${source.id}" ran definition "${source.blueprintName}", not "${input.blueprintName}"`,
  );
  enforceTrue(
    source.status === "finished" || source.status === "failed",
    Error,
    `resume-from source line "${source.id}" is still ${source.status} — only a finished or failed line can be forked`,
  );
  enforceTrue(
    source.blueprintHash,
    Error,
    `resume-from source line "${source.id}" predates definition hashing — backfill pipeline.assembly_runs.blueprint_hash before forking it`,
  );
  enforceTrue(
    source.blueprintHash === input.blueprintHash,
    Error,
    `resume-from source line "${source.id}": definition "${source.blueprintName}" has changed since that run (${short(source.blueprintHash)} ≠ ${short(input.blueprintHash)})`,
  );

  const cutoff = resumeCutoffIndex(
    nodes,
    resumeFrom.nodeId,
    resumeFrom.iteration,
  );

  enforceTrue(
    cutoff >= 0,
    Error,
    resumeFrom.iteration === undefined
      ? `resume-from source line "${source.id}" has no completed "${resumeFrom.nodeId}" node to fork from`
      : `resume-from source line "${source.id}" has no completed "${resumeFrom.nodeId}" iteration ${resumeFrom.iteration} to fork from`,
  );

  const prefix = nodes.slice(0, cutoff + 1);
  const unfinished = prefix.find((n) => n.outcome === null);

  enforceTrue(
    !unfinished,
    Error,
    `resume-from source line "${source.id}" has an unfinished "${unfinished?.nodeId}" node inside the prefix — its history is not replayable`,
  );

  return { source, prefix };
}

function short(hash: string): string {
  return hash.slice(0, 12);
}
