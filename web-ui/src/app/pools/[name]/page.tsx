export const dynamic = "force-dynamic";
import Link from 'next/link';
import { query } from '@/lib/db';

interface PoolEntry {
  id: string;
  key: string;
  value: string;
  agent_id: string;
  version: number;
  created_at: string;
}

interface PoolInfo {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

export default async function PoolDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const poolName = decodeURIComponent(name);

  // Fetch pool metadata
  const pools = await query<PoolInfo>(`
    SELECT id, name, created_by, created_at
    FROM memory.shared_pools
    WHERE name = $1
  `, [poolName]);

  if (pools.length === 0) {
    return (
      <div>
        <div className="breadcrumb">
          <Link href="/pools">Pools</Link> / {poolName}
        </div>
        <h1>Pool Not Found</h1>
        <div className="empty-state">
          <p>No pool named &quot;{poolName}&quot; exists.</p>
        </div>
      </div>
    );
  }

  const pool = pools[0];

  // Fetch all entries in this pool
  const entries = await query<PoolEntry>(`
    SELECT m.id, m.key, m.value, m.agent_id, m.version, m.created_at
    FROM memory.memories m
    WHERE m.pool_id = $1
      AND m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
    ORDER BY m.created_at DESC
  `, [pool.id]);

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/pools">Pools</Link> / <strong>{poolName}</strong>
      </div>
      <h1>{poolName}</h1>
      <p className="meta" style={{ marginBottom: 16 }}>
        Created by {pool.created_by.substring(0, 12)}... on {new Date(pool.created_at).toLocaleString()} · {entries.length} entr{entries.length !== 1 ? 'ies' : 'y'}
      </p>
      <table>
        <thead>
          <tr><th>Key</th><th>Value</th><th>Agent</th><th>Version</th><th>Created</th></tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id}>
              <td><strong>{e.key}</strong></td>
              <td style={{ maxWidth: 400 }}>
                <pre style={{ margin: 0, background: 'transparent', border: 'none', padding: 0, fontSize: 12 }}>
                  {e.value.length > 200 ? e.value.substring(0, 200) + '...' : e.value}
                </pre>
              </td>
              <td title={e.agent_id}>{e.agent_id.substring(0, 8)}...</td>
              <td>v{e.version}</td>
              <td>{new Date(e.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: '#666', padding: 24 }}>No entries in this pool</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
