export const dynamic = "force-dynamic";
import { query, queryOne } from '@/lib/db';

interface CostOverview {
  cost: number;
}

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

interface CostByTaskType {
  task_type: string;
  task_count: number;
  total_cost: number;
  avg_cost_per_call: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

interface CostByRepo {
  target_repo: string;
  task_count: number;
  total_cost: number;
}

interface DailyCost {
  day: string;
  calls: number;
  cost: number;
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
  const [todayCost, weekCost, monthCost, allTimeCost] = await Promise.all([
    queryOne<CostOverview>(
      `SELECT COALESCE(SUM(cost_usd), 0)::numeric(10,2) as cost FROM pipeline.llm_calls WHERE created_at > current_date`
    ),
    queryOne<CostOverview>(
      `SELECT COALESCE(SUM(cost_usd), 0)::numeric(10,2) as cost FROM pipeline.llm_calls WHERE created_at > date_trunc('week', current_date)`
    ),
    queryOne<CostOverview>(
      `SELECT COALESCE(SUM(cost_usd), 0)::numeric(10,2) as cost FROM pipeline.llm_calls WHERE created_at > date_trunc('month', current_date)`
    ),
    queryOne<CostOverview>(
      `SELECT COALESCE(SUM(cost_usd), 0)::numeric(10,2) as cost FROM pipeline.llm_calls`
    ),
  ]);

  const taskSummary = await queryOne<TaskSummary>(
    `SELECT
      count(*) as total,
      count(*) FILTER (WHERE status = 'pr-created' OR status = 'merged') as succeeded,
      count(*) FILTER (WHERE status = 'failed') as failed,
      count(*) FILTER (WHERE status = 'pending' OR status = 'queued' OR status = 'running') as active
    FROM pipeline.tasks`
  );

  const costByTaskType = await query<CostByTaskType>(
    `SELECT
      t.task_type,
      count(DISTINCT t.id) as task_count,
      COALESCE(SUM(lc.cost_usd), 0)::numeric(10,2) as total_cost,
      COALESCE(AVG(lc.cost_usd), 0)::numeric(10,4) as avg_cost_per_call,
      COALESCE(SUM(lc.input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(lc.output_tokens), 0) as total_output_tokens
    FROM pipeline.tasks t
    LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
    GROUP BY t.task_type
    ORDER BY total_cost DESC`
  );

  const costByRepo = await query<CostByRepo>(
    `SELECT
      t.target_repo,
      count(DISTINCT t.id) as task_count,
      COALESCE(SUM(lc.cost_usd), 0)::numeric(10,2) as total_cost
    FROM pipeline.tasks t
    LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
    WHERE t.target_repo IS NOT NULL
    GROUP BY t.target_repo
    ORDER BY total_cost DESC`
  );

  const dailyCost = await query<DailyCost>(
    `SELECT
      date_trunc('day', lc.created_at)::date as day,
      count(*) as calls,
      SUM(cost_usd)::numeric(10,2) as cost,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens
    FROM pipeline.llm_calls lc
    WHERE lc.created_at > current_date - interval '14 days'
    GROUP BY 1
    ORDER BY 1 DESC`
  );

  // Retrieval latency stats from audit_log (last 7 days)
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

      {/* Cost Overview */}
      <h2>Cost Overview</h2>
      <div style={{display:'flex', gap:'16px', marginBottom:'24px', flexWrap:'wrap'}}>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">Today</div>
          <div style={{fontSize:'24px', fontFamily:'monospace', fontWeight:'bold'}}>${Number(todayCost?.cost ?? 0).toFixed(2)}</div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">This Week</div>
          <div style={{fontSize:'24px', fontFamily:'monospace', fontWeight:'bold'}}>${Number(weekCost?.cost ?? 0).toFixed(2)}</div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">This Month</div>
          <div style={{fontSize:'24px', fontFamily:'monospace', fontWeight:'bold'}}>${Number(monthCost?.cost ?? 0).toFixed(2)}</div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">All Time</div>
          <div style={{fontSize:'24px', fontFamily:'monospace', fontWeight:'bold'}}>${Number(allTimeCost?.cost ?? 0).toFixed(2)}</div>
        </div>
      </div>

