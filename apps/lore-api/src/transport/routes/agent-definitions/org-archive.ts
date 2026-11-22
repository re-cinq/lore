import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { NO_FLOOR_DETAIL } from "@re-cinq/lore-shared/project/agents/agent-defs-no-floor.js";
import { shippedFloorAgents } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { OkTrue } from "../../http/ok-schema.js";
import { withPool } from "../with-pool.js";
import { floorDefinitions, type FloorDefinitions } from "./org-list.js";
import { audit, enforceNotPackManaged } from "./org-update.js";

const OrgAgentArchivedSchema = z.object({
  ok: OkTrue,
  archived: z.string(),
});

/** Archives an org agent on the floor. A shipped agent is refused: the next boot would seed it again, and a pipeline may name it. */
export function orgAgentDefinitionArchiveRoute(
  getPool: () => Pool | null,
  definitions: FloorDefinitions = floorDefinitions,
): ServerRoute {
  return {
    method: "DELETE",
    path: "/api/agent-definitions/{name}",
    options: zodResponse(bearerScope("admin"), OrgAgentArchivedSchema, {
      name: "OrgAgentDefinitionArchived",
      description: "The org agent archived on the floor",
      errors: [404, 409],
    }),
    handler: withPool(getPool, (pool, request, h) =>
      archiveOrgAgent(pool, definitions, request, h),
    ),
  };
}

async function archiveOrgAgent(
  pool: Pool,
  definitions: FloorDefinitions,
  request: Request,
  h: ResponseToolkit,
) {
  const name = request.params.name as string;
  const floor = definitions();

  enforceTrue(floor, apiError(503, { detail: NO_FLOOR_DETAIL }), "no_floor");
  enforceTrue(!shippedFloorAgents().has(name), apiError(409), "shipped");
  await enforceNotPackManaged(pool, name);
  enforceTrue(await floor.get(name), apiError(404), "not_found");

  await floor.archive(name);
  await audit(pool, "agent_org_archived", { name });

  return h.response({ ok: true, archived: name });
}
