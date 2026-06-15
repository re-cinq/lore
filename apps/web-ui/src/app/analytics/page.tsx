export const dynamic = "force-dynamic";
import { query, queryOne } from '@/lib/db';
import AnalyticsView, {
  type TaskSummary,
  type LatencyStats,
  type UsageByTaskType,
  type UsageByRepo,
  type DailyUsage,
  type JobRun,
} from './AnalyticsView';

export default async function AnalyticsPage() {
  const taskSummary = await queryOne<TaskSummary>(
    `SELECT
      count(*) as total,
      count(*) FILTER (WHERE status = 'pr-created' OR status = 'merged') as succeeded,
      count(*) FILTER (WHERE status = 'failed') as failed,
      count(*) FILTER (WHERE status = 'pending' OR status = 'queued' OR status = 'running') as active
    FROM pipeline.tasks`
  );

  const usageByTaskType = await query<UsageByTaskType>(
    `SELECT
      t.task_type,
      count(DISTINCT t.id) as task_count,
      COALESCE(SUM(lc.input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(lc.output_tokens), 0) as total_output_tokens
    FROM pipeline.tasks t
    LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
    GROUP BY t.task_type
    ORDER BY task_count DESC`
  );

  const usageByRepo = await query<UsageByRepo>(
    `SELECT
      t.target_repo,
      count(DISTINCT t.id) as task_count
    FROM pipeline.tasks t
    WHERE t.target_repo IS NOT NULL
    GROUP BY t.target_repo
    ORDER BY task_count DESC`
  );

  const dailyUsage = await query<DailyUsage>(
    `SELECT
      date_trunc('day', lc.created_at)::date as day,
      count(*) as calls,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens
    FROM pipeline.llm_calls lc
    WHERE lc.created_at > current_date - interval '14 days'
    GROUP BY 1
    ORDER BY 1 DESC`
  );

  const latencyStats = await query<LatencyStats>(
    `SELECT
      operation as tool,
      count(*)::int as call_count,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::numeric) as p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::numeric) as p95_ms,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY (metadata->>'latency_ms')::numeric) as p99_ms
    FROM memory.audit_log
    WHERE metadata->>'latency_ms' IS NOT NULL
      AND created_at > now() - interval '7 days'
    GROUP BY operation
    ORDER BY call_count DESC`
  );

  const jobRuns = await query<JobRun>(
    `SELECT id, job_name, started_at, completed_at, status, result_summary, error, log_path
    FROM pipeline.job_runs
    ORDER BY started_at DESC
    LIMIT 20`
  );

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
