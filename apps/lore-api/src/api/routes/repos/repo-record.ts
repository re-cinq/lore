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

/**
 * `GET /api/repos/{owner}/{repo}` — one `lore.repos` row.
 *
 * Serves the read that nine web-ui call sites across five files were each doing
 * for themselves, every one of them selecting a different column subset of the
 * same row (`settings`; `team, settings`; `full_name, team, settings`;
 * `settings, onboarded_at, last_ingested_at, team, onboarding_pr_*`). Returning
 * the whole record and letting the caller pick is what collapses those nine into
 * one endpoint — a per-caller projection would just move the duplication here.
 *
 * The body is the `Repo` model keyed by its COLUMNS. The model is camelCase; the
 * wire keeps the stored spelling because a separately deployed mcp-server reads
 * `full_name` from this route, so flipping it is expand/contract work rather
 * than a rename. Both come from one declaration via `wireSchema`/`toRow`.
 */
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
        // A guard's refusal already carries its status; only an unexpected failure
        // is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
