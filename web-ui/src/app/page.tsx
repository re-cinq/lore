export const dynamic = "force-dynamic";
import { query } from '@/lib/db';

interface Agent {
  agent_id: string;
  memory_count: number;
  last_active: string;
  snapshot_count: number;
}

export default async function AgentsPage() {
  const agents = await query<Agent>(`
    SELECT m.agent_id,
           count(*)::int as memory_count,
           max(m.created_at) as last_active,
           (SELECT count(*)::int FROM memory.snapshots s WHERE s.agent_id = m.agent_id) as snapshot_count
    FROM memory.memories m
    WHERE m.is_deleted = FALSE
    GROUP BY m.agent_id
    ORDER BY max(m.created_at) DESC
  `);

  return (
    <div>
      <h1>Agents</h1>
      <table>
        <thead>
          <tr>
            <th>Agent ID</th>
            <th>Memories</th>
            <th>Snapshots</th>
            <th>Last Active</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(a => (
            <tr key={a.agent_id}>
              <td><a href={`/agents/${encodeURIComponent(a.agent_id)}`}>{a.agent_id.substring(0, 12)}...</a></td>
              <td>{a.memory_count}</td>
              <td>{a.snapshot_count}</td>
              <td>{new Date(a.last_active).toLocaleString()}</td>
            </tr>
          ))}
          {agents.length === 0 && (
            <tr><td colSpan={4} style={{textAlign: 'center', color: '#666'}}>No agents yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
