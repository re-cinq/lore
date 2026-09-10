import styles from "./SpendView.module.css";
import type { SpendWindow } from "./SpendView";
import { usd, day } from "./spend-format";
import { barHeightFractions } from "./spend-chart-geometry";

interface SpendTrendChartProps {
  daily: SpendWindow["llm"]["daily"];
}

interface Column {
  key: string;
  cx: number;
  barY: number;
  barH: number;
  costLabel: string;
  dateLabel: string;
}

const COL_W = 64;
const BAR_W = 38;
const TOP = 16;
const BAR_AREA = 94;
const BASELINE = TOP + BAR_AREA;
const HEIGHT = 140;

/** LLM cost per day. Each column shows its cost above the bar and its date below, so the numbers read off the chart itself; the Daily Cost table under the disclosure carries calls and full precision. */
export function SpendTrendChart({ daily }: SpendTrendChartProps) {
  if (daily.length === 0) {
    return <p className="meta">No daily spend in this interval.</p>;
  }
  const cols = columns(daily);
  const peak = peakDay(daily);

  return (
    <svg
      className={styles.trendChart}
      viewBox={`0 0 ${cols.length * COL_W} ${HEIGHT}`}
      role="img"
      aria-label={`Daily LLM cost, peak ${usd(peak.cost_usd)} on ${day(peak.bucket_date)}`}
    >
      {cols.map((col) => (
        <TrendColumn key={col.key} col={col} />
      ))}
    </svg>
  );
}

function TrendColumn({ col }: { col: Column }) {
  return (
    <g>
      <text className={styles.trendValue} x={col.cx} y={11} textAnchor="middle">
        {col.costLabel}
      </text>
      <rect
        className={styles.trendBar}
        x={col.cx - BAR_W / 2}
        y={col.barY}
        width={BAR_W}
        height={col.barH}
        rx={3}
      />
      <text className={styles.trendDate} x={col.cx} y={126} textAnchor="middle">
        {col.dateLabel}
      </text>
    </g>
  );
}

function peakDay(daily: SpendTrendChartProps["daily"]) {
  return daily.reduce((top, r) => (r.cost_usd > top.cost_usd ? r : top));
}

function columns(daily: SpendTrendChartProps["daily"]): Column[] {
  const ordered = ascendingByDate(daily);
  const heights = barHeightFractions(ordered.map((r) => r.cost_usd));

  return ordered.map((row, i) => {
    const barH = Math.max(2, heights[i] * BAR_AREA);

    return {
      key: row.bucket_date,
      cx: i * COL_W + COL_W / 2,
      barY: BASELINE - barH,
      barH,
      costLabel: usd(row.cost_usd),
      // "2026-09-01" -> "09-01": the day is what a reader scans, the year is noise.
      dateLabel: row.bucket_date.slice(5),
    };
  });
}

/** Left-to-right time axis: the API may hand the days back newest-first, so sort a copy rather than trust the order. */
function ascendingByDate(daily: SpendTrendChartProps["daily"]) {
  return [...daily].sort((a, b) => a.bucket_date.localeCompare(b.bucket_date));
}
