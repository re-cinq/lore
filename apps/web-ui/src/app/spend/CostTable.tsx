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
interface CostTableProps<T> {
  title: string;
  columns: string[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  cells: (row: T) => ReactNode[];
  monoColumns?: number[];
  empty?: string;
}

/** The column headings. Keyed by their own text, which is also what each cell below is keyed by — the two must agree or a cell lands under the wrong heading. */
function CostHead({ columns }: { columns: string[] }) {
  return (
    <thead>
      <tr>
        {columns.map((column) => (
          <th key={column}>{column}</th>
        ))}
      </tr>
    </thead>
  );
}

/** One row of figures. Cells are keyed by their column name rather than by index, so a table whose columns change between renders does not reuse a cell under a heading it no longer belongs to. */
function CostRow({
  cells,
  columns,
  monoColumns,
}: {
  cells: ReactNode[];
  columns: string[];
  monoColumns: number[];
}) {
  return (
    <tr>
      {cells.map((cell, index) => (
        <td
          key={columns[index]}
          className={monoColumns.includes(index) ? styles.mono : undefined}
        >
          {cell}
        </td>
      ))}
    </tr>
  );
}

export function CostTable<T>(props: CostTableProps<T>) {
  const { title, columns, rows, rowKey, cells } = props;
  const { monoColumns = [], empty = "No data" } = props;

  return (
    <>
      <h2>{title}</h2>
      <table>
        <CostHead columns={columns} />
        <tbody>
          {rows.map((row) => (
            <CostRow
              key={rowKey(row)}
              cells={cells(row)}
              columns={columns}
              monoColumns={monoColumns}
            />
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
