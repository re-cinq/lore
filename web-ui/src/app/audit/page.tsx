export const dynamic = "force-dynamic";
import { query } from '@/lib/db';

interface AuditEntry {
  id: string;
  agent_id: string;
  operation: string;
  memory_key: string | null;
  pool_name: string | null;
  metadata: any;
  created_at: string;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ agent?: string; op?: string }> }) {
  const { agent, op } = await searchParams;

  const entries = await query<AuditEntry>(`
    SELECT id, agent_id, operation, memory_key, pool_name, metadata, created_at
    FROM memory.audit_log
    WHERE ($1::text IS NULL OR agent_id = $1)
      AND ($2::text IS NULL OR operation = $2)
    ORDER BY created_at DESC
    LIMIT 100
  `, [agent || null, op || null]);

  const operations = ['write', 'read', 'search', 'delete', 'snapshot', 'restore', 'shared_write', 'shared_read', 'list'];

  return (
    <div>
      <h1>Audit Trail</h1>
      <form method="get" className="filter-form">
        <input type="text" name="agent" defaultValue={agent || ''} placeholder="Filter by agent ID..." />
        <select name="op" defaultValue={op || ''}>
          <option value="">All operations</option>
          {operations.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <button type="submit">Filter</button>
      </form>
      <table>
        <thead>
          <tr><th>Time</th><th>Agent</th><th>Operation</th><th>Key</th><th>Pool</th><th>Details</th></tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id}>
              <td>{new Date(e.created_at).toLocaleString()}</td>
              <td>{e.agent_id.substring(0, 8)}...</td>
              <td><span className={`op-badge op-${e.operation}`}>{e.operation}</span></td>
              <td>{e.memory_key || '—'}</td>
              <td>{e.pool_name || '—'}</td>
              <td>{e.metadata ? JSON.stringify(e.metadata).substring(0, 50) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
