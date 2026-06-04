import Link from 'next/link';
import PRStatusBadge from './PRStatusBadge';

export interface PipelineTaskRow {
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
}

export interface PipelineListViewProps {
  /** The active status filter, or undefined for "All". */
  activeStatus?: string;
  tasks: PipelineTaskRow[];
}

const STATUSES = ['pending', 'queued', 'running', 'pr-created', 'review', 'merged', 'failed', 'cancelled'];

/**
 * Presentational view for the global pipeline task list. Pure render — the
 * container (`page.tsx`) runs the query and passes the resolved view-model
 * down. Read-only data down: the inline forms are plain HTML POSTs to API
 * routes, not React server actions, so no callbacks are threaded through.
 */
export default function PipelineListView({ activeStatus, tasks }: PipelineListViewProps) {
  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h1>Pipeline</h1>
        <Link href="/pipeline/create"><button>+ Create Task</button></Link>
      </div>

      <div className="filter-form">
        <a href="/pipeline" className={!activeStatus ? 'active' : ''}>All</a>
        {STATUSES.map(s => (
          <a key={s} href={`/pipeline?status=${s}`} className={activeStatus === s ? 'active' : ''}>{s}</a>
        ))}
      </div>

      <table>
        <thead>
          <tr><th>Task</th><th>Type</th><th>Status</th><th>Priority</th><th>Repo</th><th>Agent</th><th>PR</th><th>Created</th></tr>
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
                    <button type="submit" style={{background:'var(--accent)',color:'var(--text-on-accent)',border:'none',padding:'2px 10px',borderRadius:'var(--radius-sm)',cursor:'pointer',fontSize:'var(--fs-xs)'}}>
                      Run Now
                    </button>
                  </form>
                ) : (
                  <span className={t.priority === 'immediate' ? 'badge badge-red' : 'meta'}>{t.priority}</span>
                )}
              </td>
              <td style={{fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)'}}>
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
          {tasks.length === 0 && <tr><td colSpan={8} className="meta" style={{textAlign:'center'}}>No tasks</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
