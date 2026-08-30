import { LORE_BLOCKED_LABEL } from "@re-cinq/lore-shared";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

/** The closed run's slice the hook reads — structurally satisfied by
 *  AssemblyRunRecord. */
export interface ClosedLoopRun {
  id: string;
  repo: string;
  blueprintName: string;
  taskId?: string | null;
  args: Record<string, unknown>;
  graph: RunGraph | null;
}

export interface LoopRunClosedDeps {
  getTaskIssueNumber(taskId: string): Promise<number | null>;
  listStationRuns(
    runId: string,
  ): Promise<
    Array<{ nodeId: string; iteration: number; outcome: string | null }>
  >;
  addLabel(repo: string, issueNumber: number, label: string): Promise<void>;
  comment(repo: string, issueNumber: number, body: string): Promise<void>;
  /** Re-arm: emit `cron.implementation_loop.tick` scoped to the repo, so the
   *  next ticket starts in seconds, not at the next 5-minute safety tick. */
  emitTick(repo: string): Promise<void>;
}

/** Terminal outcomes that are NOT failures — everything else blocks the ticket. */
const CLEAN_OUTCOMES = new Set(["completed", "lease_held"]);

/**
 * The loop's terminal hook (FR2 re-arm + FR8 blocked tickets). A blocked or
 * errored ticket gets `lore:blocked` — which makes it ineligible under FR1
 * until a human removes it — and a comment naming the failing condition and
 * linking the run's PR. The PR is left open; nothing is closed or reverted.
 * The re-arm always happens, even when the issue write fails: one bad ticket
 * never freezes a repo's backlog.
 */
export async function handleLoopRunClosed(
  run: ClosedLoopRun,
  outcome: string,
  reason: string | undefined,
  deps: LoopRunClosedDeps,
): Promise<void> {
  if (run.blueprintName !== "implementation-loop") {
    return;
  }

  try {
    const blockedReason = await blockedReasonFor(run, outcome, reason, deps);

    if (blockedReason) {
      await markIssueBlocked(run, blockedReason, deps);
    }
  } catch (err) {
    console.error(
      `[implementation-loop] blocked-marking for ${run.id} failed: ${(err as Error).message}`,
    );
  }
  await deps.emitTick(run.repo);
}

async function blockedReasonFor(
  run: ClosedLoopRun,
  outcome: string,
  reason: string | undefined,
  deps: LoopRunClosedDeps,
): Promise<string | null> {
  if (!CLEAN_OUTCOMES.has(outcome)) {
    return reason
      ? `the run ended ${outcome}: ${reason}`
      : `the run ended ${outcome}`;
  }
  const prReviewIds = new Set(
    (run.graph?.nodes ?? [])
      .filter((n) => n.type === "pr_review")
      .map((n) => n.id),
  );
  const awaitPr = (await deps.listStationRuns(run.id))
    .filter((n) => prReviewIds.has(n.nodeId))
    .at(-1);

  // BOTH non-success resumes block, and the reason is the run being CLOSED at
  // all. A repaired build never reaches here: fix-ci success routes back to the
  // wait, which opens a new pr_review row and parks the run again. So a closed
  // run whose last wait resumed `changes_requested` is one where fix-ci gave up
  // — and blocking only on `failed` let that ticket re-arm, into a fresh run
  // whose `await-pr -> fix-ci` counter starts at zero. A build that cannot be
  // reproduced locally would have cycled across runs without bound, since
  // iteration_max bounds one run and nothing bounded the re-arm.
  if (
    awaitPr?.outcome === "changes_requested" ||
    awaitPr?.outcome === "failed"
  ) {
    const detail =
      typeof run.args.reason === "string" ? ` (${run.args.reason})` : "";
    const why =
      awaitPr.outcome === "failed"
        ? "review threads stayed unresolved after the address round-trip"
        : "its build stayed red after the repair attempts were spent";

    return `the pull request was not ready${detail}: ${why}`;
  }

  return null;
}

async function markIssueBlocked(
  run: ClosedLoopRun,
  blockedReason: string,
  deps: LoopRunClosedDeps,
): Promise<void> {
  const issueNumber = run.taskId
    ? await deps.getTaskIssueNumber(run.taskId)
    : null;

  if (!issueNumber) {
    console.warn(
      `[implementation-loop] run ${run.id} blocked but no issue to mark`,
    );

    return;
  }
  const prLine =
    typeof run.args.pr_url === "string"
      ? `\n\nThe pull request stays open for a human: ${run.args.pr_url}`
      : "";

  await deps.addLabel(run.repo, issueNumber, LORE_BLOCKED_LABEL);
  await deps.comment(
    run.repo,
    issueNumber,
    `Lore's implementation loop is parking this ticket: ${blockedReason}.` +
      `${prLine}\n\nRemove the \`${LORE_BLOCKED_LABEL}\` label to re-queue it. Run: \`${run.id}\``,
  );
}

/** Production hook for finishLine's onRunClosed seam. */
export async function loopRunClosed(
  run: ClosedLoopRun,
  outcome: string,
  reason: string | undefined,
): Promise<void> {
  const [{ pipeline, taskStore, eventProxy }, { projectFor }] =
    await Promise.all([
      import("../../kernel/queues.js"),
      import("../../composition/project-boot.js"),
    ]);

  await handleLoopRunClosed(run, outcome, reason, {
    getTaskIssueNumber: async (taskId) => {
      const task = await taskStore().getById(taskId);
      const n = Number(
        (task as { issue_number?: unknown } | null)?.issue_number,
      );

      return n > 0 ? n : null;
    },
    listStationRuns: (runId) => pipeline().assemblyRuns.listStationRuns(runId),
    addLabel: async (repo, issueNumber, label) =>
      (await projectFor(repo)).issues.addLabel(issueNumber, label),
    comment: async (repo, issueNumber, body) =>
      (await projectFor(repo)).issues.comment(issueNumber, body),
    // Queued, not inserted: `onRunClosed` swallows whatever this throws, so a
    // router blip used to lose the tick outright and the loop simply stopped
    // until the cron emitter came round. The proxy retries it instead.
    emitTick: (repo) =>
      eventProxy().emit({
        kind: "event",
        event: {
          eventName: "cron.implementation_loop.tick",
          source: "internal",
          params: { repo },
        },
      }),
  });
}
