export const dynamic = "force-dynamic";
import { query } from '@/lib/db';

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
      <h2>Agents</h2>
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
