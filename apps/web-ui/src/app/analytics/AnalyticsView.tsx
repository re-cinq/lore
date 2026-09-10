import styles from "./AnalyticsView.module.css";
import DataTable from "@/components/DataTable";
import type { components } from "@/lib/api/schema";

export interface TaskSummary {
  total: number;
  succeeded: number;
  failed: number;
  active: number;
}

// Aliases over the /api/analytics-overview contract; JobRun's fields come from the pipeline.job_runs model.
type Overview = components["schemas"]["AnalyticsOverview"];

export type LatencyStats = Overview["latency_stats"][number];
export type UsageByTaskType = Overview["usage_by_task_type"][number];
export type UsageByRepo = Overview["usage_by_repo"][number];
export type DailyUsage = Overview["daily_usage"][number];
export type JobRun = Overview["job_runs"][number];

export interface AnalyticsViewProps {
  taskSummary: TaskSummary | null;
  latencyStats: LatencyStats[];
  usageByTaskType: UsageByTaskType[];
  usageByRepo: UsageByRepo[];
  dailyUsage: DailyUsage[];
  jobRuns: JobRun[];
}

// Pure render — page.tsx runs all the SQL and passes resolved row arrays.
export default function AnalyticsView({
  taskSummary,
  latencyStats,
  usageByTaskType,
  usageByRepo,
  dailyUsage,
  jobRuns,
}: AnalyticsViewProps) {
  return (
    <div>
      <h1>Analytics</h1>

      <TaskSummaryCards taskSummary={taskSummary} />
      <RetrievalLatency latencyStats={latencyStats} />
      <UsageByTaskType usageByTaskType={usageByTaskType} />
      <TasksByRepo usageByRepo={usageByRepo} />
      <DailyUsage dailyUsage={dailyUsage} />
      <RecentJobRuns jobRuns={jobRuns} />
    </div>
  );
}

function TaskSummaryCards({
  taskSummary,
}: Pick<AnalyticsViewProps, "taskSummary">) {
  const cards = summaryCards(taskSummary);

  return (
    <>
      <h2>Task Summary</h2>
      <div className={styles.statsRow}>
        {cards.map(([label, value, tone]) => (
          <SummaryStatCard
            key={label}
            label={label}
            value={value}
            tone={tone}
          />
        ))}
      </div>
    </>
  );
}

function RetrievalLatency({
  latencyStats,
}: Pick<AnalyticsViewProps, "latencyStats">) {
  return (
    <DataTable
      title="Retrieval Performance (Last 7 Days)"
      columns={["Tool", "Calls", "p50", "p95", "p99", "Status"]}
      rows={latencyStats}
      rowKey={(r) => r.tool}
      monoColumns={[2, 3, 4]}
      empty="No latency data yet. Use search_memory, query_graph, or assemble_context to generate data."
      cells={latencyCells}
    />
  );
}

function UsageByTaskType({
  usageByTaskType,
}: Pick<AnalyticsViewProps, "usageByTaskType">) {
  return (
    <DataTable
      title="Usage by Task Type"
      columns={["Task Type", "Tasks", "Input Tokens", "Output Tokens"]}
      rows={usageByTaskType}
      rowKey={(r) => r.task_type}
      monoColumns={[2, 3]}
      cells={usageByTaskTypeCells}
    />
  );
}

function TasksByRepo({ usageByRepo }: Pick<AnalyticsViewProps, "usageByRepo">) {
  return (
    <DataTable
      title="Tasks by Repo"
      columns={["Repo", "Tasks"]}
      rows={usageByRepo}
      rowKey={(r) => r.target_repo}
      monoColumns={[0]}
      cells={(r) => [r.target_repo, Number(r.task_count).toLocaleString()]}
    />
  );
}

function DailyUsage({ dailyUsage }: Pick<AnalyticsViewProps, "dailyUsage">) {
  return (
    <DataTable
      title="Daily Usage (Last 14 Days)"
      columns={["Date", "LLM Calls", "Input Tokens", "Output Tokens"]}
      rows={dailyUsage}
      rowKey={(r) => r.day}
      monoColumns={[2, 3]}
      cells={(r) => [
        new Date(r.day).toLocaleDateString(),
        Number(r.calls).toLocaleString(),
        Number(r.input_tokens).toLocaleString(),
        Number(r.output_tokens).toLocaleString(),
      ]}
    />
  );
}

