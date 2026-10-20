import styles from "./AnalyticsView.module.css";
import DataTable from "@/components/DataTable";
import { InsightsCard } from "@/components/insights/InsightsCard";
import { UsageHeader } from "./UsageHeader";
import { DailyCallsChart, TaskSummaryTiles } from "./ActivitySummary";
import { RetrievalLatency } from "./LatencyRows";
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

// Pure render — page.tsx reads lore-api and passes resolved row arrays.
export default function AnalyticsView(props: AnalyticsViewProps) {
  return (
    <div>
      <UsageHeader active="activity" />
      <TaskSummaryTiles summary={props.taskSummary} />
      <DailyCallsChart dailyUsage={props.dailyUsage} />
      <RetrievalLatency latencyStats={props.latencyStats} />
      <div className={styles.pair}>
        <UsageByTaskType usageByTaskType={props.usageByTaskType} />
        <TasksByRepo usageByRepo={props.usageByRepo} />
      </div>
      <DailyUsage dailyUsage={props.dailyUsage} />
      <RecentJobRuns jobRuns={props.jobRuns} />
    </div>
  );
}

function UsageByTaskType({
  usageByTaskType,
}: Pick<AnalyticsViewProps, "usageByTaskType">) {
  return (
    <InsightsCard title="Usage by Task Type" flush>
      <DataTable
        columns={["Task Type", "Tasks", "Input Tokens", "Output Tokens"]}
        rows={usageByTaskType}
        rowKey={(r) => r.task_type}
        monoColumns={[2, 3]}
        cells={usageByTaskTypeCells}
      />
    </InsightsCard>
  );
}

function TasksByRepo({ usageByRepo }: Pick<AnalyticsViewProps, "usageByRepo">) {
  return (
    <InsightsCard title="Tasks by Repo" flush>
      <DataTable
        columns={["Repo", "Tasks"]}
        rows={usageByRepo}
        rowKey={(r) => r.target_repo}
        monoColumns={[0]}
        cells={(r) => [r.target_repo, Number(r.task_count).toLocaleString()]}
      />
    </InsightsCard>
  );
}

function DailyUsage({ dailyUsage }: Pick<AnalyticsViewProps, "dailyUsage">) {
  return (
    <InsightsCard title="Daily Usage (Last 14 Days)" flush>
      <DataTable
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
    </InsightsCard>
  );
}

function RecentJobRuns({ jobRuns }: Pick<AnalyticsViewProps, "jobRuns">) {
  return (
    <InsightsCard title="Recent Job Runs" flush>
      <DataTable
        columns={["Job", "Started", "Duration", "Status", "Result", "Logs"]}
        rows={jobRuns}
        rowKey={(r) => r.id}
        monoColumns={[2]}
        empty="No job runs"
        cells={jobRunCells}
      />
    </InsightsCard>
  );
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
