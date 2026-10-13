// Which attempt of the selected node the center column shows (run-viz FR4.1f): the viewer's pick while it names a row the node still has, else the newest iteration — so a new attempt arriving live takes over unless someone chose an older one.

import type { AssemblyRunNode } from "./assembly-run-rows";

/** What the center column shows for the chosen attempt: its transcript, or the pod's logs. */
export type InspectorKind = "transcript" | "pods";

export interface AttemptPick {
  nodeId: string;
  iteration: number;
}

export function effectiveAttempt(
  pick: AttemptPick | null,
  nodeId: string,
  rows: readonly AssemblyRunNode[],
): AssemblyRunNode | null {
  const nodeRows = rows.filter((row) => row.nodeId === nodeId);
  const picked =
    pick?.nodeId === nodeId
      ? nodeRows.find((row) => row.iteration === pick.iteration)
      : undefined;

  return picked ?? newestAttempt(nodeRows);
}

function newestAttempt(
  rows: readonly AssemblyRunNode[],
): AssemblyRunNode | null {
  return rows.reduce<AssemblyRunNode | null>(
    (newest, row) =>
      newest !== null && newest.iteration >= row.iteration ? newest : row,
    null,
  );
}
