import Link from "next/link";
import ScreenHeader from "@/components/ScreenHeader";
import FilterChips, { type FilterChip } from "@/components/FilterChips";
import { EmptyState } from "@/components/EmptyState";
import Icon from "@/components/Icon";
import { StatusPill } from "@/components/StatusPill";
import {
  formatDuration,
  formatRelativeTime,
} from "@/lib/assembly-run-presenter";
import type { AssemblyRun, AssemblyRunNode } from "@/lib/assembly-run-rows";
import { formatTokens, type RunTokens } from "@/lib/run-tokens";
import { compareInsight, compareRows } from "./compare-runs";
import { runPill } from "./run-pill";
import StationTimes from "./StationTimes";
import styles from "./CompareView.module.css";

/** One run with what the comparison reads of it. */
export interface CompareSide {
  run: AssemblyRun;
  nodes: AssemblyRunNode[];
  tokens: RunTokens | null;
}

export interface CompareViewProps {
  a: CompareSide | null;
  b: CompareSide | null;
  /** Other runs of A's line in A's repository, to compare A with. */
  candidates: AssemblyRun[];
  nowMs?: number;
}

/** Two runs of one line, station by station. */
export default function CompareView(props: CompareViewProps) {
  const { a, b } = props;

  return (
    <div className={styles.screen}>
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <Link href="/assembly-runs">Assembly runs</Link>
        <span aria-hidden="true">/</span>
        <span>Compare</span>
      </nav>
      <ScreenHeader group="work" title="Compare runs" lede={ledeOf(a)} />
      {a ? <Comparison {...props} a={a} /> : <RunPicker />}
      {a && !b ? (
        <p className="meta">Pick a run above to compare A with.</p>
      ) : null}
    </div>
  );
}

function ledeOf(a: CompareSide | null): string {
  return a
    ? `Two runs of ${a.run.blueprintName}, station by station.`
    : "Two runs of one line, station by station.";
}

function RunPicker() {
  return (
    <EmptyState
      title="No run to compare yet"
      description="Open a run and compare it with another run of the same line."
      action={{ href: "/assembly-runs", label: "Browse assembly runs" }}
    />
  );
}

function Comparison(props: CompareViewProps & { a: CompareSide }) {
  const { a, b, candidates, nowMs } = props;

  return (
    <>
      <FilterChips label="Compare A with" chips={chipsOf(a, b, candidates)} />
      <div className={styles.heads}>
        <RunHead tag="A" side={a} nowMs={nowMs} />
        {b ? <RunHead tag="B" side={b} nowMs={nowMs} /> : null}
      </div>
      {b ? <Differences a={a} b={b} /> : null}
    </>
  );
}

function chipsOf(
  a: CompareSide,
  b: CompareSide | null,
  candidates: readonly AssemblyRun[],
): FilterChip[] {
  return candidates.map((run) => ({
    label: `#${run.id.slice(0, 8)}`,
    href: `/compare?a=${a.run.id}&b=${run.id}`,
    active: run.id === b?.run.id,
    tone: runPill(run).tone,
  }));
}

interface RunHeadProps {
  tag: "A" | "B";
  side: CompareSide;
  nowMs?: number;
}

function RunHead({ tag, side, nowMs }: RunHeadProps) {
  const { run } = side;
  const pill = runPill(run);

  return (
    <Link href={`/assembly-runs/${run.id}`} className={styles.head}>
      <span className={styles.headTop}>
        <span className={styles.tag}>{tag}</span>
        <span className={styles.runId}>#{run.id.slice(0, 8)}</span>
        <StatusPill label={pill.label} tone={pill.tone} />
      </span>
      {run.branch ? <span className={styles.branch}>{run.branch}</span> : null}
      <span className={styles.started}>
        Started {formatRelativeTime(run.startedAt ?? run.createdAt, nowMs)}
        {run.createdBy ? ` by ${run.createdBy}` : ""}
      </span>
    </Link>
  );
}

function Differences({ a, b }: { a: CompareSide; b: CompareSide }) {
  const rows = compareRows(a.nodes, b.nodes);

  return (
    <>
      <aside className={styles.insight}>
        <Icon name="info" />
        <span className={styles.insightText}>
          <strong>What&apos;s different</strong>
          <span>{compareInsight(rows)}</span>
        </span>
      </aside>
      <StationTimes rows={rows} />
      <Metrics a={a} b={b} />
    </>
  );
}

const METRICS: [string, (side: CompareSide) => string][] = [
  ["Status", (s) => runPill(s.run).label],
  ["Duration", (s) => formatDuration(s.run.durationSeconds)],
  ["Tokens", (s) => (s.tokens ? formatTokens(s.tokens.total) : "—")],
  ["Station visits", (s) => String(s.nodes.length)],
  ["Pull request", (s) => (s.run.prNumber ? `#${s.run.prNumber}` : "—")],
];

function Metrics({ a, b }: { a: CompareSide; b: CompareSide }) {
  return (
    <table className={styles.metrics}>
      <thead>
        <tr>
          {["Metric", "A", "B"].map((col) => (
            <th key={col} scope="col">
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {METRICS.map(([label, read]) => (
          <MetricRow key={label} label={label} values={[read(a), read(b)]} />
        ))}
      </tbody>
    </table>
  );
}

function MetricRow({ label, values }: { label: string; values: string[] }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {values.map((value, i) => (
        <td key={i}>{value}</td>
      ))}
    </tr>
  );
}
