// Pure validation for the `resumeFrom` start variant: both adapters fetch the
// source line + its node rows, then this module decides whether the fork is
// legal and where the copied prefix ends. Data manipulation, not
// execution-engine work — the ordinary walk replays the copied rows.

import { enforceTrue } from "../../lib/enforce.js";
import type {
  AssemblyLineNodeRecord,
  AssemblyLineRecord,
  AssemblyLineStartInput,
} from "./assembly-lines-port.js";

/**
 * Throws unless `input.resumeFrom` may fork `source`; returns the narrowed
 * source plus the node row the copy runs through (the chosen node's latest
 * completed row, so every earlier visit — including prior iterations of the
 * node itself — rides along).
 */
export function enforceResumable(
  input: AssemblyLineStartInput,
  source: AssemblyLineRecord | null,
  sourceNodes: AssemblyLineNodeRecord[],
): { source: AssemblyLineRecord; boundary: AssemblyLineNodeRecord } {
  const resumeFrom = input.resumeFrom;

  enforceTrue(resumeFrom, Error, "enforceResumable called without resumeFrom");
  enforceTrue(
    input.branch === undefined,
    Error,
    "resumeFrom: branch is inherited from the source line and must not be passed",
  );
  enforceTrue(
    input.taskId === undefined,
    Error,
    "resumeFrom: taskId is inherited from the source line and must not be passed",
  );
  enforceTrue(
    input.definitionHash !== undefined,
    Error,
    "resumeFrom: definitionHash of the loaded definition is required",
  );
  enforceTrue(
    source,
    Error,
    `resumeFrom: source line "${resumeFrom.lineId}" not found`,
  );
  enforceTrue(
    source.definitionName === input.definitionName,
    Error,
    `resumeFrom: source line runs "${source.definitionName}", not "${input.definitionName}"`,
  );
  enforceTrue(
    source.status === "finished" || source.status === "failed",
    Error,
    `resumeFrom: source line "${source.id}" is ${source.status} — only a terminal line can be forked`,
  );
  enforceTrue(
    source.definitionHash !== null,
    Error,
    `resumeFrom: source line "${source.id}" has no stored definition hash — backfill definition_hash before forking`,
  );
  enforceTrue(
    source.definitionHash === input.definitionHash,
    Error,
    `resumeFrom: the definition changed since line "${source.id}" ran (stored hash ${source.definitionHash}, current ${input.definitionHash})`,
  );
  const boundary = sourceNodes
    .filter((n) => n.nodeId === resumeFrom.nodeId && n.outcome !== null)
    .at(-1);

  enforceTrue(
    boundary,
    Error,
    `resumeFrom: node "${resumeFrom.nodeId}" has no completed row on line "${source.id}"`,
  );

  return { source, boundary };
}
