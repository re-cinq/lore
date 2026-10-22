// What the decompose agent is told about the tickets an earlier run filed for the spec: enough to keep a task's id when it is still the same work.
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";

export interface TicketListing {
  id: string;
  title: string;
  number: number;
  state: IssueRef["state"];
}

export function ticketsListing(
  tasks: ReadonlyMap<string, IssueRef>,
): TicketListing[] {
  return [...tasks].map(([id, { title, number, state }]) => ({
    id,
    title,
    number,
    state,
  }));
}
