import { formatDuration } from "@/lib/assembly-run-presenter";
import { formatDelta, type CompareRow } from "./compare-runs";
import styles from "./StationTimes.module.css";

/** Time per station for both runs: two bars per station and the difference A − B. */
export default function StationTimes({ rows }: { rows: CompareRow[] }) {
  return (
    <section className={styles.card} aria-labelledby="station-times">
      <header className={styles.top}>
        <h2 id="station-times" className={styles.title}>
          Time per station
        </h2>
        <Legend />
      </header>
      {rows.length === 0 ? (
        <p className={`meta ${styles.empty}`}>
          Neither run has reached a station yet.
        </p>
      ) : (
        rows.map((row) => <StationRow key={row.station} row={row} />)
      )}
    </section>
  );
}

function Legend() {
  return (
    <span className={styles.legend}>
      <span className={styles.key}>
        <span className={`${styles.swatch} ${styles.swatchA}`} />A
      </span>
      <span className={styles.key}>
        <span className={`${styles.swatch} ${styles.swatchB}`} />B
      </span>
      <span>Δ = A − B</span>
    </span>
  );
}

function StationRow({ row }: { row: CompareRow }) {
  return (
    <div className={styles.row} data-testid={`station-${row.station}`}>
      <span className={styles.station}>{row.station}</span>
      <span className={styles.bars}>
        <Bar share={row.aShare} seconds={row.a} side="A" />
        <Bar share={row.bShare} seconds={row.b} side="B" />
      </span>
      <span className={deltaClass(row.delta)}>{formatDelta(row.delta)}</span>
    </div>
  );
}

function deltaClass(delta: number | null): string {
  if (!delta) {
    return styles.delta;
  }

  return `${styles.delta} ${delta > 0 ? styles.slower : styles.faster}`;
}

interface BarProps {
  share: number;
  seconds: number | null;
  side: "A" | "B";
}

/** A bar drawn in SVG so its width is an attribute, not an inline style. */
function Bar({ share, seconds, side }: BarProps) {
  const label = seconds === null ? "not reached" : formatDuration(seconds);

  return (
    <span className={styles.barLine}>
      <svg
        className={styles.track}
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${side}: ${label}`}
      >
        <rect className={FILL[side]} width={share} height="8" rx="4" />
      </svg>
      <span className={styles.seconds}>{label}</span>
    </span>
  );
}

const FILL = { A: styles.fillA, B: styles.fillB };
