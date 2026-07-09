import Link from 'next/link';
import { TimeAgo } from '@/components/TimeAgo';
import styles from './PoolsView.module.css';

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
      <p className="meta" style={{ marginBottom: 16 }}>
        Namespaces where multiple agents contribute shared facts. Created programmatically via the shared-memory MCP tools.
      </p>
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
              <td><TimeAgo date={p.created_at} /></td>
            </tr>
          ))}
          {pools.length === 0 && (
            <tr><td colSpan={5} className={styles.emptyCell}>No shared pools yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
