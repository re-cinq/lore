import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { PgAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-pg.js";
import { AgentDefsYaml } from "@re-cinq/lore-shared/project/agents/agent-defs-yaml.js";
import { ResolvedAgentDefinitionSchema } from "@re-cinq/lore-shared/models/agent-definition.js";
import { apiError } from "../../../server/api-error.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

// The org-default catalog (org rows over yaml, no project layer); empty-string repo deliberately degrades PgAgentDefs to org+yaml only.

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
        "Every org-default agent definition — org rows overlaid on the task-types.yaml fallback, no per-repo layer",
    }),
    handler: async (_request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const defs = new PgAgentDefs(pool, new AgentDefsYaml());

      return h.response({ agents: await defs.list("") });
    },
  };
}
