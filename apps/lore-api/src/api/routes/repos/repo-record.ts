import { errorMessage } from "@re-cinq/lore-shared";
import { RepoSchema } from "@re-cinq/lore-shared/models/repo.js";
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
 * The body IS the `Repo` model, declared once in `libs/shared/src/models/repo.ts`
 * and published from here into `openapi.json`, so web-ui reads a generated type
 * rather than a hand-kept mirror of this shape.
 */
export function repoRecordRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}",
    options: zodResponse(bearerScope("read"), RepoSchema, {
      name: "Repo",
      description: "One lore.repos row",
      errors: [404],
    }),
    handler: async (request, h) => {
      const repo = `${request.params.owner}/${request.params.repo}`;

      try {
        const project = await projectFor(repo);
        const record = await project.settings.record();

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
