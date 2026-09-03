export const dynamic = "force-dynamic";
import { getAnalyticsOverview } from "@/lib/api/activity";
import AnalyticsView, {
  type TaskSummary,
  type LatencyStats,
  type UsageByTaskType,
  type UsageByRepo,
  type DailyUsage,
  type JobRun,
} from "./AnalyticsView";

export default async function AnalyticsPage() {
  const result = await getAnalyticsOverview();
  const overview =
    result.status === "ok"
      ? result.data
      : {
          task_summary: null,
          usage_by_task_type: [],
          usage_by_repo: [],
          daily_usage: [],
          latency_stats: [],
          job_runs: [],
        };
  const taskSummary = overview.task_summary as TaskSummary | null;
  const usageByTaskType =
    overview.usage_by_task_type as unknown as UsageByTaskType[];
  const usageByRepo = overview.usage_by_repo as unknown as UsageByRepo[];
  const dailyUsage = overview.daily_usage as unknown as DailyUsage[];
  const latencyStats = overview.latency_stats as unknown as LatencyStats[];
  const jobRuns = overview.job_runs as unknown as JobRun[];

  return (
    <AnalyticsView
      taskSummary={taskSummary}
      latencyStats={latencyStats}
      usageByTaskType={usageByTaskType}
      usageByRepo={usageByRepo}
      dailyUsage={dailyUsage}
      jobRuns={jobRuns}
    />
  );
}
