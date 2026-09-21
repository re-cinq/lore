import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { PgAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-pg.js";
import { ResolvedAgentDefinitionSchema } from "@re-cinq/lore-shared/models/agent-definition.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

// The org-default catalog (no project layer): an empty-string repo matches no override, so PgAgentDefs resolves org rows only.

const OrgAgentsResponse = z.object({
  agents: z.array(ResolvedAgentDefinitionSchema),
});

export function orgAgentDefinitionsRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-definitions",
    options: zodResponse(bearerScope("read"), OrgAgentsResponse, {
      name: "OrgAgentDefinitions",
      description:
        "Every org-default agent definition — the org rows, no per-repo layer",
    }),
    handler: async (_request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const defs = new PgAgentDefs(pool);

      return h.response({ agents: await defs.list("") });
    },
  };
}
