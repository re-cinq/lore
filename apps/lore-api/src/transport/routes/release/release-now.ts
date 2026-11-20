// POST a release now (specs/scheduled-releases): the Release now button starts the release line for the repository's current head whether or not a schedule is set. Whether anything merged is the line's `collect` to say, not this route's.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  startRelease,
  type ReleaseLineStarter,
} from "@re-cinq/lore-shared/release/floor-release.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { PgSettings } from "@re-cinq/lore-shared/project/settings/settings-pg.js";
import type { SettingsPort } from "@re-cinq/lore-shared/project/settings/settings-port.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/** The floor's lines, or null on a deployment that was given no floor. */
export type ReleaseLines = () => ReleaseLineStarter | null;

export interface ReleaseSeams {
  settings: () => Pick<SettingsPort, "record" | "mirrorOwner"> | null;
  lines: ReleaseLines;
  headSha: (repo: string) => Promise<string>;
}

const ReleaseParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

type ReleaseParams = z.infer<typeof ReleaseParamsSchema>;

const ReleaseStarted = z.object({ runId: z.string(), joined: z.boolean() });

const RELEASE_OPTIONS = zodResponse(
  {
    ...bearerScope("admin"),
    validate: { params: zodValidate(ReleaseParamsSchema) },
  },
  ReleaseStarted,
  {
    name: "ReleaseStarted",
    status: 202,
    description:
      "Starts the release line for the repository's current head, or joins the open run for that commit; a head with nothing new ends the run without a release",
    errors: [404, 409],
  },
);

export function releaseNowSeams(getPool: () => Pool | null): ReleaseSeams {
  const github = new PlatformGitHub(process.env);

  return {
    settings: () => {
      const pool = getPool();

      return pool ? new PgSettings(pool) : null;
    },
    lines: () => floorIfConfigured()?.lines ?? null,
    headSha: async (repo) =>
      github.branchHeadSha(repo, await github.getDefaultBranch(repo)),
  };
}

export function releaseNowRoute(
  getPool: () => Pool | null,
  seams: ReleaseSeams = releaseNowSeams(getPool),
): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/release",
    options: RELEASE_OPTIONS,
    handler: (request, h) => serveRelease(seams, request, h),
  };
}

async function serveRelease(
  seams: ReleaseSeams,
  request: Request,
  h: ResponseToolkit,
) {
  const lines = seams.lines();
  const repo = await releasableRepo(seams, request.params as ReleaseParams);

  enforceTrue(lines, apiError(503), "no_floor");

  const { run, joined } = await startRelease(lines, {
    repo,
    sha: await seams.headSha(repo),
  });

  return h.response({ runId: run.id, joined }).code(202);
}

/** The repo's canonical name, refused when it is unknown or is another repo's public mirror. */
async function releasableRepo(
  seams: ReleaseSeams,
  { owner, repo }: ReleaseParams,
): Promise<string> {
  const settings = seams.settings();

  enforceTrue(settings, apiError(503), DB_UNAVAILABLE);
  const record = await settings.record(`${owner}/${repo}`);

  enforceTrue(record, apiError(404), "unknown repo");
  const mirrorOf = await settings.mirrorOwner(record.fullName);

  enforceTrue(
    mirrorOf === null,
    apiError(409),
    `${record.fullName} is the public mirror of ${mirrorOf}`,
  );

  return record.fullName;
}
