// Pure rules of a resumeFrom start (specs/fork-rerun-from-node FR1-FR4); both adapters route through this, IO-free, so the InMemory double stays the behavioural spec of the Pg one (same rejections, messages, inherited prefix).

import { enforceTrue } from "../../lib/enforce.js";
import type {
  StationRunRecord,
  AssemblyRunRecord,
  AssemblyRunStartInput,
} from "./assembly-runs-port.js";

/** A fork the validation refused (drift, non-terminal source, missing visit); its own type so the API edge can 409 it rather than matching on message prose (which would make a DB outage read as a refusal). */
export class ResumeRefusedError extends Error {
  // Explicit name, or a stack trace reads "Error: resume-from …" and the refusal is indistinguishable from breakage in a log line.
  override name = "ResumeRefusedError";
}

/** Index of the latest completed row for nodeId (or, with iteration, of exactly that visit); -1 if none. Naming iteration makes a loop retry exact — else a node that re-ran after the retry target would keep too much history. */
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

/** The validated fork: the source row (proven present and terminal) and the node rows the fork inherits. */
export interface ResumePrefix {
  source: AssemblyRunRecord;
  prefix: StationRunRecord[];
}

/** Validates a resumeFrom start against its source line and returns the inherited node rows (history through the chosen node's latest completed row, inclusive); throws before the caller writes anything. */
export function resolveResumePrefix(
  input: AssemblyRunStartInput,
  source: AssemblyRunRecord | null,
  nodes: StationRunRecord[],
): ResumePrefix {
  const resumeFrom = input.resumeFrom;

  enforceTrue(
    resumeFrom,
    ResumeRefusedError,
    "resolveResumePrefix called without resumeFrom",
  );
  enforceTrue(
    input.branch === undefined,
    ResumeRefusedError,
    "resume-from start inherits branch from the source line — do not pass it",
  );
  enforceTrue(
    input.taskId === undefined,
    ResumeRefusedError,
    "resume-from start inherits taskId from the source line — do not pass it",
  );
  enforceTrue(
    input.blueprintHash,
    ResumeRefusedError,
    "resume-from start requires definitionHash — the current definition's content hash",
  );
  enforceTrue(
    source,
    ResumeRefusedError,
    `resume-from source line "${resumeFrom.lineId}" not found`,
  );
  enforceTrue(
    source.repo === input.repo,
    ResumeRefusedError,
    `resume-from source line "${source.id}" belongs to repo "${source.repo}", not "${input.repo}"`,
  );
  enforceTrue(
    source.blueprintName === input.blueprintName,
    ResumeRefusedError,
    `resume-from source line "${source.id}" ran definition "${source.blueprintName}", not "${input.blueprintName}"`,
  );
  enforceTrue(
    source.status === "finished" || source.status === "failed",
    ResumeRefusedError,
    `resume-from source line "${source.id}" is still ${source.status} — only a finished or failed line can be forked`,
  );
  enforceTrue(
    source.blueprintHash,
    ResumeRefusedError,
    `resume-from source line "${source.id}" predates definition hashing — backfill pipeline.assembly_runs.blueprint_hash before forking it`,
  );
  enforceTrue(
    source.blueprintHash === input.blueprintHash,
    ResumeRefusedError,
    `resume-from source line "${source.id}": definition "${source.blueprintName}" has changed since that run (${short(source.blueprintHash)} ≠ ${short(input.blueprintHash)})`,
  );

  const cutoff = resumeCutoffIndex(
    nodes,
    resumeFrom.nodeId,
    resumeFrom.iteration,
  );

  enforceTrue(
    cutoff >= 0,
    ResumeRefusedError,
    resumeFrom.iteration === undefined
      ? `resume-from source line "${source.id}" has no completed "${resumeFrom.nodeId}" node to fork from`
      : `resume-from source line "${source.id}" has no completed "${resumeFrom.nodeId}" iteration ${resumeFrom.iteration} to fork from`,
  );

  const prefix = nodes.slice(0, cutoff + 1);
  const unfinished = prefix.find((n) => n.outcome === null);

  enforceTrue(
    !unfinished,
    ResumeRefusedError,
    `resume-from source line "${source.id}" has an unfinished "${unfinished?.nodeId}" node inside the prefix — its history is not replayable`,
  );

  return { source, prefix };
}

function short(hash: string): string {
  return hash.slice(0, 12);
}