      {/* Task Summary */}
      <h2>Task Summary</h2>
      <div style={{display:'flex', gap:'16px', marginBottom:'24px', flexWrap:'wrap'}}>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">Total Tasks</div>
          <div style={{fontSize:'24px', fontWeight:'bold'}}>{Number(taskSummary?.total ?? 0).toLocaleString()}</div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">Succeeded</div>
          <div style={{fontSize:'24px', fontWeight:'bold', color:'var(--success, #22c55e)'}}>{Number(taskSummary?.succeeded ?? 0).toLocaleString()}</div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">Failed</div>
          <div style={{fontSize:'24px', fontWeight:'bold', color:'var(--danger, #ef4444)'}}>{Number(taskSummary?.failed ?? 0).toLocaleString()}</div>
        </div>
        <div className="spec-card" style={{flex:1, minWidth:'150px'}}>
          <div className="meta">Active</div>
          <div style={{fontSize:'24px', fontWeight:'bold', color:'var(--warning, #f59e0b)'}}>{Number(taskSummary?.active ?? 0).toLocaleString()}</div>
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
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>{Number(r.p50_ms).toFixed(0)}ms</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>{Number(r.p95_ms).toFixed(0)}ms</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>{Number(r.p99_ms).toFixed(0)}ms</td>
              <td>{Number(r.p95_ms) > 200
                ? <span className="op-badge op-delete">&gt;200ms</span>
                : <span className="op-badge op-write">OK</span>
              }</td>
            </tr>
          ))}
          {latencyStats.length === 0 && <tr><td colSpan={6} className="meta" style={{textAlign:'center'}}>No latency data yet. Use search_memory, query_graph, or assemble_context to generate data.</td></tr>}
        </tbody>
      </table>

      {/* Cost by Task Type */}
      <h2>Cost by Task Type</h2>
      <table>
        <thead>
          <tr>
            <th>Task Type</th>
            <th>Tasks</th>
            <th>Total Cost</th>
            <th>Avg Cost/Call</th>
            <th>Input Tokens</th>
            <th>Output Tokens</th>
          </tr>
        </thead>
        <tbody>
          {costByTaskType.map(r => (
            <tr key={r.task_type}>
              <td><span className="badge">{r.task_type}</span></td>
              <td>{Number(r.task_count).toLocaleString()}</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>${Number(r.total_cost).toFixed(2)}</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>${Number(r.avg_cost_per_call).toFixed(4)}</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>{Number(r.total_input_tokens).toLocaleString()}</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>{Number(r.total_output_tokens).toLocaleString()}</td>
            </tr>
          ))}
          {costByTaskType.length === 0 && <tr><td colSpan={6} className="meta" style={{textAlign:'center'}}>No data</td></tr>}
        </tbody>
      </table>

      {/* Cost by Repo */}
      <h2>Cost by Repo</h2>
      <table>
        <thead>
          <tr>
            <th>Repo</th>
            <th>Tasks</th>
            <th>Total Cost</th>
          </tr>
        </thead>
        <tbody>
          {costByRepo.map(r => (
            <tr key={r.target_repo}>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>{r.target_repo}</td>
              <td>{Number(r.task_count).toLocaleString()}</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>${Number(r.total_cost).toFixed(2)}</td>
            </tr>
          ))}
          {costByRepo.length === 0 && <tr><td colSpan={3} className="meta" style={{textAlign:'center'}}>No data</td></tr>}
        </tbody>
      </table>

      {/* Daily Cost (last 14 days) */}
      <h2>Daily Cost (Last 14 Days)</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>LLM Calls</th>
            <th>Cost</th>
            <th>Input Tokens</th>
            <th>Output Tokens</th>
          </tr>
        </thead>
        <tbody>
          {dailyCost.map(r => (
            <tr key={r.day}>
              <td>{new Date(r.day).toLocaleDateString()}</td>
              <td>{Number(r.calls).toLocaleString()}</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>${Number(r.cost).toFixed(2)}</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>{Number(r.input_tokens).toLocaleString()}</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>{Number(r.output_tokens).toLocaleString()}</td>
            </tr>
          ))}
          {dailyCost.length === 0 && <tr><td colSpan={5} className="meta" style={{textAlign:'center'}}>No data</td></tr>}
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
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>{formatDuration(r.started_at, r.completed_at)}</td>
              <td><span className={`op-badge op-${r.status}`}>{r.status}</span></td>
              <td style={{fontSize:'12px'}}>{r.error ? <span style={{color:'var(--danger, #ef4444)'}}>{r.error}</span> : (r.result_summary ?? '—')}</td>
            </tr>
          ))}
          {jobRuns.length === 0 && <tr><td colSpan={5} className="meta" style={{textAlign:'center'}}>No job runs</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
