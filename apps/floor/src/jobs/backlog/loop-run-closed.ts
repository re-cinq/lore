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

  if (awaitPr?.outcome === "changes_requested") {
    const detail =
      typeof run.args.reason === "string" ? ` (${run.args.reason})` : "";

    return `the pull request was not ready${detail}: it is red, or review threads stayed unresolved after the address round-trip`;
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
  const [{ pipeline, taskStore, eventReporter }, { projectFor }] =
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
    emitTick: (repo) =>
      eventReporter().insert({
        eventName: "cron.implementation_loop.tick",
        source: "internal",
        params: { repo },
      }),
  });
}
