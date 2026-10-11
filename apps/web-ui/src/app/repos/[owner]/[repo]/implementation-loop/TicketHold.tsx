import type { LoopTicket } from "@/lib/api/backlog";
import styles from "./ImplementationLoopView.module.scss";

type Hold = NonNullable<LoopTicket["hold"]>;

/** The pill's words per kind. "text too long" is about TEXT on purpose: "too large" reads as a ticket with too much work in it. */
const KIND_LABEL: Record<Hold["kind"], string> = {
  text_too_long: "text too long",
  waits_on_blockers: "waits on blockers",
  two_priorities: "two priorities",
  parked: "parked",
  failed: "failed",
};

/** The kind of hold as a pill beside the title. Left out when the Status badge already says the same word. */
export function TicketHoldKind({ ticket }: { ticket: LoopTicket }) {
  const label = ticket.hold && KIND_LABEL[ticket.hold.kind];

  if (!label || label === ticket.state) {
    return null;
  }

  return (
    <span className={styles.holdKind} data-testid="ticket-hold-kind">
      {label}
    </span>
  );
}

/** Why the loop is not working the ticket, and what its reader does about it. */
export default function TicketHold({ ticket }: { ticket: LoopTicket }) {
  if (!ticket.hold) {
    return null;
  }

  return (
    <div
      className={styles.hold}
      data-testid={`ticket-hold-${ticket.issue_number}`}
    >
      <p className={styles.holdMessage}>{ticket.hold.message}</p>
      <p className={styles.holdFix}>
        <strong>Fix:</strong> {ticket.hold.fix}
      </p>
    </div>
  );
}