function RecentJobRuns({ jobRuns }: Pick<AnalyticsViewProps, "jobRuns">) {
  return (
    <DataTable
      title="Recent Job Runs"
      columns={["Job", "Started", "Duration", "Status", "Result", "Logs"]}
      rows={jobRuns}
      rowKey={(r) => r.id}
      monoColumns={[2]}
      empty="No job runs"
      cells={jobRunCells}
    />
  );
}

const EMPTY_TASK_SUMMARY: TaskSummary = {
  total: 0,
  succeeded: 0,
  failed: 0,
  active: 0,
};

function summaryCards(
  taskSummary: TaskSummary | null,
): [string, number, string | undefined][] {
  const summary = taskSummary ?? EMPTY_TASK_SUMMARY;

  return [
    ["Total Tasks", summary.total, undefined],
    ["Succeeded", summary.succeeded, styles.statValueSuccess],
    ["Failed", summary.failed, styles.statValueDanger],
    ["Active", summary.active, styles.statValueWarning],
  ];
}

interface SummaryStatCardProps {
  label: string;
  value: number;
  tone: string | undefined;
}

function SummaryStatCard({ label, value, tone }: SummaryStatCardProps) {
  return (
    <div className={`spec-card ${styles.statCard}`}>
      <div className="meta">{label}</div>
      <div className={tone ? `${styles.statValue} ${tone}` : styles.statValue}>
        {Number(value).toLocaleString()}
      </div>
    </div>
  );
}

/** One tool's latency percentiles, with a verdict on p95. */
function latencyCells(row: AnalyticsViewProps["latencyStats"][number]) {
  return [
    <span className="badge" key="tool">
      {row.tool}
    </span>,
    Number(row.call_count).toLocaleString(),
    `${Number(row.p50_ms).toFixed(0)}ms`,
    `${Number(row.p95_ms).toFixed(0)}ms`,
    `${Number(row.p99_ms).toFixed(0)}ms`,
    <LatencyVerdict p95Ms={Number(row.p95_ms)} key="status" />,
  ];
}

/** Whether this tool is inside the retrieval budget. 200ms is the line: past it, context assembly is what the developer is waiting on rather than something they would not notice. */
function LatencyVerdict({ p95Ms }: { p95Ms: number }) {
  if (p95Ms > 200) {
    return <span className="op-badge op-delete">&gt;200ms</span>;
  }

  return <span className="op-badge op-write">OK</span>;
}

function usageByTaskTypeCells(
  row: AnalyticsViewProps["usageByTaskType"][number],
) {
  return [
    <span className="badge" key="type">
      {row.task_type}
    </span>,
    Number(row.task_count).toLocaleString(),
    Number(row.total_input_tokens).toLocaleString(),
    Number(row.total_output_tokens).toLocaleString(),
  ];
}

/** One job run as a row. */
function jobRunCells(run: AnalyticsViewProps["jobRuns"][number]) {
  return [
    <span className="badge" key="job">
      {run.job_name}
    </span>,
    <span className="meta" key="started">
      {new Date(run.started_at).toLocaleString()}
    </span>,
    formatDuration(run.started_at, run.completed_at),
    <span className={`op-badge op-${run.status}`} key="status">
      {run.status}
    </span>,
    <RunResult run={run} key="result" />,
    <LogsLink run={run} key="logs" />,
  ];
}

function formatDuration(started: string, completed: string | null): string {
  if (!completed) {
    return "—";
  }
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  const seconds = Math.floor(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);

  return `${minutes}m`;
}

/** The error REPLACES the summary rather than sitting beside it: a run that failed has no result worth reading, and the reason is what the reader came for. */
function RunResult({ run }: { run: AnalyticsViewProps["jobRuns"][number] }) {
  if (run.error) {
    return <span className={styles.error}>{run.error}</span>;
  }

  return <>{run.result_summary ?? "—"}</>;
}

/** The run's logs, when it kept any. A run with no log path has nothing to open, so the cell says so rather than linking to an empty page. */
function LogsLink({ run }: { run: AnalyticsViewProps["jobRuns"][number] }) {
  if (!run.log_path) {
    return <span className="meta">—</span>;
  }

  return <a href={`/job-runs/${run.id}`}>view</a>;
}
