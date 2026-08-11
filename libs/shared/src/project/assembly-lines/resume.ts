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
  AssemblyLineNodeRecord,
  AssemblyLineRecord,
  AssemblyLineStartInput,
} from "./assembly-lines-port.js";

/**
 * A fork the rules refused — as opposed to an infrastructure failure inside the
 * adapter. HTTP callers map this to a 4xx carrying the message and let anything
 * else surface as a sanitized 500, so a dropped DB connection is never reported
 * to an operator as "your fork was refused" (nor its raw message leaked).
 */
export class ResumeRefusedError extends Error {}

/** Index (in visit order) of the latest COMPLETED row for `nodeId`, or -1 when
 *  the line never finished that node. */
export function resumeCutoffIndex(
  nodes: AssemblyLineNodeRecord[],
  nodeId: string,
): number {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].nodeId === nodeId && nodes[i].outcome !== null) {
      return i;
    }
  }

  return -1;
}

/** The validated fork: the source row (proven present and terminal) and the node
 *  rows the fork inherits. */
export interface ResumePrefix {
  source: AssemblyLineRecord;
  prefix: AssemblyLineNodeRecord[];
}

/**
 * Validate a `resumeFrom` start against its source line and return the node rows
 * the fork inherits — the source's visit history through the chosen node's latest
 * completed row, inclusive, so earlier iterations of that node ride along.
 *
 * Throws before the caller writes anything.
 */
export function resolveResumePrefix(
  input: AssemblyLineStartInput,
  source: AssemblyLineRecord | null,
  nodes: AssemblyLineNodeRecord[],
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
    input.definitionHash,
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
    source.definitionName === input.definitionName,
    ResumeRefusedError,
    `resume-from source line "${source.id}" ran definition "${source.definitionName}", not "${input.definitionName}"`,
  );
  enforceTrue(
    source.status === "finished" || source.status === "failed",
    ResumeRefusedError,
    `resume-from source line "${source.id}" is still ${source.status} — only a finished or failed line can be forked`,
  );
  enforceTrue(
    source.definitionHash,
    ResumeRefusedError,
    `resume-from source line "${source.id}" predates definition hashing — backfill pipeline.assembly_lines.definition_hash before forking it`,
  );
  enforceTrue(
    source.definitionHash === input.definitionHash,
    ResumeRefusedError,
    `resume-from source line "${source.id}": definition "${source.definitionName}" has changed since that run (${short(source.definitionHash)} ≠ ${short(input.definitionHash)})`,
  );

  const cutoff = resumeCutoffIndex(nodes, resumeFrom.nodeId);

  enforceTrue(
    cutoff >= 0,
    ResumeRefusedError,
    `resume-from source line "${source.id}" has no completed "${resumeFrom.nodeId}" node to fork from`,
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
