export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import HelpPopover from '@/components/HelpPopover';
import { formatCost, truncate, displayCreatedBy } from '@/lib/task-presenter';

export default async function RepoAgents({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // Find agents that have pipeline tasks targeting this repo.
  // cost_usd sums pipeline.llm_calls for this agent's tasks; created_by / reason
  // come from those tasks (an agent_id maps 1:1 to a task run in practice).
  const agents = await query(
    `SELECT t.agent_id,
            count(DISTINCT t.id)::int as task_count,
            COALESCE(SUM(lc.cost_usd), 0)::float as cost_usd,
            string_agg(DISTINCT t.created_by, ', ') as created_by,
            (array_agg(t.task_type ORDER BY t.created_at DESC))[1] as reason_type,
            (array_agg(t.description ORDER BY t.created_at DESC))[1] as reason,
            max(t.created_at) as last_active,
            (SELECT count(*)::int FROM memory.memories m WHERE m.agent_id = t.agent_id AND m.is_deleted = FALSE) as memory_count
     FROM pipeline.tasks t
     LEFT JOIN pipeline.llm_calls lc ON lc.task_id = t.id
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
            <li><strong>Created by</strong> and <strong>Why</strong> come from the task that spawned the agent.</li>
            <li><strong>Cost</strong> sums tracked <code>llm_calls</code> (Haiku helper calls); headless agent token spend is not metered, so this is a lower bound.</li>
          </ul>
        </HelpPopover>
      </div>
      <p className="meta" style={{marginTop:'6px', marginBottom:'16px'}}>
        Agents that have worked on this repo, with their task counts, memories, and last activity.
      </p>
      <table>
        <thead><tr><th>Agent</th><th>Created by</th><th>Why</th><th>Tasks</th><th>Cost</th><th>Memories</th><th>Last Active</th></tr></thead>
        <tbody>
          {agents.map((a: any) => (
            <tr key={a.agent_id}>
              <td><a href={`/agents/${encodeURIComponent(a.agent_id)}`}>{a.agent_id}</a></td>
              <td className="meta">{displayCreatedBy(a.created_by)}</td>
              <td>{a.reason_type && <span className="badge">{a.reason_type}</span>} <span className="meta">{truncate(a.reason, 50)}</span></td>
              <td>{a.task_count}</td>
              <td>{formatCost(a.cost_usd)}</td>
              <td>{a.memory_count}</td>
              <td className="meta">{new Date(a.last_active).toLocaleString()}</td>
            </tr>
          ))}
          {agents.length === 0 && <tr><td colSpan={7} className="meta" style={{textAlign:'center'}}>No agents have worked on this repo yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
