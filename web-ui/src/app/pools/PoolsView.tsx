import Link from 'next/link';

export interface PoolRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  entry_count: number;
  agent_count: number;
}

export interface PoolsViewProps {
  pools: PoolRow[];
}

export default function PoolsView({ pools }: PoolsViewProps) {
  return (
    <div>
      <h1>Shared Memory Pools</h1>
      <table>
        <thead>
          <tr><th>Pool Name</th><th>Entries</th><th>Contributing Agents</th><th>Created By</th><th>Created</th></tr>
        </thead>
        <tbody>
          {pools.map(p => (
            <tr key={p.id}>
              <td>
                <Link href={`/pools/${encodeURIComponent(p.name)}`}>
                  <strong>{p.name}</strong>
                </Link>
              </td>
              <td>{p.entry_count}</td>
              <td>{p.agent_count}</td>
              <td title={p.created_by}>{p.created_by.substring(0, 8)}...</td>
              <td>{new Date(p.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {pools.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No shared pools yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
