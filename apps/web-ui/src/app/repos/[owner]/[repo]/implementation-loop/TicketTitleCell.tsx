import type { LoopTicket } from "@/lib/api/backlog";
import styles from "./ImplementationLoopView.module.scss";
import TicketHold, { TicketHoldKind } from "./TicketHold";

/** The Ticket column: the issue link, its priority, and what holds the ticket when something does. */
export default function TicketTitleCell({ ticket }: { ticket: LoopTicket }) {
  return (
    <td>
      <TicketLink ticket={ticket} />
      {ticket.priority && (
        <span className={styles.priority}>{ticket.priority}</span>
      )}
      <TicketHoldKind ticket={ticket} />
      <TicketHold ticket={ticket} />
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
