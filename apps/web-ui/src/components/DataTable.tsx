import type { ReactNode } from "react";
import styles from "./DataTable.module.css";

// Most tables differ only in their columns and how a row becomes cells, so this is that table — an empty state cannot drift between two pages showing the same kind of data.

export interface DataTableProps<T> {
  /** Rendered above the table when given; omit for a table already under its own heading. */
  title?: string;
  columns: string[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  cells: (row: T) => ReactNode[];
  /** Column indexes rendered monospace — identifiers and figures, not prose. */
  monoColumns?: number[];
  /** What to show when there are no rows — a sentence, or a whole empty state. */
  empty?: ReactNode;
}

export default function DataTable<T>({
  title,
  columns,
  rows,
  rowKey,
  cells,
  monoColumns = [],
  empty = "No data",
}: DataTableProps<T>) {
  return (
    <>
      {title ? <h2>{title}</h2> : null}
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
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
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={`meta ${styles.center}`}>
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
