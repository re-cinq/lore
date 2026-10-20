import styles from "./insights.module.css";

export interface ColumnPoint {
  key: string;
  value: number;
  /** Tooltip for the column, e.g. "3 Oct: 4,200 calls". */
  label: string;
}

interface ColumnChartProps {
  points: readonly ColumnPoint[];
  /** What the whole chart shows, read out in place of the columns. */
  label: string;
  startLabel?: string;
  endLabel?: string;
}

/** Vertical columns scaled to the tallest point, oldest on the left. */
export function ColumnChart(props: ColumnChartProps) {
  const max = Math.max(1, ...props.points.map((p) => p.value));

  return (
    <div className={styles.chart}>
      <div className={styles.columns} role="img" aria-label={props.label}>
        {props.points.map((p) => (
          <Column key={p.key} point={p} max={max} />
        ))}
      </div>
      <div className={styles.axis}>
        <span>{props.startLabel}</span>
        <span>{props.endLabel}</span>
      </div>
    </div>
  );
}

function Column({ point, max }: { point: ColumnPoint; max: number }) {
  return (
    <span
      title={point.label}
      className={styles.column}
      style={{ ["--column-h" as string]: `${(point.value / max) * 100}%` }}
    />
  );
}
