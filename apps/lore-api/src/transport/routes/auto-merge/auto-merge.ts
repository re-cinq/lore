// GET /api/repos/{owner}/{repo}/auto-merge — the auto-merge loop as the Loops tab shows it (specs/protected-branch-merge): every pull request it works or will work, in the shared loop sections.
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import type { Project } from "@re-cinq/lore-shared";
import { autoMergeMinAgeHours } from "@re-cinq/lore-shared/loops/loop-enabled.js";
import { loreReviewVerdict } from "@re-cinq/lore-shared/project/pulls/check-runs.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";
import { AUTO_MERGE_LINE } from "../repos/auto-merge-gate.js";
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

const BLOCKS_SQL = `SELECT pr_number, reason, detail
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
      "The auto-merge loop: every open pull request code review passed, by the loop's run on it and what blocks it, and the ones it worked that merged this week",
    errors: [400, 404],
  },
);

export function autoMergeRoute(
  getPool: () => Pool | null,
  pageOf: FloorRunPageOf,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/auto-merge",
    options: OPTIONS,
    handler: withPool(getPool, (pool, request, h) =>
      answerRepoRead(request, h, (fullName) =>
        readQueues({ pool, pageOf }, fullName),
      ),
    ),
  };
}

/** How many of the loop's newest runs the board reads: enough to cover every open pull request and the week's merges. */
const RUNS_READ = 50;

async function readQueues(
  sources: { pool: Pool; pageOf: FloorRunPageOf },
  fullName: string,
) {
  const project = await onboardedProject(fullName);
  const since = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString();
  const [pulls, merged, blocks, page, settings] = await Promise.all([
    project.pulls.list(),
    project.pulls.listMergedSince(since),
    storedBlocks(sources.pool, fullName),
    sources.pageOf({ repo: fullName, line: AUTO_MERGE_LINE, limit: RUNS_READ }),
    project.settings.rawSettings(),
  ]);
  const open = pulls.filter((pull) => loopCandidate(pull, fullName));

  return mergeQueues({
    open,
    reviewed: await reviewedPulls(project, open),
    runs: page.runs,
    merged,
    blocks,
    minAgeHours: autoMergeMinAgeHours(settings),
    now: Date.now(),
  });
}

/** What the loop may take: open, ready for review, on a branch of this repository. */
function loopCandidate(pull: PullRef, repo: string): boolean {
  const ownBranch =
    pull.headRepo === undefined ||
    pull.headRepo.toLowerCase() === repo.toLowerCase();

  return pull.state === "open" && pull.draft !== true && ownBranch;
}

/** The open pull requests Lore's review stands approved on, read from the check it publishes on each head. */
async function reviewedPulls(
  project: Project,
  open: readonly PullRef[],
): Promise<Set<number>> {
  const verdicts = await Promise.all(
    open.map(async (pull) =>
      pull.headSha
        ? loreReviewVerdict(await project.pulls.listChecks(pull.headSha))
        : "none",
    ),
  );

  return new Set(
    open
      .filter((_, i) => verdicts[i] === "approved")
      .map((pull) => pull.number),
  );
}

async function storedBlocks(pool: Pool, repo: string): Promise<StoredBlock[]> {
  const { rows } = await pool.query<{
    pr_number: string | number;
    reason: string;
    detail: string | null;
  }>(BLOCKS_SQL, [repo]);

  return rows.map((row) => ({
    prNumber: Number(row.pr_number),
    reason: row.reason,
    detail: row.detail,
  }));
}
