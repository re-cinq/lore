export const dynamic = "force-dynamic";
import Link from 'next/link';
import { query } from '@/lib/db';

const PAGE_SIZE = 50;

interface AuditEntry {
  id: string;
  agent_id: string;
  operation: string;
  memory_key: string | null;
  pool_name: string | null;
  metadata: any;
  created_at: string;
}

interface CountResult {
  count: number;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ agent?: string; op?: string; offset?: string }> }) {
  const { agent, op, offset: offsetStr } = await searchParams;
  const offset = Math.max(0, parseInt(offsetStr || '0', 10) || 0);

  // Build WHERE conditions with proper NULL handling
  const conditions: string[] = [];
  const params: (string | null)[] = [];
  let paramIndex = 1;

  if (agent && agent.trim()) {
    conditions.push(`agent_id = $${paramIndex}`);
    params.push(agent.trim());
    paramIndex++;
  }

  if (op && op.trim()) {
    conditions.push(`operation = $${paramIndex}`);
    params.push(op.trim());
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count for pagination
  const [{ count: totalCount }] = await query<CountResult>(`
    SELECT count(*)::int as count FROM memory.audit_log ${whereClause}
  `, params);

  // Fetch page of entries
  const entries = await query<AuditEntry>(`
    SELECT id, agent_id, operation, memory_key, pool_name, metadata, created_at
    FROM memory.audit_log
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `, params);

  const operations = ['write', 'read', 'search', 'delete', 'snapshot', 'restore', 'shared_write', 'shared_read', 'list'];

  // Build pagination URLs preserving filters
  function buildUrl(newOffset: number): string {
    const p = new URLSearchParams();
    if (agent) p.set('agent', agent);
    if (op) p.set('op', op);
    if (newOffset > 0) p.set('offset', String(newOffset));
    const qs = p.toString();
    return `/audit${qs ? `?${qs}` : ''}`;
  }

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < totalCount;

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
      <p className="meta" style={{ marginBottom: 12 }}>{totalCount} total entries</p>
      <table>
        <thead>
          <tr><th>Time</th><th>Agent</th><th>Operation</th><th>Key</th><th>Pool</th><th>Details</th></tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id}>
              <td>{new Date(e.created_at).toLocaleString()}</td>
              <td title={e.agent_id}>{e.agent_id.substring(0, 8)}...</td>
              <td><span className={`op-badge op-${e.operation}`}>{e.operation}</span></td>
              <td>{e.memory_key || '\u2014'}</td>
              <td>{e.pool_name || '\u2014'}</td>
              <td>{e.metadata ? JSON.stringify(e.metadata).substring(0, 50) : '\u2014'}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#666', padding: 24 }}>No audit entries found</td></tr>
          )}
        </tbody>
      </table>
      <div className="pagination">
        <Link href={buildUrl(offset - PAGE_SIZE)} className={hasPrev ? '' : 'disabled'}>
          &larr; Previous
        </Link>
        <span className="page-info">
          {offset + 1}&ndash;{Math.min(offset + PAGE_SIZE, totalCount)} of {totalCount}
        </span>
        <Link href={buildUrl(offset + PAGE_SIZE)} className={hasNext ? '' : 'disabled'}>
          Next &rarr;
        </Link>
      </div>
    </div>
  );
}
