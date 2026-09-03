import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { toRow } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import { RepoSchema, REPO_COLUMNS } from "@re-cinq/lore-shared/models/repo.js";
import type { ServerRoute } from "@hapi/hapi";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";

// Collapses 9 web-ui call sites that each selected a different column subset of this row into one whole-record endpoint; wire stays snake_case (not camelCase) because mcp-server reads `full_name` from it — renaming is expand/contract work.
export function repoRecordRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}",
    options: zodResponse(
      bearerScope("read"),
      wireSchema(RepoSchema, REPO_COLUMNS),
      {
        name: "Repo",
        description: "One lore.repos row",
        errors: [404],
      },
    ),
    handler: async (request, h) => {
      const repo = `${request.params.owner}/${request.params.repo}`;

      try {
        const project = await projectFor(repo);
        const record = await project.settings.record();

        enforceTrue(record, apiError(404), "Repo not found");

        return h.response(toRow(REPO_COLUMNS, record));
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
