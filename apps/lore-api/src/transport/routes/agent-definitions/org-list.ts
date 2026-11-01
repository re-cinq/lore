import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { FloorAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.js";
import { NO_FLOOR_DETAIL } from "@re-cinq/lore-shared/project/agents/agent-defs-no-floor.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { ResolvedAgentDefinitionSchema } from "@re-cinq/lore-shared/models/agent-definition.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

// The org-default catalog (no project layer): listed for no repo, so no variant applies.

const OrgAgentsResponse = z.object({
  agents: z.array(ResolvedAgentDefinitionSchema),
});

type FloorDefinitionApi = ConstructorParameters<typeof FloorAgentDefs>[0];

export type FloorDefinitions = () => FloorDefinitionApi | null;

/** The floor's agent definitions, or null on a deployment that was given no floor. */
export const floorDefinitions: FloorDefinitions = () =>
  floorIfConfigured()?.agentDefinitions ?? null;

export function orgAgentDefinitionsRoute(
  definitions: FloorDefinitions = floorDefinitions,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-definitions",
    options: zodResponse(bearerScope("read"), OrgAgentsResponse, {
      name: "OrgAgentDefinitions",
      description:
        "Every org-default agent definition — the floor's settings, no per-repo variant",
    }),
    // The floor is the only store of agent definitions (#3995): with no floor there is nothing to list.
    handler: async (_request, h) => {
      const floor = definitions();

      enforceTrue(
        floor,
        apiError(503, { detail: NO_FLOOR_DETAIL }),
        "no_floor",
      );

      return h.response({ agents: await new FloorAgentDefs(floor).list("") });
    },
  };
}
