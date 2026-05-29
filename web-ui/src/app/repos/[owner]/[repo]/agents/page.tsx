export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import HelpPopover from '@/components/HelpPopover';

export default async function RepoAgents({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // Find agents that have pipeline tasks targeting this repo
  const agents = await query(
    `SELECT DISTINCT t.agent_id, count(*)::int as task_count,
            max(t.created_at) as last_active,
            (SELECT count(*)::int FROM memory.memories m WHERE m.agent_id = t.agent_id AND m.is_deleted = FALSE) as memory_count
     FROM pipeline.tasks t
     WHERE t.target_repo = $1 AND t.agent_id IS NOT NULL
     GROUP BY t.agent_id
     ORDER BY max(t.created_at) DESC`,
    [fullName]
  );

  return (
    <div>
      <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
        <h2 style={{margin:0}}>Agents</h2>
        <HelpPopover label="What agents are">
          <p>Agents are the workers that process this repo&apos;s pipeline tasks — on the cluster (GKE Job pods or direct API calls) or via the local runner.</p>
          <ul>
            <li>Each agent accumulates <strong>memory</strong> and <strong>facts</strong> from its work.</li>
            <li>Those feed back into future tasks via <code>search_memory</code> and assembled context.</li>
            <li>Listed below are the agents that have run tasks against this repo.</li>
          </ul>
        </HelpPopover>
      </div>
      <p className="meta" style={{marginTop:'6px', marginBottom:'16px'}}>
        Agents that have worked on this repo, with their task counts, memories, and last activity.
      </p>
      <table>
        <thead><tr><th>Agent</th><th>Tasks</th><th>Memories</th><th>Last Active</th></tr></thead>
        <tbody>
          {agents.map((a: any) => (
            <tr key={a.agent_id}>
              <td><a href={`/agents/${encodeURIComponent(a.agent_id)}`}>{a.agent_id}</a></td>
              <td>{a.task_count}</td>
              <td>{a.memory_count}</td>
              <td className="meta">{new Date(a.last_active).toLocaleString()}</td>
            </tr>
          ))}
          {agents.length === 0 && <tr><td colSpan={4} className="meta" style={{textAlign:'center'}}>No agents have worked on this repo yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
