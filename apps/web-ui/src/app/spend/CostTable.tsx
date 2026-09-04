import type { ReactNode } from "react";
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
export function CostTable<T>({
  title,
  columns,
  rows,
  rowKey,
  cells,
  monoColumns = [],
  empty = "No data",
}: {
  title: string;
  columns: string[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  cells: (row: T) => ReactNode[];
  monoColumns?: number[];
  empty?: string;
}) {
  return (
    <>
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {cells(row).map((cell, index) => (
                <td
                  key={columns[index]}
                  className={
                    monoColumns.includes(index) ? styles.mono : undefined
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          <EmptyRow
            when={rows.length === 0}
            colSpan={columns.length}
            message={empty}
          />
        </tbody>
      </table>
    </>
  );
}
