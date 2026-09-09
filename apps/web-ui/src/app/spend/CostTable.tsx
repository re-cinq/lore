import type { ReactNode } from "react";
import DataTable from "@/components/DataTable";
import styles from "./SpendView.module.css";

/** The row a table shows instead of nothing. Rendering it from the table body keeps every table's empty state one decision rather than nine. */
export function EmptyRow({
  when,
  colSpan,
  message,
}: {
  when: boolean;
  colSpan: number;
  message: string;
}) {
  if (!when) {
    return null;
  }

  return (
    <tr>
      <td colSpan={colSpan} className={`meta ${styles.center}`}>
        {message}
      </td>
    </tr>
  );
}

/** Twelve breakdowns of the same spend differ only in their columns, so they are one table that takes them. `empty` is the message for no rows; omit it where an absent breakdown means the vendor never synced rather than spent nothing. */
interface CostTableProps<T> {
  title: string;
  columns: string[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  cells: (row: T) => ReactNode[];
  monoColumns?: number[];
  empty?: string;
}

/** The shared table, with the spend page's denser mono cells. */
export function CostTable<T>(props: CostTableProps<T>) {
  return <DataTable {...props} monoClass={styles.mono} />;
}
