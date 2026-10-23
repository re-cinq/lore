// GET /api/repos/{owner}/{repo}/auto-merge — the auto-merge loop as the Loops tab shows it (specs/protected-branch-merge): Lore's own pull requests in the shared loop sections.
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import { answerRepoRead, onboardedProject } from "../repos/github-read.js";
import {
  AutoMergeSchema,
  mergeQueues,
  type StoredBlock,
} from "./merge-queues.js";

const RepoParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

/** How far back Recently addressed looks for Lore's merged pull requests. */
const RECENT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const BLOCKS_SQL = `SELECT pr_number, reason, detail, since
       FROM pipeline.pr_blocked_reasons
      WHERE repo = $1 AND closed_at IS NULL`;

const OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    validate: { params: zodValidate(RepoParams) },
  },
  AutoMergeSchema,
  {
    name: "AutoMerge",
    description:
      "The auto-merge loop: Lore's own pull requests by whether auto-merge is armed and what blocks them, and the ones merged this week",
    errors: [400, 404],
  },
);

export function autoMergeRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/auto-merge",
    options: OPTIONS,
    handler: withPool(getPool, serveAutoMerge),
  };
}

async function serveAutoMerge(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  return answerRepoRead(request, h, (fullName) => readQueues(pool, fullName));
}

async function readQueues(pool: Pool, fullName: string) {
  const { pulls } = await onboardedProject(fullName);
  const since = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString();
  const [open, merged, blocks, appLogin] = await Promise.all([
    pulls.list(),
    pulls.listMergedSince(since),
    storedBlocks(pool, fullName),
    loreAppLogin(),
  ]);

  return mergeQueues({
    open: open.filter((pull) => pull.state === "open"),
    merged,
    blocks,
    appLogin,
  });
}

async function storedBlocks(pool: Pool, repo: string): Promise<StoredBlock[]> {
  const { rows } = await pool.query<{
    pr_number: string | number;
    reason: string;
    detail: string | null;
    since: Date | null;
  }>(BLOCKS_SQL, [repo]);

  return rows.map((row) => ({
    prNumber: Number(row.pr_number),
    reason: row.reason,
    detail: row.detail,
    since: row.since ? new Date(row.since).toISOString() : null,
  }));
}
