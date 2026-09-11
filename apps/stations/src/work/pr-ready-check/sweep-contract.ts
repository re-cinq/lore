import type {
  CheckRun,
  JobFailure,
  PullCommit,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type {
  ParkedNode,
  ParkedTarget,
} from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";

/** The slice of one open implementation-loop run the sweep reads. */
export interface LoopRunSlice {
  id: string;
  repo: string;
  status: string;
  args: Record<string, unknown>;
  graph: RunGraph | null;
}

/** What the sweep will tell a parked node, or null while there is nothing worth waking it for. Both parks report through this one shape, so the tally and the reporter need not know which kind resolved. */
export interface ParkedReport {
  outcome: "success" | "changes_requested" | "failed";
  args: Record<string, unknown>;
}

export interface PrReadyCheckDeps {
  listOpenLoopRuns(): Promise<LoopRunSlice[]>;
  listStationRuns(runId: string): Promise<ParkedNode[]>;
  /** The PR's commits, oldest first as GitHub lists them — the judged sha is derived from them, not from the head (FR15). */
  listPrCommits(repo: string, number: number): Promise<PullCommit[]>;
  /** Every check run for a ref. Read raw, because a red verdict has to NAME what failed. */
  listChecks(repo: string, ref: string): Promise<CheckRun[]>;
  /** How a failed Actions job failed, from the job itself: its check run reports nothing. Null when GitHub will not say. */
  failedJob(repo: string, jobId: number): Promise<JobFailure | null>;
  /** GitHub's mergeability for the PR: false when it conflicts (and so gets no workflow run at all), null while GitHub computes it. */
  prMergeable(repo: string, number: number): Promise<boolean | null>;
  /** Does this repo run checks at all? A repo fact, not a clock. */
  hasCiHistory(repo: string): Promise<boolean>;
  listReviewThreads(repo: string, number: number): Promise<ReviewThread[]>;
  /** Open runs of PR-review family for this PR — "address round-trip in flight" signal. */
  countOpenReviewRuns(repo: string, number: number): Promise<number>;
  report(
    target: ParkedTarget,
    outcome: "success" | "changes_requested" | "failed",
    args?: Record<string, unknown>,
  ): Promise<void>;
}
