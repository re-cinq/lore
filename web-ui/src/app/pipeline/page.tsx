export const dynamic = "force-dynamic";
import { query, queryOne } from '@/lib/db';
import Link from 'next/link';
import PRStatusBadge from './PRStatusBadge';

interface Task {
  id: string;
  description: string;
  task_type: string;
  status: string;
  priority: string;
  target_repo: string;
  agent_id: string | null;
  pr_url: string | null;
  pr_number: number | null;
  created_by: string;
  created_at: string;
  llm_cost: number;
}

interface TodayCost {
  today: number;
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;

  const where = status ? 'WHERE t.status = $1' : '';
  const params = status ? [status] : [];
  const tasks = await query<Task>(
    `SELECT t.id, t.description, t.task_type, t.status, COALESCE(t.priority, 'normal') as priority, t.target_repo, t.agent_id, t.pr_url, t.pr_number, t.created_by, t.created_at,
            COALESCE(lc.total_cost, 0) as llm_cost
     FROM pipeline.tasks t
     LEFT JOIN (
       SELECT task_id, SUM(cost_usd) as total_cost
       FROM pipeline.llm_calls
       GROUP BY task_id
     ) lc ON lc.task_id = t.id
     ${where}
     ORDER BY t.created_at DESC LIMIT 50`,
    params
  );

  const todayCost = await queryOne<TodayCost>(
    `SELECT COALESCE(SUM(cost_usd), 0)::numeric(10,2) as today FROM pipeline.llm_calls WHERE created_at > current_date`
  );

  const statuses = ['pending', 'queued', 'running', 'pr-created', 'review', 'merged', 'failed', 'cancelled'];

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h1>Pipeline</h1>
        <Link href="/pipeline/create"><button>+ Create Task</button></Link>
      </div>

      <div className="filter-form">
        <a href="/pipeline" className={!status ? 'active' : ''}>All</a>
        {statuses.map(s => (
          <a key={s} href={`/pipeline?status=${s}`} className={status === s ? 'active' : ''}>{s}</a>
        ))}
      </div>

      <div className="spec-card" style={{marginBottom:'16px', display:'flex', alignItems:'center', gap:'16px'}}>
        <strong>Today&apos;s LLM Cost:</strong>
        <span className="badge" style={{fontSize:'14px'}}>${Number(todayCost?.today ?? 0).toFixed(2)}</span>
      </div>

      <table>
        <thead>
          <tr><th>Task</th><th>Type</th><th>Status</th><th>Priority</th><th>Cost</th><th>Repo</th><th>Agent</th><th>PR</th><th>Created</th></tr>
        </thead>
        <tbody>
          {tasks.map(t => (
            <tr key={t.id}>
              <td><Link href={`/pipeline/${t.id}`}>{t.description.substring(0, 60)}...</Link></td>
              <td><span className="badge">{t.task_type}</span></td>
              <td><span className={`op-badge op-${t.status}`}>{t.status}</span></td>
              <td>
                {t.status === 'pending' && t.priority === 'normal' ? (
                  <form action={`/api/pipeline/${t.id}/run-now`} method="POST" style={{display:'inline'}}>
                    <button type="submit" style={{background:'#7c3aed',color:'white',border:'none',padding:'2px 10px',borderRadius:'4px',cursor:'pointer',fontSize:'12px'}}>
                      Run Now
                    </button>
                  </form>
                ) : (
                  <span className={t.priority === 'immediate' ? 'badge' : 'meta'} style={t.priority === 'immediate' ? {background:'#7c3aed',color:'white'} : {}}>{t.priority}</span>
                )}
              </td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>${Number(t.llm_cost).toFixed(2)}</td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>
                {t.target_repo ? (
                  <Link href={`/repos/${t.target_repo}`}>{t.target_repo}</Link>
                ) : '—'}
              </td>
              <td>{t.agent_id ? t.agent_id.substring(0, 12) + '...' : '—'}</td>
              <td>
                {t.pr_url ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <a href={t.pr_url} target="_blank">PR</a>
                    {t.pr_number && <PRStatusBadge taskId={t.id} />}
                  </span>
                ) : '—'}
              </td>
              <td className="meta">{new Date(t.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {tasks.length === 0 && <tr><td colSpan={9} className="meta" style={{textAlign:'center'}}>No tasks</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
