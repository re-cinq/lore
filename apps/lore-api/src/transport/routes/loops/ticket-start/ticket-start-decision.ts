import { guardNamedTicket } from "@re-cinq/lore-shared/backlog/named-ticket.js";
import type { TicketGuardDeps } from "@re-cinq/lore-shared/backlog/ticket-guards.js";
import type { EventReporter } from "@re-cinq/lore-shared/project/events/event-reporter-port.js";

export interface TicketStartDeps {
  guards: TicketGuardDeps;
  openRunOf(repo: string, issueNumber: number): Promise<{ id: string } | null>;
  report: EventReporter;
}

export type TicketStartAnswer =
  | { status: 202; body: { ok: true; issue_number: number } }
  | {
      status: 409;
      body: { error: string; guard: string; run_id?: string };
    };

/** Tells the person at once whether the named ticket can start, and only then asks the stations to start it: the same guards the tick applies, so a refusal is heard here rather than lost in the bus. */
export async function requestTicketStart(
  deps: TicketStartDeps,
  repo: string,
  issueNumber: number,
): Promise<TicketStartAnswer> {
  const refusal = await refusalOf(deps, repo, issueNumber);

  if (refusal) {
    return refusal;
  }
  await deps.report.insert({
    eventName: "loop.ticket.start",
    source: "internal",
    params: { repo, issue_number: issueNumber },
  });

  return { status: 202, body: { ok: true, issue_number: issueNumber } };
}

async function refusalOf(
  deps: TicketStartDeps,
  repo: string,
  issueNumber: number,
): Promise<TicketStartAnswer | null> {
  const run = await deps.openRunOf(repo, issueNumber);

  if (run) {
    return refusal("running", {
      error: `ticket ${issueNumber} is already being worked`,
      run_id: run.id,
    });
  }
  const guarded = await guardNamedTicket(repo, issueNumber, deps.guards);

  return "guard" in guarded
    ? refusal(guarded.guard, {
        error: `ticket ${issueNumber} cannot start: ${guarded.guard}`,
      })
    : null;
}

function refusal(
  guard: string,
  body: { error: string; run_id?: string },
): TicketStartAnswer {
  return {
    status: 409,
    body: {
      error: body.error,
      guard,
      ...(body.run_id ? { run_id: body.run_id } : {}),
    },
  };
}
