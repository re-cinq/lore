// Which nodes a person may run again from the run page (run-viz FR4.14). The floor refuses only the exit and fail nodes, so the page has to say the rest: a person's station is answered by a person, not run, and a marker has nothing to run.
import type { AssemblyLineDefinition } from "./assembly-line-definition";
import { isFloorEngine } from "./assembly-run-rows";
import { nodeTypeOf } from "./human-station";
import { typeFamilyOf } from "./node-type-family";

const RUNNABLE: ReadonlySet<string> = new Set(["agent", "service"]);

export function canRunByHand(
  nodeId: string,
  definition: AssemblyLineDefinition | null,
  engine: string | undefined,
): boolean {
  return (
    isFloorEngine(engine) &&
    !endsRun(nodeId, definition) &&
    RUNNABLE.has(typeFamilyOf(nodeTypeOf(definition, nodeId)))
  );
}

function endsRun(
  nodeId: string,
  definition: AssemblyLineDefinition | null,
): boolean {
  return nodeId === definition?.exit || nodeId === definition?.fail;
}
