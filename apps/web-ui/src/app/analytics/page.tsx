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
  const overview = await readOverview();

  return (
    <AnalyticsView
      taskSummary={overview.task_summary as TaskSummary | null}
      latencyStats={overview.latency_stats as unknown as LatencyStats[]}
      usageByTaskType={
        overview.usage_by_task_type as unknown as UsageByTaskType[]
      }
      usageByRepo={overview.usage_by_repo as unknown as UsageByRepo[]}
      dailyUsage={overview.daily_usage as unknown as DailyUsage[]}
      jobRuns={overview.job_runs as unknown as JobRun[]}
    />
  );
}

/** Every analytics slice, or an empty one of each. An unreachable lore-api renders the page with empty tables rather than an error: each table carries its own "no data yet" text, which is the same thing the reader would see on a fresh install. */
async function readOverview() {
  const result = await getAnalyticsOverview();

  return result.status === "ok"
    ? result.data
    : {
        task_summary: null,
        usage_by_task_type: [],
        usage_by_repo: [],
        daily_usage: [],
        latency_stats: [],
        job_runs: [],
      };
}
