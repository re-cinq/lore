// One loop's read for the Loops tab: a GET on the repository that answers the shared sections, each cut to the page's row counts. Every loop route but the implementation loop's is built here, so the validation, the limits and the GitHub failure mapping are written once.
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { answerRepoRead } from "../repos/github-read.js";
import {
  capSections,
  LIMITED_SECTIONS,
  SectionLimitsQuery,
  type SectionLimits,
} from "./loop-sections.js";

export const RepoParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

type Sections = Record<(typeof LIMITED_SECTIONS)[number], readonly unknown[]>;

export interface LoopReadRoute<Read extends Sections> {
  /** The route's last path segment, `code-review` for `/api/repos/{owner}/{repo}/code-review`. */
  segment: string;
  schema: z.ZodType;
  name: string;
  description: string;
  /** The loop's sections for one repository, whole. */
  read(fullName: string): Promise<Read>;
}

/** The loop's GET route: its sections read for the repository and cut to `?backlog=&parked=&awaiting_merge=&recent=`. */
export function loopReadRoute<Read extends Sections>(
  route: LoopReadRoute<Read>,
): ServerRoute {
  return {
    method: "GET",
    path: `/api/repos/{owner}/{repo}/${route.segment}`,
    options: loopReadOptions(route),
    handler: (request, h) =>
      answerRepoRead(request, h, async (fullName) =>
        capSections(await route.read(fullName), request.query as SectionLimits),
      ),
  };
}

function loopReadOptions({
  schema,
  name,
  description,
}: Pick<LoopReadRoute<Sections>, "schema" | "name" | "description">) {
  return zodResponse(
    {
      ...bearerScope("read"),
      validate: {
        params: zodValidate(RepoParams),
        query: zodValidate(SectionLimitsQuery),
      },
    },
    schema,
    { name, description, errors: [400, 404] },
  );
}
