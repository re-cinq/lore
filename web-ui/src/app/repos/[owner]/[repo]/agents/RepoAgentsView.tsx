import HelpPopover from '@/components/HelpPopover';
import { formatCost, truncate, displayCreatedBy } from '@/lib/task-presenter';

export interface RepoAgentRow {
  agent_id: string;
  task_count: number;
  cost_usd: number;
  created_by: string | null;
  reason_type: string | null;
  reason: string | null;
  last_active: string;
  memory_count: number;
}

export interface RepoAgentsViewProps {
  agents: RepoAgentRow[];
}

/**
 * Presentational view for the per-repo agents table. Pure render — the
 * container (`page.tsx`) runs the query and this component only renders the
 * rows. Read-only: no server actions, no callbacks (pure data down).
 */
export default function RepoAgentsView({ agents }: RepoAgentsViewProps) {
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
          {agents.map((a) => (
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
