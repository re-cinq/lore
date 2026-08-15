/**
 * GET /api/assembly-line-definitions/{name} (FR3.2) — the zod-parsed definition
 * graph the web-ui needs to lay out a run's DAG but cannot import, since the
 * YAML lives in libs/ and the definitions are read from disk.
 *
 * Returns the WHOLE parsed definition rather than a nodes/edges subset:
 * apps/web-ui/src/lib/assembly-line-definition.ts (the hand mirror behind the
 * drift guard) requires `description` and `version` too, so a subset would
 * arrive at its consumer already broken.
 *
 * No cache here: `loadBuiltinAssemblyLines` memoizes its own promise (the one
 * cache), so a second wrap would only hide it going stale.
 */

import Boom from "@hapi/boom";
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
        Boom.notFound,
        `no assembly line definition "${request.params.name}"`,
      );

      return h.response(definition).code(200);
    },
  };
}
