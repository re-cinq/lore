// The code-review loop's queues, composed from the repository's open pull requests and the review family's floor runs (specs/auto-review-loop FR-L1). Pure: what the route reads is handed in.
import { z } from "zod";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";
import { isOpenStatus } from "../../../work/floor/floor-run-query.js";
import { loopRowFields, loopSectionsSchema } from "../loops/loop-sections.js";

/** The review family, each line under the word the page uses for it. */
export const REVIEW_LINES: Readonly<Record<string, string>> = {
  "code-review": "review",
  "code-review-recheck": "re-check",
  "code-review-reply": "reply",
};

export const ReviewRowSchema = z.object({
  pr_number: z.number().nullable(),
  pr_url: z.string().nullable(),
  /** The code-review gate skips a draft, so the page says why it is unreviewed. */
  draft: z.boolean(),
  /** review | re-check | reply, null for a pull request no run touched. */
  line: z.string().nullable(),
  /** `state`: the run's status while it is open, its outcome once settled, `unreviewed` for a pull request without a run. */
  ...loopRowFields,
});

/** Code review in the shared loop sections: Current, a review run is on it; Backlog, no review has looked at it (a draft waits here until it is ready); Parked, its newest review did not pass (changes requested, or the run failed); Awaiting merge, its newest review passed; Recently addressed, the newest settled runs, whatever became of their pull requests. */
export const CodeReviewSchema = loopSectionsSchema(ReviewRowSchema);

export type ReviewRow = z.infer<typeof ReviewRowSchema>;
export type CodeReview = z.infer<typeof CodeReviewSchema>;

export interface ReviewPull {
  number: number;
  title: string;
  url: string;
  draft?: boolean;
}

/** Recently addressed rows when the page asks for no count. */
export const RECENT_LIMIT = 10;

export function reviewQueues(
  pulls: readonly ReviewPull[],
  runs: readonly FloorRunRow[],
  recentLimit = RECENT_LIMIT,
): CodeReview {
  const { open, settled } = byStatus(runs);
  const current = onePerPull(open).map((run) => runRow(run, pulls));
  const working = new Set(current.map((row) => row.pr_url));
  const waiting = pulls
    .filter((pull) => !working.has(pull.url))
    .map((pull) => pullRow(pull, settled));

  return {
    current,
    ...waitingBuckets(waiting),
    recent: recentRows(settled, working, pulls).slice(0, recentLimit),
  };
}

/** The runs newest first, split into the ones still working and the settled ones. */
function byStatus(runs: readonly FloorRunRow[]) {
  const newestFirst = [...runs].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  return {
    open: newestFirst.filter((run) => isOpenStatus(run.status)),
    settled: newestFirst.filter((run) => !isOpenStatus(run.status)),
  };
}

/** An open pull request no run is working: unreviewed waits in the backlog, a passed review awaits its merge, anything else is parked on a person. */
function waitingBuckets(waiting: readonly ReviewRow[]) {
  return {
    backlog: waiting.filter((row) => row.run_id === null),
    parked: waiting.filter(
      (row) => row.run_id !== null && row.state !== "success",
    ),
    awaiting_merge: waiting.filter((row) => row.state === "success"),
  };
}

function recentRows(
  settled: readonly FloorRunRow[],
  working: ReadonlySet<string | null>,
  pulls: readonly ReviewPull[],
): ReviewRow[] {
  return onePerPull(settled)
    .filter((run) => !working.has(run.pr_url))
    .map((run) => runRow(run, pulls));
}

/** The newest run per pull request; a run with no pull request keeps its own row. */
function onePerPull(runs: readonly FloorRunRow[]): FloorRunRow[] {
  const seen = new Set<string>();

  return runs.filter((run) => {
    if (run.pr_url === null) {
      return true;
    }
    const first = !seen.has(run.pr_url);

    seen.add(run.pr_url);

    return first;
  });
}

function runRow(run: FloorRunRow, pulls: readonly ReviewPull[]): ReviewRow {
  const pull = pulls.find((p) => p.url === run.pr_url);

  return {
    ...pullIdentity(pull, run),
    line: REVIEW_LINES[run.blueprint_name] ?? run.blueprint_name,
    state: runState(run),
    run_id: run.id,
    pipeline: run.pipeline,
    created_at: run.created_at,
  };
}

/** The run's status while it is open, its outcome once settled. */
function runState(run: FloorRunRow): string {
  if (isOpenStatus(run.status)) {
    return run.status;
  }

  return run.outcome ?? run.status;
}

function pullIdentity(
  pull: ReviewPull | undefined,
  run: FloorRunRow,
): Pick<ReviewRow, "pr_number" | "pr_url" | "title" | "draft"> {
  if (pull) {
    return {
      pr_number: pull.number,
      pr_url: pull.url,
      title: pull.title,
      draft: pull.draft ?? false,
    };
  }

  return {
    pr_number: run.args_pr_number,
    pr_url: run.pr_url,
    title: titleFromRun(run),
    draft: false,
  };
}

function pullRow(pull: ReviewPull, settled: readonly FloorRunRow[]): ReviewRow {
  const newest = settled.find((run) => run.pr_url === pull.url);

  if (newest) {
    return runRow(newest, [pull]);
  }

  return {
    ...pullIdentity(pull, NO_RUN),
    line: null,
    state: pull.draft ? "draft" : "unreviewed",
    run_id: null,
    pipeline: null,
    created_at: null,
  };
}

const NO_RUN = { args_pr_number: null, pr_url: null } as FloorRunRow;

/** A settled run whose pull request is gone from the open list still names it. */
function titleFromRun(run: FloorRunRow): string {
  const number = run.args_pr_number ?? numberInUrl(run.pr_url);

  return number ? `Pull request #${number}` : "Pull request";
}

function numberInUrl(url: string | null): string | undefined {
  return url?.split("/").pop();
}
