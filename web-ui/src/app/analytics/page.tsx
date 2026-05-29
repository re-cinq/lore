export const dynamic = "force-dynamic";
import { query, queryOne } from '@/lib/db';

interface TaskSummary {
  total: number;
  succeeded: number;
  failed: number;
  active: number;
}

interface LatencyStats {
  tool: string;
  call_count: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
}

interface UsageByTaskType {
  task_type: string;
  task_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

interface UsageByRepo {
  target_repo: string;
  task_count: number;
}

interface DailyUsage {
  day: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

interface JobRun {
  job_name: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  result_summary: string | null;
  error: string | null;
}

function formatDuration(started: string, completed: string | null): string {
  if (!completed) return '—';
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m`;
}

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
    `SELECT job_name, started_at, completed_at, status, result_summary, error
    FROM pipeline.job_runs
    ORDER BY started_at DESC
    LIMIT 20`
  );

  return (
    <div>
      <h1>Analytics</h1>

      {/* Task Summary */}
      <h2>Task Summary</h2>
      <div style={{display:'flex', gap:'16px', marginBottom:'24px', flexWrap:'wrap'}}>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">Total Tasks</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:'bold'}}>{Number(taskSummary?.total ?? 0).toLocaleString()}</div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">Succeeded</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:'bold', color:'var(--success)'}}>{Number(taskSummary?.succeeded ?? 0).toLocaleString()}</div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">Failed</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:'bold', color:'var(--danger)'}}>{Number(taskSummary?.failed ?? 0).toLocaleString()}</div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">Active</div>
          <div style={{fontSize:'var(--fs-xl)', fontWeight:'bold', color:'var(--warning)'}}>{Number(taskSummary?.active ?? 0).toLocaleString()}</div>
        </div>
      </div>

      {/* Retrieval Performance */}
      <h2>Retrieval Performance (Last 7 Days)</h2>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Calls</th>
            <th>p50</th>
            <th>p95</th>
            <th>p99</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {latencyStats.map(r => (
            <tr key={r.tool}>
              <td><span className="badge">{r.tool}</span></td>
              <td>{Number(r.call_count).toLocaleString()}</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{Number(r.p50_ms).toFixed(0)}ms</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{Number(r.p95_ms).toFixed(0)}ms</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{Number(r.p99_ms).toFixed(0)}ms</td>
              <td>{Number(r.p95_ms) > 200
                ? <span className="op-badge op-delete">&gt;200ms</span>
                : <span className="op-badge op-write">OK</span>
              }</td>
            </tr>
          ))}
          {latencyStats.length === 0 && <tr><td colSpan={6} className="meta" style={{textAlign:'center'}}>No latency data yet. Use search_memory, query_graph, or assemble_context to generate data.</td></tr>}
        </tbody>
      </table>

      {/* Usage by Task Type */}
      <h2>Usage by Task Type</h2>
      <table>
        <thead>
          <tr>
            <th>Task Type</th>
            <th>Tasks</th>
            <th>Input Tokens</th>
            <th>Output Tokens</th>
          </tr>
        </thead>
        <tbody>
          {usageByTaskType.map(r => (
            <tr key={r.task_type}>
              <td><span className="badge">{r.task_type}</span></td>
              <td>{Number(r.task_count).toLocaleString()}</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{Number(r.total_input_tokens).toLocaleString()}</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{Number(r.total_output_tokens).toLocaleString()}</td>
            </tr>
          ))}
          {usageByTaskType.length === 0 && <tr><td colSpan={4} className="meta" style={{textAlign:'center'}}>No data</td></tr>}
        </tbody>
      </table>

      {/* Tasks by Repo */}
      <h2>Tasks by Repo</h2>
      <table>
        <thead>
          <tr>
            <th>Repo</th>
            <th>Tasks</th>
          </tr>
        </thead>
        <tbody>
          {usageByRepo.map(r => (
            <tr key={r.target_repo}>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{r.target_repo}</td>
              <td>{Number(r.task_count).toLocaleString()}</td>
            </tr>
          ))}
          {usageByRepo.length === 0 && <tr><td colSpan={2} className="meta" style={{textAlign:'center'}}>No data</td></tr>}
        </tbody>
      </table>

      {/* Daily Usage (last 14 days) */}
      <h2>Daily Usage (Last 14 Days)</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>LLM Calls</th>
            <th>Input Tokens</th>
            <th>Output Tokens</th>
          </tr>
        </thead>
        <tbody>
          {dailyUsage.map(r => (
            <tr key={r.day}>
              <td>{new Date(r.day).toLocaleDateString()}</td>
              <td>{Number(r.calls).toLocaleString()}</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{Number(r.input_tokens).toLocaleString()}</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{Number(r.output_tokens).toLocaleString()}</td>
            </tr>
          ))}
          {dailyUsage.length === 0 && <tr><td colSpan={4} className="meta" style={{textAlign:'center'}}>No data</td></tr>}
        </tbody>
      </table>

      {/* Recent Job Runs */}
      <h2>Recent Job Runs</h2>
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {jobRuns.map((r, i) => (
            <tr key={i}>
              <td><span className="badge">{r.job_name}</span></td>
              <td className="meta">{new Date(r.started_at).toLocaleString()}</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{formatDuration(r.started_at, r.completed_at)}</td>
              <td><span className={`op-badge op-${r.status}`}>{r.status}</span></td>
              <td style={{fontSize:'var(--fs-sm)'}}>{r.error ? <span style={{color:'var(--danger)'}}>{r.error}</span> : (r.result_summary ?? '—')}</td>
            </tr>
          ))}
          {jobRuns.length === 0 && <tr><td colSpan={5} className="meta" style={{textAlign:'center'}}>No job runs</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
