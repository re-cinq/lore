import type { AssemblyLineDefinition } from "./assembly-line-definition";
import { humanStation } from "./human-station";

/** Node timeout budget; read from DEFINITION per node (timeout_minutes + 2m grace); keep in step with floor assembly-line-reaper. */
const DEFAULT_TIMEOUT_MINUTES = 60;
const TIMEOUT_BUFFER_MINUTES = 2;

/** Node's budget in minutes, or null for wait nodes, unresolved definitions, or undeclared nodes. */
export function nodeBudgetMinutes(
  definition: AssemblyLineDefinition | null | undefined,
  nodeId: string | undefined,
): number | null {
  if (!definition || !nodeId) {
    return null;
  }
  const node = definition.nodes.find((n) => n.id === nodeId);

  // A human station has no budget: nobody kills a person for taking a week.
  if (!node || humanStation(node.type)) {
    return null;
  }

  return (
    (node.timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES) + TIMEOUT_BUFFER_MINUTES
  );
}
