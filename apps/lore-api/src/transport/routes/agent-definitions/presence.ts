import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

// Which clusters hold each agent definition's latest version: the floor's answer, read from what each cluster's kube holds. Lore keeps no copy.

const ClusterPresenceSchema = z.object({
  id: z.string(),
  hash: z.string().nullable(),
  current: z.boolean(),
});

const AgentPresenceSchema = z.object({
  state: z.enum(["all", "some", "none"]),
  latest: z.string(),
  clusters: z.array(ClusterPresenceSchema),
});

const AgentPresenceResponse = z.object({
  presence: z.record(z.string(), AgentPresenceSchema),
});

export interface FloorPresence {
  presence(): Promise<Record<string, z.infer<typeof AgentPresenceSchema>>>;
}

/** The floor's agent definitions, or null on a deployment that was given no floor. */
const floorPresence = (): FloorPresence | null =>
  floorIfConfigured()?.agentDefinitions ?? null;

export function agentPresenceRoute(
  floor: () => FloorPresence | null = floorPresence,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-definitions/presence",
    options: zodResponse(bearerScope("read"), AgentPresenceResponse, {
      name: "AgentDefinitionPresence",
      description:
        "Per agent definition: all, some or none of the clusters hold its latest version, as the floor reads it from each cluster",
    }),
    handler: async (_request, h) => {
      const definitions = floor();

      return h.response({ presence: definitions ? await definitions.presence() : {} });
    },
  };
}
