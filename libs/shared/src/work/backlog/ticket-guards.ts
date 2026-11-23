// What keeps a ticket from being started, asked the same way by the tick walking the backlog and by a person naming one ticket (specs/implementation-loop).
import { MAX_TASK_DESCRIPTION_CHARS } from "../../domain/task-description.js";
import { implementationLoopSwitchedOn } from "../../domain/loops/implementation-loop-enabled.js";
import { loopPaused } from "../../domain/loops/loop-pause.js";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type { LoopTickDeps } from "./implementation-loop-tick.js";
import { ticketTextTooLong } from "./ticket-description.js";
import { taskHoldingTicket } from "./ticket-holder.js";

export type LoopGuard = "loop_off" | "loop_paused" | "not_onboarded";

export type TicketGuard =
  | LoopGuard
  | "issue_not_open"
  | "text_too_long"
  | "open_blocker"
  | "active_task";

export type TicketGuardDeps = Pick<
  LoopTickDeps,
  | "rawSettings"
  | "isOnboarded"
  | "listIssues"
  | "openBlockers"
  | "activeTaskByIssue"
  | "openPrForBranch"
>;

/** Whether the repo's loop may start work at all: switched on, not paused, onboarded. A repo that is on but not onboarded says so, because a tick that only walked onboarded repos once skipped such a repo with no trace at all. */
export async function loopGuardOf(
  repo: string,
  settings: unknown,
  deps: Pick<TicketGuardDeps, "isOnboarded">,
): Promise<LoopGuard | null> {
  if (!implementationLoopSwitchedOn(settings)) {
    return "loop_off";
  }

  if (loopPaused("implementation", settings)) {
    return "loop_paused";
  }

  if (!(await deps.isOnboarded(repo))) {
    console.log(
      `[implementation-loop] ${repo}: loop enabled but the repo is not onboarded — its onboarding PR has not merged, so no ticket is picked`,
    );

    return "not_onboarded";
  }

  return null;
}

/** The guard that keeps one open ticket from being started, or null. A ticket no pod could start on is walked past, not dispatched, and the driver logs why. */
export async function candidateGuardOf(
  repo: string,
  candidate: IssueRef,
  deps: TicketGuardDeps,
): Promise<TicketGuard | null> {
  if (ticketTextTooLong(candidate)) {
    logTextTooLong(repo, candidate.number);

    return "text_too_long";
  }

  if (await waitsOnOpenBlockers(repo, candidate, deps)) {
    return "open_blocker";
  }

  return (await taskHoldingTicket(deps, repo, candidate.number))
    ? "active_task"
    : null;
}

/** A ticket whose blockers are still open is walked past, not dispatched: no pod can build on work that has not landed (run db0304bb). It is picked again on the first tick after its last blocker closes, with no label to lift. */
async function waitsOnOpenBlockers(
  repo: string,
  candidate: IssueRef,
  deps: Pick<TicketGuardDeps, "openBlockers">,
): Promise<boolean> {
  if (!candidate.blockedByCount) {
    return false;
  }
  const open = await deps.openBlockers(repo, candidate.number);

  if (open.length === 0) {
    return false;
  }

  console.log(
    `[implementation-loop] ${repo}: skipped #${candidate.number} — waits on open blocker(s) ${open.map((n) => `#${n}`).join(", ")}`,
  );

  return true;
}

/** A ticket whose text is too long is walked past, not minted: task creation would refuse it, and a refusal thrown at the head froze re-cinq/Otto's backlog for two days. */
function logTextTooLong(repo: string, issueNumber: number): void {
  console.log(
    `[implementation-loop] ${repo}: skipped #${issueNumber} — ticket text too long: its title and body exceed the ${MAX_TASK_DESCRIPTION_CHARS}-char task description limit`,
  );
}
