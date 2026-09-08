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
  /** Extra class for one row — a highlighted or invalidated row, not styling per cell. */
  rowClass?: (row: T) => string | undefined;
  /** Column indexes rendered monospace — identifiers and figures, not prose. */
  monoColumns?: number[];
  /** What to show when there are no rows — a sentence, or a whole empty state. */
  empty?: ReactNode;
}

/** One row's cells. Keyed by COLUMN name rather than by position, so a table whose columns change identity does not reuse a cell's DOM node for different data. */
function Cells({
  cells,
  columns,
  mono,
}: {
  cells: ReactNode[];
  columns: string[];
  mono: number[];
}) {
  return cells.map((cell, index) => (
    <td
      key={columns[index]}
      className={mono.includes(index) ? styles.mono : undefined}
    >
      {cell}
    </td>
  ));
}

/** The no-rows state, spanning the full width so it reads as a statement about the table rather than a value in its first column. */
function EmptyRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className={`meta ${styles.center}`}>
        {children}
      </td>
    </tr>
  );
}

export default function DataTable<T>(props: DataTableProps<T>) {
  const { columns, rows, rowKey, cells } = props;
  const { monoColumns = [], rowClass, empty = "No data" } = props;

  return (
    <>
      {props.title ? <h2>{props.title}</h2> : null}
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
            <tr key={rowKey(row, index)} className={rowClass?.(row)}>
              <Cells cells={cells(row)} columns={columns} mono={monoColumns} />
            </tr>
          ))}
          {rows.length === 0 ? (
            <EmptyRow span={columns.length}>{empty}</EmptyRow>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
