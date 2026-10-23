import { KindPill } from "../LoopTable";
import type { BoardRow } from "./board";
import styles from "./BoardView.module.scss";
import RowHold, { RowHoldKind } from "./RowHold";

interface RowSubjectCellProps {
  row: BoardRow;
  /** Name the row's loop: on when the board shows more than one. */
  showLoop: boolean;
}

/** The subject column: the issue or pull request link, its tag, the loop it belongs to, and what holds it when something does. */
export default function RowSubjectCell({ row, showLoop }: RowSubjectCellProps) {
  return (
    <td>
      <RowLink row={row} />
      {row.tag && <span className={styles.tag}>{row.tag}</span>}
      {showLoop && <KindPill>{row.loop.label}</KindPill>}
      <RowHoldKind row={row} />
      <RowHold row={row} />
    </td>
  );
}

/** The reference, linked out when the row knows its URL. */
function RowLink({ row }: { row: BoardRow }) {
  const label = [row.ref, row.title].filter(Boolean).join(" ");

  return row.url ? (
    <a href={row.url} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}
