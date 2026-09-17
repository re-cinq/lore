import { MAX_TASK_DESCRIPTION_CHARS } from "../../domain/task-description.js";

interface TicketText {
  title: string;
  body?: string;
}

// The ticket text an implementation-loop pod defines done against: title AND body — `picked.title` alone gave the DoD node a one-line ticket, which is how bowman-ui #11 redefined its issue into a different problem (#1745).
export function implementationTicketDescription(issue: TicketText): string {
  const body = issue.body?.trim() ?? "";

  return body.length === 0 ? issue.title : `${issue.title}\n\n${body}`;
}

/** A ticket whose text would not fit a task's description. The loop walks past it and the backlog page flags it, rather than cutting the body a DoD node defines done against. */
export function ticketTooLarge(issue: TicketText): boolean {
  return (
    implementationTicketDescription(issue).length > MAX_TASK_DESCRIPTION_CHARS
  );
}
