// GET /api/repos/{owner}/{repo}/auto-merge — the auto-merge loop as the Loops tab shows it (specs/protected-branch-merge): every pull request it works or will work, in the shared loop sections.
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import type { Project } from "@re-cinq/lore-shared";
import { mergeCandidate } from "@re-cinq/lore-shared/loops/merge-candidate.js";
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
import { loopPullReads, type LoopPullReads } from "../loops/loop-pull-reads.js";
import {
  capSections,
  recentWindow,
  SectionLimitsQuery,
  type SectionLimits,
} from "../loops/loop-sections.js";
import {
  AutoMergeSchema,
  mergeQueues,
  type StoredBlock,
  RECENT_LIMIT,
} from "./merge-queues.js";

const RepoParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

const BLOCKS_SQL = `SELECT pr_number, reason, detail
       FROM pipeline.pr_blocked_reasons
      WHERE repo = $1 AND closed_at IS NULL`;

const OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    validate: {
      params: zodValidate(RepoParams),
      query: zodValidate(SectionLimitsQuery),
    },
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
  reads: LoopPullReads = loopPullReads(),
): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/auto-merge",
    options: OPTIONS,
    handler: withPool(getPool, (pool, request, h) =>
      answerRepoRead(request, h, (fullName) =>
        cappedQueues({ pool, pageOf, reads }, fullName, request.query),
      ),
    ),
  };
}

/** How many of the loop's newest runs the board reads: enough to cover every open pull request and the week's merges. */
const RUNS_READ = 50;

/** The loop's sections cut to the page's counts, Recently addressed gathered as far as they reach. */
async function cappedQueues(
  sources: Omit<MergeSources, "recentLimit">,
  fullName: string,
  query: unknown,
) {
  const limits = query as SectionLimits;
  const recentLimit = recentWindow(limits, RECENT_LIMIT);

  return capSections(
    await readQueues({ ...sources, recentLimit }, fullName),
    limits,
  );
}

interface MergeSources {
  pool: Pool;
  pageOf: FloorRunPageOf;
  reads: LoopPullReads;
  recentLimit: number;
}

async function readQueues(sources: MergeSources, fullName: string) {
  const project = await onboardedProject(fullName);
  const read = await readBoard(project, sources, fullName);
  const open = read.pulls.filter((pull) => mergeCandidate(pull, fullName));

  return mergeQueues({
    open,
    reviewed: await reviewedPulls(
      { reads: sources.reads, fullName },
      project,
      open,
    ),
    runs: read.page.runs,
    merged: read.merged,
    blocks: read.blocks,
    minAgeHours: autoMergeMinAgeHours(read.settings),
    now: Date.now(),
    recentLimit: sources.recentLimit,
  });
}

async function readBoard(
  project: Project,
  sources: MergeSources,
  fullName: string,
) {
  const [pulls, merged, blocks, page, settings] = await Promise.all([
    sources.reads.openPulls(fullName, project.pulls),
    sources.reads.mergedThisWeek(fullName, project.pulls),
    storedBlocks(sources.pool, fullName),
    sources.pageOf({ repo: fullName, line: AUTO_MERGE_LINE, limit: RUNS_READ }),
    project.settings.rawSettings(),
  ]);

  return { pulls, merged, blocks, page, settings };
}

/** The open pull requests Lore's review stands approved on, read from the check it publishes on each head. */
async function reviewedPulls(
  { reads, fullName }: { reads: LoopPullReads; fullName: string },
  project: Project,
  open: readonly PullRef[],
): Promise<Set<number>> {
  const verdicts = await Promise.all(
    open.map(async (pull) =>
      pull.headSha
        ? loreReviewVerdict(
            await reads.checksOf(fullName, pull.headSha, project.pulls),
          )
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
