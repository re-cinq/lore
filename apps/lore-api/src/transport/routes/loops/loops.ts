// The repository's loops (specs/implementation-loop FR9, specs/issue-triage FR33, specs/protected-branch-merge): GET lists every loop with its switch state for the Loops tab's pill row, PUT flips one, DELETE …/pause resumes a paused one.
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { LOOP_KINDS } from "@re-cinq/lore-shared/loops/loop-kinds.js";
import { loopSwitchedOn } from "@re-cinq/lore-shared/loops/loop-enabled.js";
import { PgSettings } from "@re-cinq/lore-shared/project/settings/settings-pg.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import { enforceRepoRow, switchLoop } from "./loop-switch.js";
import { codeReviewRoute } from "../code-review/code-review.js";
import { autoMergeRoute } from "../auto-merge/auto-merge.js";
import { specUpkeepRoute } from "../spec-upkeep/spec-upkeep.js";
import { dailyDigestRoute } from "../daily-digest/daily-digest.js";
import { specTicketsRoute } from "../spec-tickets/spec-tickets.js";
import { floorRunPagesWithoutCost } from "../floor/floor-runs.js";
import { loopPullReads } from "./loop-pull-reads.js";
import {
  LoopKeySchema,
  LoopResumeResultSchema,
  LoopSwitchBodySchema,
  LoopSwitchResultSchema,
  RepoLoopsSchema,
  type RepoLoop,
} from "./loops-schema.js";

const PATH = "/api/repos/{owner}/{repo}/loops";

const SwitchParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  key: LoopKeySchema,
});

const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;

/** The Loops tab's routes: the loops and their switches, and the pages of the loops that have no other home. */
export function loopsRoutes(getPool: () => Pool | null): ServerRoute[] {
  const pullReads = loopPullReads();

  return [
    readLoopsRoute(getPool),
    switchLoopRoute(getPool),
    resumeLoopRoute(getPool),
    codeReviewRoute(floorRunPagesWithoutCost, pullReads),
    autoMergeRoute(getPool, floorRunPagesWithoutCost, pullReads),
    specUpkeepRoute(floorRunPagesWithoutCost, pullReads),
    dailyDigestRoute(getPool),
    specTicketsRoute(floorRunPagesWithoutCost),
  ];
}

function readLoopsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: PATH,
    options: zodResponse(bearerScope("read"), RepoLoopsSchema, {
      name: "RepoLoops",
      description:
        "Every loop the repository can switch, in display order, with its name and whether it is on.",
      errors: [404],
    }),
    handler: withPool(getPool, serveReadLoops),
  };
}

const SWITCH_OPTIONS = zodResponse(
  {
    ...bearerScope("admin"),
    validate: {
      params: zodValidate(SwitchParams),
      payload: zodValidate(LoopSwitchBodySchema),
    },
  },
  LoopSwitchResultSchema,
  {
    name: "LoopSwitch",
    description:
      "Switch one of the repository's loops on or off. The auto-merge loop's minimum age is a repository setting (PUT /api/repos/{owner}/{repo}/settings, auto_merge.min_age_hours).",
    errors: [400, 404],
  },
);

function switchLoopRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "PUT",
    path: `${PATH}/{key}`,
    options: SWITCH_OPTIONS,
    handler: withPool(getPool, serveSwitchLoop),
  };
}

const RESUME_OPTIONS = zodResponse(
  {
    ...bearerScope("admin"),
    validate: { params: zodValidate(SwitchParams) },
  },
  LoopResumeResultSchema,
  {
    name: "LoopResume",
    description:
      "Resume one of the repository's loops: forget its pause and leave its switch as it is.",
    errors: [400, 404],
  },
);

function resumeLoopRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "DELETE",
    path: `${PATH}/{key}/pause`,
    options: RESUME_OPTIONS,
    handler: withPool(getPool, serveResumeLoop),
  };
}

async function serveResumeLoop(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { key } = request.params as z.infer<typeof SwitchParams>;
  const repo = repoOf(request.params);

  await enforceRepoRow(pool, repo);
  await new PgSettings(pool).resumeLoop(repo, key);

  return h.response({ ok: true as const, key }).code(200);
}

async function serveReadLoops(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const repo = repoOf(request.params);
  const { rows } = await pool.query<{ settings: unknown }>(
    "SELECT settings FROM lore.repos WHERE full_name = $1",
    [repo],
  );

  enforceTrue(rows.length > 0, apiError(404), `repo not found: ${repo}`);

  return h.response({ loops: repoLoops(rows[0].settings) });
}

/** Every loop with its switch read from the repository's raw settings. */
export function repoLoops(settings: unknown): RepoLoop[] {
  return LOOP_KINDS.map((kind) => ({
    ...kind,
    enabled: loopSwitchedOn(kind.key, settings),
  }));
}

async function serveSwitchLoop(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { key } = request.params as z.infer<typeof SwitchParams>;
  const { enabled } = request.payload as z.infer<typeof LoopSwitchBodySchema>;
  const repo = repoOf(request.params);

  await enforceRepoRow(pool, repo);
  await switchLoop(pool, repo, { key, enabled });

  return h.response({ ok: true as const, key, enabled }).code(200);
}
