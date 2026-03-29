export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import Link from 'next/link';

interface Task {
  id: string;
  description: string;
  task_type: string;
  status: string;
  target_repo: string;
  agent_id: string | null;
  pr_url: string | null;
  created_by: string;
  created_at: string;
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;

  const where = status ? 'WHERE status = $1' : '';
  const params = status ? [status] : [];
  const tasks = await query<Task>(
    `SELECT id, description, task_type, status, target_repo, agent_id, pr_url, created_by, created_at
     FROM pipeline.tasks ${where}
     ORDER BY created_at DESC LIMIT 50`,
    params
  );

  const statuses = ['pending', 'queued', 'running', 'pr-created', 'review', 'merged', 'failed', 'cancelled'];

  return (
    <div>
      <meta httpEquiv="refresh" content="10" />
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

      <table>
        <thead>
          <tr><th>Task</th><th>Type</th><th>Status</th><th>Repo</th><th>Agent</th><th>PR</th><th>Created</th></tr>
        </thead>
        <tbody>
          {tasks.map(t => (
            <tr key={t.id}>
              <td><Link href={`/pipeline/${t.id}`}>{t.description.substring(0, 60)}...</Link></td>
              <td><span className="badge">{t.task_type}</span></td>
              <td><span className={`op-badge op-${t.status}`}>{t.status}</span></td>
              <td style={{fontFamily:'monospace', fontSize:'12px'}}>
                {t.target_repo ? (
                  <Link href={`/repos/${t.target_repo}`}>{t.target_repo}</Link>
                ) : '—'}
              </td>
              <td>{t.agent_id ? t.agent_id.substring(0, 12) + '...' : '—'}</td>
              <td>{t.pr_url ? <a href={t.pr_url} target="_blank">PR</a> : '—'}</td>
              <td className="meta">{new Date(t.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {tasks.length === 0 && <tr><td colSpan={7} className="meta" style={{textAlign:'center'}}>No tasks</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
