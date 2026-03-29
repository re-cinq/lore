export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import Link from 'next/link';

export default async function RepoTasks({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const tasks = await query(
    `SELECT id, description, task_type, status, agent_id, pr_url, created_at
     FROM pipeline.tasks WHERE target_repo = $1 ORDER BY created_at DESC LIMIT 50`,
    [fullName]
  );

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h2>Tasks</h2>
        <Link href={`/repos/${owner}/${repo}/tasks/create`}><button>+ New Task</button></Link>
      </div>
      <table>
        <thead><tr><th>Task</th><th>Type</th><th>Status</th><th>Agent</th><th>PR</th><th>Created</th></tr></thead>
        <tbody>
          {tasks.map((t: any) => (
            <tr key={t.id}>
              <td><Link href={`/pipeline/${t.id}`}>{t.description.substring(0, 50)}...</Link></td>
              <td><span className="badge">{t.task_type}</span></td>
              <td><span className={`op-badge op-${t.status}`}>{t.status}</span></td>
              <td className="meta">{t.agent_id ? t.agent_id.substring(0, 12) + '...' : '—'}</td>
              <td>{t.pr_url ? <a href={t.pr_url} target="_blank">PR</a> : '—'}</td>
              <td className="meta">{new Date(t.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {tasks.length === 0 && <tr><td colSpan={6} className="meta" style={{textAlign:'center'}}>No tasks for this repo</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
