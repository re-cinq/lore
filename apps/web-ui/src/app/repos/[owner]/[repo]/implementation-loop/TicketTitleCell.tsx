import type { LoopTicket } from "@/lib/api/backlog";
import styles from "./ImplementationLoopView.module.scss";

/** The Ticket column: the issue link, its priority, and any warning or error the row has to explain. */
export default function TicketTitleCell({ ticket }: { ticket: LoopTicket }) {
  return (
    <td>
      <TicketLink ticket={ticket} />
      {ticket.priority && (
        <span className={styles.priority}>{ticket.priority}</span>
      )}
      <TextTooLongPill ticket={ticket} />
      <TicketError ticket={ticket} />
    </td>
  );
}

/** The issue reference, linked out when the ticket knows its issue URL. */
function TicketLink({ ticket }: { ticket: LoopTicket }) {
  const label = `#${ticket.issue_number} ${ticket.title}`;

  return ticket.issue_url ? (
    <a href={ticket.issue_url} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}

/** Why the loop could not finish the ticket, shown inline so a blocked ticket explains itself. */
function TicketError({ ticket }: { ticket: LoopTicket }) {
  if (!ticket.error) {
    return null;
  }

  return (
    <p
      className={styles.errorLine}
      title={ticket.error}
      data-testid={`ticket-error-${ticket.issue_number}`}
    >
      {ticket.error}
    </p>
  );
}

/** Warns that the loop will walk past this ticket: its issue text is longer than a task description may be. Worded about TEXT, so it does not read as a ticket with too much work in it. */
function TextTooLongPill({ ticket }: { ticket: LoopTicket }) {
  if (!ticket.text_too_long) {
    return null;
  }

  return (
    <span
      className={styles.textTooLong}
      title="The issue's title and body are longer than a task description may be, so the loop will not pick it. Shorten the issue text to queue it."
      data-testid="ticket-text-too-long"
    >
      text too long
    </span>
  );
}
