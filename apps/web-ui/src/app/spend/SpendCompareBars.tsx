import styles from "./SpendView.module.css";
import { usd } from "./spend-format";
import { comparePair } from "./spend-chart-geometry";

export interface ComparePairInput {
  label: string;
  /** What Lore computed from token counts. */
  estimate: number;
  /** What the vendor invoiced, or null when that vendor has never synced — a pair with no billed side is not a comparison. */
  billed: number | null;
}

interface SpendCompareBarsProps {
  pairs: ComparePairInput[];
}

interface ComparableRow {
  label: string;
  estimate: number;
  billed: number;
}

/** Estimate against invoice, side by side, for every vendor that has synced. This is the one visual that answers "is what Lore computed close to what we were charged". */
export function SpendCompareBars({ pairs }: SpendCompareBarsProps) {
  const rows = comparable(pairs);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className={styles.compare}>
      {rows.map((row) => (
        <CompareRow key={row.label} row={row} />
      ))}
    </div>
  );
}

function comparable(pairs: ComparePairInput[]): ComparableRow[] {
  return pairs.flatMap((p) =>
    p.billed === null
      ? []
      : [{ label: p.label, estimate: p.estimate, billed: p.billed }],
  );
}

function CompareRow({ row }: { row: ComparableRow }) {
  const { estimateFraction, billedFraction } = comparePair(
    row.estimate,
    row.billed,
  );

  return (
    <div className={styles.compareRow}>
      <div className={`meta ${styles.compareLabel}`}>{row.label}</div>
      <CompareBars
        row={row}
        estimateFraction={estimateFraction}
        billedFraction={billedFraction}
      />
      <CompareFigures row={row} />
    </div>
  );
}

interface CompareBarsProps {
  row: ComparableRow;
  estimateFraction: number;
  billedFraction: number;
}

interface Segment {
  tone: string;
  top: number;
  width: number;
}

/** Estimate in the info tone, invoice in solid text — the colour language the headline cards already use, so a reader knows which is which. */
function CompareBars({
  row,
  estimateFraction,
  billedFraction,
}: CompareBarsProps) {
  const label = `${row.label}: estimate ${usd(row.estimate)}, billed ${usd(row.billed)}`;

  return (
    <svg
      className={styles.compareBars}
      viewBox="0 0 100 22"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {barSegments(estimateFraction, billedFraction).map((seg) => (
        <SegmentBar key={seg.top} seg={seg} />
      ))}
    </svg>
  );
}

function SegmentBar({ seg }: { seg: Segment }) {
  return (
    <rect className={seg.tone} x="0" y={seg.top} width={seg.width} height="9" />
  );
}

function barSegments(
  estimateFraction: number,
  billedFraction: number,
): Segment[] {
  return [
    { tone: styles.compareEstimate, top: 1, width: estimateFraction * 100 },
    { tone: styles.compareBilled, top: 12, width: billedFraction * 100 },
  ];
}

function CompareFigures({ row }: { row: ComparableRow }) {
  return (
    <div className={`meta ${styles.compareFigures}`}>
      <span className={styles.figureInfo}>{usd(row.estimate)}</span>
      <span> estimate</span>
      <span className={styles.compareBilledFigure}>{usd(row.billed)}</span>
      <span> billed</span>
    </div>
  );
}
