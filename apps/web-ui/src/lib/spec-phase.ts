// Which half of a feature's line is working, as a pure read of the run payload.
//
// Deliberately its OWN module: the wizard is a client component, and importing this
// from feature-run.ts pulled that module's `db` → `pg` chain into the browser bundle
// ("Can't resolve 'fs'"). A type-only import is erased; a value import is not.

import type { AssemblyLineRunNode } from "./assembly-line-runs";

/** The nodes that run AFTER the author accepts. Planning rounds are `analyze`; these
 *  are the spec work the accept starts on the same line (FR6.26). */
const SPEC_NODES = new Set(["analyse-specs", "write", "push"]);

export interface SpecPhase {
  running: boolean;
  /** When the working node started — what an elapsed timer must count from. */
  since?: string;
}

/**
 * Whether the spec work is in flight, read from the LINE rather than from whether
 * the author recently pressed a button.
 *
 * A local flag could only be cleared by the feature leaving the planning phase, so a
 * line that finished without producing a PR left "Writing the spec…" on screen
 * indefinitely — timed, worse, from the last ROUND's creation, which read as 80+
 * minutes of a 15 minute budget while nothing was running at all.
 */
export function specPhaseOf(
  run: { status: string; nodes: AssemblyLineRunNode[] } | null | undefined,
): SpecPhase {
  if (!run || run.status !== "running") {
    return { running: false };
  }
  const open = run.nodes.filter((node) => node.outcome === null);
  const working = open[open.length - 1];

  return working && SPEC_NODES.has(working.nodeId)
    ? { running: true, since: working.startedAt }
    : { running: false };
}
