import type { BoardRow, Hold } from "./board";
import styles from "./BoardView.module.scss";

/** The pill's words per kind. "text too long" is about TEXT on purpose: "too large" reads as a ticket with too much work in it. */
const KIND_LABEL: Record<Hold["kind"], string> = {
  text_too_long: "text too long",
  waits_on_blockers: "waits on blockers",
  awaiting_merge: "awaiting merge",
  two_priorities: "two priorities",
  parked: "parked",
  failed: "failed",
};

/** The kind of hold as a pill beside the title. Left out when the Status badge already says the same word. */
export function RowHoldKind({ row }: { row: BoardRow }) {
  const label = row.hold && KIND_LABEL[row.hold.kind];

  if (!label || label === row.state) {
    return null;
  }

  return (
    <span className={styles.holdKind} data-testid="row-hold-kind">
      {label}
    </span>
  );
}

/** Why the loop is not working the row, and what its reader does about it. */
export default function RowHold({ row }: { row: BoardRow }) {
  if (!row.hold) {
    return null;
  }

  return (
    <div className={styles.hold} data-testid={`row-hold-${row.ref}`}>
      <p className={styles.holdMessage}>{row.hold.message}</p>
      <p className={styles.holdFix}>
        <strong>Fix:</strong> {row.hold.fix}
      </p>
    </div>
  );
}
