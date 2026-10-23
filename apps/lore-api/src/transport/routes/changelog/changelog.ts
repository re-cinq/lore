// A repository's changelog (specs/repo-changelog FR6): its weeks newest first, the finished ones from lore.changelog_weeks with their introductions, the current week and any week nothing stored yet read live from GitHub.
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { z } from "zod";
import { changelogPage } from "@re-cinq/lore-shared/changelog/changelog-page.js";
import { PgChangelogWeeks } from "@re-cinq/lore-shared/project/changelog-weeks/changelog-weeks-pg.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import {
  ChangelogPageSchema,
  ChangelogQuerySchema,
} from "./changelog-schema.js";

export function changelogRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/changelog",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(ChangelogQuerySchema) },
      },
      ChangelogPageSchema,
      {
        name: "ChangelogPage",
        description:
          "A page of the repository's weeks, newest first: what merged and closed in each, with the introduction written once the week ended.",
        errors: [400],
      },
    ),
    handler: withPool(getPool, serveChangelog),
  };
}

async function serveChangelog(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const repo = `${request.params.owner}/${request.params.repo}`;
  const query = request.query as z.infer<typeof ChangelogQuerySchema>;
  const weeks = new PgChangelogWeeks(pool);

  return h.response(
    await changelogPage(query, {
      now: () => new Date(),
      stored: (page) => weeks.page(repo, page),
      closedWork: (since) => closedWorkSince(repo, since),
    }),
  );
}

async function closedWorkSince(repo: string, since: string) {
  const project = await projectFor(repo);
  const [merged, closed] = await Promise.all([
    project.pulls.listMergedSince(since),
    project.issues.list({ state: "closed", since }),
  ]);

  return { merged, closed };
}
