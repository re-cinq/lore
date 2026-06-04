export interface TaskSummary {
  total: number;
  succeeded: number;
  failed: number;
  active: number;
}

export interface LatencyStats {
  tool: string;
  call_count: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
}

export interface UsageByTaskType {
  task_type: string;
  task_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export interface UsageByRepo {
  target_repo: string;
  task_count: number;
}

export interface DailyUsage {
  day: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

export interface JobRun {
  id: string;
  job_name: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  result_summary: string | null;
  error: string | null;
  log_path: string | null;
}

export interface AnalyticsViewProps {
  taskSummary: TaskSummary | null;
  latencyStats: LatencyStats[];
  usageByTaskType: UsageByTaskType[];
  usageByRepo: UsageByRepo[];
  dailyUsage: DailyUsage[];
  jobRuns: JobRun[];
}

function formatDuration(started: string, completed: string | null): string {
  if (!completed) return '—';
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m`;
}

/**
 * Presentational view for the analytics dashboard. Pure render — the
 * container (`page.tsx`) runs all the SQL and passes resolved row arrays;
 * this component only renders the stat cards and tables.
 */
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
            <th>Logs</th>
          </tr>
        </thead>
        <tbody>
          {jobRuns.map((r) => (
            <tr key={r.id}>
              <td><span className="badge">{r.job_name}</span></td>
              <td className="meta">{new Date(r.started_at).toLocaleString()}</td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>{formatDuration(r.started_at, r.completed_at)}</td>
              <td><span className={`op-badge op-${r.status}`}>{r.status}</span></td>
              <td style={{fontSize:'var(--fs-sm)'}}>{r.error ? <span style={{color:'var(--danger)'}}>{r.error}</span> : (r.result_summary ?? '—')}</td>
              <td style={{fontSize:'var(--fs-sm)'}}>
                {r.log_path ? <a href={`/job-runs/${r.id}`}>view</a> : <span className="meta">—</span>}
              </td>
            </tr>
          ))}
          {jobRuns.length === 0 && <tr><td colSpan={6} className="meta" style={{textAlign:'center'}}>No job runs</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
