import { InsightsCard } from "@/components/insights/InsightsCard";
import { Meter } from "@/components/insights/Meter";
import type { LatencyStats } from "./AnalyticsView";
import styles from "./AnalyticsView.module.css";

/** The retrieval budget. Past it, context assembly is what the developer is waiting on rather than something they would not notice. */
const P95_BUDGET_MS = 200;

const ms = (value: number | null) => `${Number(value).toFixed(0)}ms`;

/** One row per retrieval tool: its call count, p95 against the budget, p50 and p99 beside it, and a verdict. */
interface LatencyProps {
  latencyStats: LatencyStats[];
}

export function RetrievalLatency({ latencyStats }: LatencyProps) {
  return (
    <InsightsCard
      title="Retrieval Performance (Last 7 Days)"
      caption={`Budget: p95 under ${P95_BUDGET_MS}ms`}
      flush
    >
      {latencyStats.length === 0 ? (
        <p className={`meta ${styles.emptyRow}`}>
          No latency data yet. Use search_memory, query_graph, or
          assemble_context to generate data.
        </p>
      ) : (
        <LatencyList latencyStats={latencyStats} />
      )}
    </InsightsCard>
  );
}

/** The meters share one scale: twice the budget, or the slowest p95 when that is further out. */
function LatencyList({ latencyStats }: { latencyStats: LatencyStats[] }) {
  const scale = Math.max(
    P95_BUDGET_MS * 2,
    ...latencyStats.map((r) => Number(r.p95_ms)),
  );

  return (
    <ul className={styles.rows} aria-label="Latency by tool">
      {latencyStats.map((row) => (
        <LatencyRow key={row.tool} row={row} scale={scale} />
      ))}
    </ul>
  );
}

function LatencyRow({ row, scale }: { row: LatencyStats; scale: number }) {
  const p95 = Number(row.p95_ms);

  return (
    <li className={styles.latencyRow}>
      <span className={styles.tool}>{row.tool}</span>
      <span className={styles.calls}>
        <span>{Number(row.call_count).toLocaleString()}</span> calls
      </span>
      <P95Meter p95={p95} scale={scale} />
      <span className={`${styles.mono} ${styles.tails}`}>
        p50 <span>{ms(row.p50_ms)}</span> · p99 <span>{ms(row.p99_ms)}</span>
      </span>
      <LatencyVerdict p95Ms={p95} />
    </li>
  );
}

function P95Meter({ p95, scale }: { p95: number; scale: number }) {
  return (
    <span className={styles.p95}>
      <Meter fraction={p95 / scale} tone={p95 > P95_BUDGET_MS ? "bad" : "ok"} />
      <span className={styles.mono}>
        p95 <span>{ms(p95)}</span>
      </span>
    </span>
  );
}

/** Whether this tool is inside the retrieval budget. */
function LatencyVerdict({ p95Ms }: { p95Ms: number }) {
  if (p95Ms > P95_BUDGET_MS) {
    return (
      <span className={`op-badge op-delete ${styles.verdict}`}>&gt;200ms</span>
    );
  }

  return <span className={`op-badge op-write ${styles.verdict}`}>OK</span>;
}
