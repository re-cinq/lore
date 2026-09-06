/** GET /api/assembly-line-definitions/{name} (FR3.2) — returns the WHOLE parsed definition (web-ui's drift-guard mirror needs `description`/`version` too); no cache here since `loadBuiltinAssemblyLines` already memoizes. */

import { apiError } from "../api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";
import type { ServerRoute } from "@hapi/hapi";
import type { AssemblyLine } from "@re-cinq/lore-assembly-lines";

export function assemblyLineDefinitionsRoute(
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-line-definitions/{name}",
    options: { auth: "ingest-token" },
    handler: async (request, h) => {
      const definitions = await load();
      const definition = definitions.get(request.params.name);

      enforceTrue(
        definition,
        apiError(404),
        `no assembly line definition "${request.params.name}"`,
      );

      return h.response(definition).code(200);
    },
  };
}
