// A repository's changelog (specs/repo-changelog FR6, FR7): its weeks newest first, the finished ones from lore.changelog_weeks with their introductions, the current week and any week nothing stored yet read live from GitHub; once it has releases, its releases newest first with what is unreleased.
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { changelogPage } from "@re-cinq/lore-shared/changelog/changelog-page.js";
import {
  hasReleases,
  releasesPage,
} from "@re-cinq/lore-shared/changelog/releases-page.js";
import { PgChangelogReleases } from "@re-cinq/lore-shared/project/changelog-releases/changelog-releases-pg.js";
import { PgSettings } from "@re-cinq/lore-shared/project/settings/settings-pg.js";
import { PgChangelogWeeks } from "@re-cinq/lore-shared/project/changelog-weeks/changelog-weeks-pg.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { repoLevel } from "../../http/repo-guard.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import {
  ChangelogPageSchema,
  ChangelogQuerySchema,
  ReleaseCursor,
  WeekKey,
} from "./changelog-schema.js";

const CHANGELOG_OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    ...repoLevel("read"),
    validate: { query: zodValidate(ChangelogQuerySchema) },
  },
  ChangelogPageSchema,
  {
    name: "ChangelogPage",
    description:
      "A page of the repository's weeks, newest first: what merged and closed in each, with the introduction written once the week ended. A repository with releases answers mode releases instead: its releases newest first and, on the first page, what is unreleased.",
    errors: [400],
  },
);

export function changelogRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/changelog",
    options: CHANGELOG_OPTIONS,
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
  const releases = new PgChangelogReleases(pool);
  const [settings, latest] = await Promise.all([
    new PgSettings(pool).rawSettings(repo),
    releases.latest(repo),
  ]);

  return h.response(
    hasReleases(settings, latest)
      ? await releasePage(repo, query, releases)
      : await weekPage(repo, query, new PgChangelogWeeks(pool)),
  );
}

function releasePage(
  repo: string,
  query: z.infer<typeof ChangelogQuerySchema>,
  releases: PgChangelogReleases,
) {
  enforceTrue(
    query.before === undefined || ReleaseCursor.safeParse(query.before).success,
    apiError(400),
    "before is the end of a release, not a week",
  );

  return releasesPage(query, {
    now: () => new Date(),
    stored: (page) => releases.page(repo, page),
    closedWork: (since) => closedWorkSince(repo, since),
  });
}

function weekPage(
  repo: string,
  query: z.infer<typeof ChangelogQuerySchema>,
  weeks: PgChangelogWeeks,
) {
  enforceTrue(
    query.before === undefined || WeekKey.safeParse(query.before).success,
    apiError(400),
    "before is a week",
  );

  return changelogPage(query, {
    now: () => new Date(),
    stored: (page) => weeks.page(repo, page),
    closedWork: (since) => closedWorkSince(repo, since),
  });
}

async function closedWorkSince(repo: string, since: string) {
  const project = await projectFor(repo);
  const [merged, closed] = await Promise.all([
    project.pulls.listMergedSince(since),
    project.issues.list({ state: "closed", since }),
  ]);

  return { merged, closed };
}
