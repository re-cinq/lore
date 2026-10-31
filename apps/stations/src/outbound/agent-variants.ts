// A renamed repository's agent overrides are floor variants keyed by its name, so they follow it to the new one (#4037).
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { FloorAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.js";

export async function renameAgentVariants(
  from: string,
  to: string,
): Promise<string> {
  const floor = floorIfConfigured();

  if (!floor) {
    return "no floor, so no agent variants to move";
  }
  const moved = await new FloorAgentDefs(floor.agentDefinitions).renameRepo(
    from,
    to,
  );

  return `agent variants moved: ${moved.join(", ") || "none"}`;
}
