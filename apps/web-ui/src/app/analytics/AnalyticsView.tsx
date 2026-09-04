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
  const cards: [string, number, string | undefined][] = [
    ["Total Tasks", taskSummary?.total ?? 0, undefined],
    ["Succeeded", taskSummary?.succeeded ?? 0, styles.statValueSuccess],
    ["Failed", taskSummary?.failed ?? 0, styles.statValueDanger],
    ["Active", taskSummary?.active ?? 0, styles.statValueWarning],
  ];

  return (
    <>
      <h2>Task Summary</h2>
      <div className={styles.statsRow}>
        {cards.map(([label, value, tone]) => (
          <div className={`spec-card ${styles.statCard}`} key={label}>
            <div className="meta">{label}</div>
            <div
              className={
                tone ? `${styles.statValue} ${tone}` : styles.statValue
              }
            >
              {Number(value).toLocaleString()}
            </div>
          </div>
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
      cells={(r) => [
        <span className="badge" key="tool">
          {r.tool}
        </span>,
        Number(r.call_count).toLocaleString(),
        `${Number(r.p50_ms).toFixed(0)}ms`,
        `${Number(r.p95_ms).toFixed(0)}ms`,
        `${Number(r.p99_ms).toFixed(0)}ms`,
        // 200ms is the retrieval budget: past it, context assembly is what the developer is waiting on.
        Number(r.p95_ms) > 200 ? (
          <span className="op-badge op-delete" key="status">
            &gt;200ms
          </span>
        ) : (
          <span className="op-badge op-write" key="status">
            OK
          </span>
        ),
      ]}
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
      cells={(r) => [
        <span className="badge" key="type">
          {r.task_type}
        </span>,
        Number(r.task_count).toLocaleString(),
        Number(r.total_input_tokens).toLocaleString(),
        Number(r.total_output_tokens).toLocaleString(),
      ]}
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
      cells={(r) => [
        <span className="badge" key="job">
          {r.job_name}
        </span>,
        <span className="meta" key="started">
          {new Date(r.started_at).toLocaleString()}
        </span>,
        formatDuration(r.started_at, r.completed_at),
        <span className={`op-badge op-${r.status}`} key="status">
          {r.status}
        </span>,
        r.error ? (
          <span className={styles.error} key="result">
            {r.error}
          </span>
        ) : (
          (r.result_summary ?? "—")
        ),
        r.log_path ? (
          <a href={`/job-runs/${r.id}`} key="logs">
            view
          </a>
        ) : (
          <span className="meta" key="logs">
            —
          </span>
        ),
      ]}
    />
  );
}
