// POST a finished week's introduction again (specs/repo-changelog FR6): the Changelog tab's button for a week the Monday run left without one starts that week's weekly-changelog run, whose store overwrites the week.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { isoWeekBounds } from "@re-cinq/lore-shared/changelog/changelog-week.js";
import {
  startChangelogWeek,
  type ChangelogLineStarter,
} from "@re-cinq/lore-shared/changelog/floor-changelog-week.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { WeekKey } from "./changelog-schema.js";

/** The floor's lines, or null on a deployment that was given no floor. */
export type ChangelogLines = () => ChangelogLineStarter | null;

const WeekParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  week: WeekKey,
});

const IntroStarted = z.object({ runId: z.string() });

const INTRO_OPTIONS = zodResponse(
  {
    ...bearerScope("task"),
    validate: { params: zodValidate(WeekParams) },
  },
  IntroStarted,
  {
    name: "ChangelogIntroStarted",
    status: 202,
    description:
      "Starts the finished week's weekly-changelog run again, or joins the open one, so its introduction is written and the week stored anew",
    errors: [400],
  },
);

export function changelogIntroRoute(
  lines: ChangelogLines = () => floorIfConfigured()?.lines ?? null,
  now: () => Date = () => new Date(),
): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/changelog/{week}/intro",
    options: INTRO_OPTIONS,
    handler: (request, h) => serveIntro(lines, now, request, h),
  };
}

async function serveIntro(
  lines: ChangelogLines,
  now: () => Date,
  request: Request,
  h: ResponseToolkit,
) {
  const { owner, repo, week } = request.params as z.infer<typeof WeekParams>;
  const floor = lines();

  enforceTrue(
    Date.parse(isoWeekBounds(week).to) <= now().getTime(),
    apiError(400),
    "the week has not ended yet",
  );
  enforceTrue(floor, apiError(503), "no_floor");

  const started = await startChangelogWeek(floor, {
    repo: `${owner}/${repo}`,
    week,
  });

  return h.response({ runId: started.run.id }).code(202);
}
