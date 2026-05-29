export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import Link from 'next/link';
import HelpPopover from '@/components/HelpPopover';

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
        <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
          <h2 style={{margin:0}}>Tasks</h2>
          <HelpPopover label="How tasks work">
            <p>Tasks are units of work you delegate to Lore agents for this repo.</p>
            <ul>
              <li>Each runs the pipeline: pull repo context → agent works → deterministic validation (lint/typecheck) → branch + PR (and a GitHub issue).</li>
              <li>Simple types run via direct API calls; <strong>implementation</strong> and <strong>review</strong> run in ephemeral Job pods.</li>
              <li>Which types are allowed is gated by the repo&apos;s <strong>trust level</strong> (see Settings).</li>
            </ul>
          </HelpPopover>
        </div>
        <Link href={`/repos/${owner}/${repo}/tasks/create`}><button>+ New Task</button></Link>
      </div>
      <p className="meta" style={{marginTop:'-4px', marginBottom:'16px'}}>
        Pipeline tasks targeting this repo. Delegate work to agents and track their status, PRs, and history.
      </p>
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
