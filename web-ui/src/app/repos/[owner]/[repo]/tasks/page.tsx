export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import Link from 'next/link';
import HelpPopover from '@/components/HelpPopover';
import { formatCost, shortAgentId, truncate, displayCreatedBy } from '@/lib/task-presenter';

export default async function RepoTasks({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const tasks = await query(
    `SELECT t.id, t.description, t.task_type, t.status, t.agent_id, t.pr_url, t.created_at, t.created_by,
            COALESCE(SUM(lc.cost_usd), 0)::float as cost_usd
     FROM pipeline.tasks t
     LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
     WHERE t.target_repo = $1
     GROUP BY t.id
     ORDER BY t.created_at DESC LIMIT 50`,
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
        <thead><tr><th>Why (task)</th><th>Type</th><th>Status</th><th>Created by</th><th>Cost</th><th>Agent</th><th>PR</th><th>Created</th></tr></thead>
        <tbody>
          {tasks.map((t: any) => (
            <tr key={t.id}>
              <td><Link href={`/pipeline/${t.id}`}>{truncate(t.description, 50)}</Link></td>
              <td><span className="badge">{t.task_type}</span></td>
              <td><span className={`op-badge op-${t.status}`}>{t.status}</span></td>
              <td className="meta">{displayCreatedBy(t.created_by)}</td>
              <td>{formatCost(t.cost_usd)}</td>
              <td className="meta">{shortAgentId(t.agent_id)}</td>
              <td>{t.pr_url ? <a href={t.pr_url} target="_blank">PR</a> : '—'}</td>
              <td className="meta">{new Date(t.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {tasks.length === 0 && <tr><td colSpan={8} className="meta" style={{textAlign:'center'}}>No tasks for this repo</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
