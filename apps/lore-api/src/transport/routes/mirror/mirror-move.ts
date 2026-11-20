// POST the move of a public mirror's stored knowledge to its private repository (specs/public-mirror): the repository in the path is the private one, and the mirror is read from its settings, never from the request.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import {
  PgSettings,
  type RepoConfigWriter,
} from "@re-cinq/lore-shared/project/settings/settings-pg.js";
import type { SettingsPort } from "@re-cinq/lore-shared/project/settings/settings-port.js";
import {
  moveMirror,
  type MirrorMoveFloor,
  type MirrorMoveSettings,
} from "../../../work/mirror/move-mirror.js";
import { MirrorMoveResultSchema } from "../../../work/mirror/mirror-move-result.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { repoLevel } from "../../http/repo-guard.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

export type { MirrorMoveFloor };

export interface MirrorMoveSeams {
  settings: () =>
    (MirrorMoveSettings & Pick<SettingsPort, "record" | "rawSettings">) | null;
  floor: () => MirrorMoveFloor | null;
}

const MirrorMoveParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

const MirrorMoveBody = z.object({
  confirm: z.string().optional(),
  dry_run: z.boolean().optional(),
});

const MIRROR_MOVE_OPTIONS = zodResponse(
  {
    ...bearerScope("admin"),
    ...repoLevel("admin"),
    validate: {
      params: zodValidate(MirrorMoveParams),
      payload: zodValidate(MirrorMoveBody),
    },
  },
  MirrorMoveResultSchema,
  {
    name: "MirrorMoveResult",
    description:
      "What moving the public mirror's stored knowledge to this repository did, per table; a dry run reports the same counts and changes nothing, and a real run needs `confirm` to be the mirror's full name",
    errors: [400, 404, 409],
  },
);

/** The production seams; the settings carry the GitHub writer that sets the mirror's Actions variable. */
export function mirrorMoveSeams(
  getPool: () => Pool | null,
  repoConfig: () => RepoConfigWriter = () => new PlatformGitHub(process.env),
): MirrorMoveSeams {
  return {
    settings: () => {
      const pool = getPool();

      return pool ? new PgSettings(pool, repoConfig()) : null;
    },
    floor: () => floorIfConfigured(),
  };
}

export function mirrorMoveRoute(
  getPool: () => Pool | null,
  seams: MirrorMoveSeams = mirrorMoveSeams(getPool),
): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/mirror/move",
    options: MIRROR_MOVE_OPTIONS,
    handler: (request, h) => serveMirrorMove(seams, request, h),
  };
}

async function serveMirrorMove(
  seams: MirrorMoveSeams,
  request: Request,
  h: ResponseToolkit,
) {
  const settings = seams.settings();

  enforceTrue(settings, apiError(503), DB_UNAVAILABLE);
  const pair = await linkedPair(settings, privateRepoOf(request));
  const body = request.payload as z.infer<typeof MirrorMoveBody>;
  const move = { ...pair, dryRun: dryRunOf(body, pair.mirror) };

  return h.response(await moveMirror({ settings, floor: seams.floor() }, move));
}

function privateRepoOf(request: Request): string {
  const { owner, repo } = request.params as z.infer<typeof MirrorMoveParams>;

  return `${owner}/${repo}`;
}

/** Whether the request is a dry run; a real run must confirm the mirror's full name. */
function dryRunOf(
  body: z.infer<typeof MirrorMoveBody>,
  mirror: string,
): boolean {
  const dryRun = body.dry_run ?? false;

  enforceTrue(
    dryRun || body.confirm === mirror,
    apiError(400),
    `confirm must be the mirror's full name, ${mirror}`,
  );

  return dryRun;
}

/** The private repository under its stored name and the mirror its settings name, refused when the repository is unknown or names none. */
async function linkedPair(
  settings: NonNullable<ReturnType<MirrorMoveSeams["settings"]>>,
  named: string,
): Promise<{ privateRepo: string; mirror: string }> {
  const record = await settings.record(named);

  enforceTrue(record, apiError(404), "unknown repo");
  const privateRepo = record.fullName;
  const mirror = (await settings.rawSettings(privateRepo))?.public_mirror;

  enforceTrue(typeof mirror === "string", apiError(409), "no public mirror");

  return { privateRepo, mirror };
}
