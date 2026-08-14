import { errorMessage } from "@re-cinq/lore-shared";
import type { ServerRoute } from "@hapi/hapi";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

/**
 * `GET /api/repos/{owner}/{repo}` — one `lore.repos` row.
 *
 * Serves the read that nine web-ui call sites across five files were each doing
 * for themselves, every one of them selecting a different column subset of the
 * same row (`settings`; `team, settings`; `full_name, team, settings`;
 * `settings, onboarded_at, last_ingested_at, team, onboarding_pr_*`). Returning
 * the whole record and letting the caller pick is what collapses those nine into
 * one endpoint — a per-caller projection would just move the duplication here.
 */
export function repoRecordRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}",
    options: bearerScope("read"),
    handler: async (request, h) => {
      const repo = `${request.params.owner}/${request.params.repo}`;

      try {
        const project = await projectFor(repo);
        const record = await project.settings.record(repo);

        if (!record) {
          return h.response({ error: "Repo not found" }).code(404);
        }

        return h.response(record);
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
