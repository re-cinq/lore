import { LORE_BLOCKED_LABEL } from "@re-cinq/lore-shared";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

/** The closed run's slice the hook reads — structurally satisfied by AssemblyRunRecord. */
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
  /** Re-arm: emit `cron.implementation_loop.tick` scoped to the repo, so the next ticket starts in seconds, not at the next 5-minute safety tick. */
  emitTick(repo: string): Promise<void>;
}

/** Terminal outcomes that are NOT failures — everything else blocks the ticket. */
const CLEAN_OUTCOMES = new Set(["completed", "lease_held"]);

/** The loop's terminal hook (FR2 re-arm + FR8 blocked tickets): a blocked/errored ticket gets `lore:blocked` (ineligible under FR1) plus a comment naming the failure, PR left open; the re-arm always happens even when the issue write fails, so one bad ticket never freezes the backlog. */
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

function describeUncleanOutcome(
  outcome: string,
  reason: string | undefined,
): string {
  return reason
    ? `the run ended ${outcome}: ${reason}`
    : `the run ended ${outcome}`;
}

/** The last pr_review-node outcome recorded on this run, or null when none ran. */
async function latestPrReviewOutcome(
  run: ClosedLoopRun,
  deps: LoopRunClosedDeps,
): Promise<string | null> {
  const prReviewIds = new Set(
    (run.graph?.nodes ?? [])
      .filter((n) => n.type === "pr_review")
      .map((n) => n.id),
  );
  const awaitPr = (await deps.listStationRuns(run.id))
    .filter((n) => prReviewIds.has(n.nodeId))
    .at(-1);

  return awaitPr?.outcome ?? null;
}

function describePrNotReady(run: ClosedLoopRun, prOutcome: string): string {
  const detail =
    typeof run.args.reason === "string" ? ` (${run.args.reason})` : "";
  const why =
    prOutcome === "failed"
      ? "review threads stayed unresolved after the address round-trip"
      : "its build stayed red after the repair attempts were spent";

  return `the pull request was not ready${detail}: ${why}`;
}

async function blockedReasonFor(
  run: ClosedLoopRun,
  outcome: string,
  reason: string | undefined,
  deps: LoopRunClosedDeps,
): Promise<string | null> {
  if (!CLEAN_OUTCOMES.has(outcome)) {
    return describeUncleanOutcome(outcome, reason);
  }

  const prOutcome = await latestPrReviewOutcome(run, deps);

  // BOTH non-success resumes block: a repaired build never reaches here (fix-ci success routes back to the wait), so blocking only on `failed` let a re-armed run's iteration_max reset and cycle unbounded across runs.
  if (prOutcome === "changes_requested" || prOutcome === "failed") {
    return describePrNotReady(run, prOutcome);
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
    // Queued, not inserted: `onRunClosed` swallows what this throws, so a router blip used to lose the tick until the cron emitter came round — the proxy retries it instead.
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
