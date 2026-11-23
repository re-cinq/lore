// A person starts one named ticket now (specs/implementation-loop): the tick's guards apply, its cap on open runs does not.
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import { startTicket, type LoopTickDeps } from "./implementation-loop-tick.js";
import {
  candidateGuardOf,
  loopGuardOf,
  type TicketGuard,
  type TicketGuardDeps,
} from "./ticket-guards.js";

/** The open ticket, or the guard that holds it. */
export async function guardNamedTicket(
  repo: string,
  issueNumber: number,
  deps: TicketGuardDeps,
): Promise<{ issue: IssueRef } | { guard: TicketGuard }> {
  const loopGuard = await loopGuardOf(repo, await deps.rawSettings(repo), deps);

  if (loopGuard) {
    return { guard: loopGuard };
  }
  const issue = (await deps.listIssues(repo)).find(
    ({ number }) => number === issueNumber,
  );

  if (!issue) {
    return { guard: "issue_not_open" };
  }
  const guard = await candidateGuardOf(repo, issue, deps);

  return guard ? { guard } : { issue };
}

/** Starts the named ticket's run, or answers the guard that refused it. */
export async function startNamedTicket(
  repo: string,
  issueNumber: number,
  deps: LoopTickDeps,
): Promise<TicketGuard | null> {
  const guarded = await guardNamedTicket(repo, issueNumber, deps);

  if ("guard" in guarded) {
    return guarded.guard;
  }
  await startTicket(repo, guarded.issue, deps);

  return null;
}
