/** Mirrors `isHumanStation` in @re-cinq/lore-assembly-lines; web-ui cannot import
 *  it, and the drift guard on DefinitionNodeType keeps the set honest. */
const HUMAN_STATION_TYPES: ReadonlySet<string> = new Set([
  "feature_review",
  "pr_review",
]);

import type { AssemblyLineDefinition } from "./assembly-line-definition";

/**
 * How long a node may run before the Floor kills it.
 *
 * The planning card used to count against the feature-planning AGENT DEFINITION's
 * `timeout_minutes` — a number that has nothing to do with when anything is killed,
 * and one number for a line whose nodes have separate budgets. What actually ends a
 * run is the assembly-line reaper: an open node older than its own declared
 * `timeout_minutes` (else 60) plus a 2-minute grace is failed `<kind>-timeout` and
 * the walk advances. So the bar has to be read from the DEFINITION, per node.
 *
 * Keep these two constants in step with `apps/floor/src/jobs/assembly-line/
 * assembly-line-reaper.ts` — a countdown that disagrees with the reaper is worse
 * than no countdown, because it will read "8 minutes left" on a node already dead.
 */
const DEFAULT_TIMEOUT_MINUTES = 60;
const TIMEOUT_BUFFER_MINUTES = 2;

/** The node's budget in minutes, or null when there is none to show — a `wait` node
 *  (parked on a person, deliberately unbounded), an unresolved definition, or a node
 *  the definition does not declare. */
export function nodeBudgetMinutes(
  definition: AssemblyLineDefinition | null | undefined,
  nodeId: string | undefined,
): number | null {
  if (!definition || !nodeId) {
    return null;
  }
  const node = definition.nodes.find((n) => n.id === nodeId);

  if (!node || HUMAN_STATION_TYPES.has(node.type)) {
    return null;
  }

  return (
    (node.timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES) + TIMEOUT_BUFFER_MINUTES
  );
}
