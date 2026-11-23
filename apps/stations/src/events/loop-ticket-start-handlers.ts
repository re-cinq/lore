// A person starting one named ticket now (specs/implementation-loop): the route has already told them which guard holds it, so a ticket refused here is only logged. The retry and dead-lettering are the bus's.
import { startNamedTicket } from "@re-cinq/lore-shared/backlog/named-ticket.js";
import type { LoopTickDeps } from "@re-cinq/lore-shared/backlog/implementation-loop-tick.js";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";

export interface LoopTicketStartDeps {
  tick: LoopTickDeps;
}

const TICKET_START = "loop.ticket.start";

export const LOOP_TICKET_START_EVENTS: readonly string[] = [TICKET_START];

export function loopTicketStartHandlers(
  deps: LoopTicketStartDeps,
): Map<string, EventHandler> {
  return new Map<string, EventHandler>([[TICKET_START, onTicketStart(deps)]]);
}

function onTicketStart(deps: LoopTicketStartDeps): EventHandler {
  return async (params) => {
    const { repo, issue_number: issueNumber } = params as {
      repo?: string;
      issue_number?: number;
    };

    if (!repo || !issueNumber) {
      return;
    }
    const refusal = await startNamedTicket(repo, issueNumber, deps.tick);

    console.log(
      `[stations] loop-ticket-start: ${repo}#${issueNumber}: ${refusal ?? "started"}`,
    );
  };
}
