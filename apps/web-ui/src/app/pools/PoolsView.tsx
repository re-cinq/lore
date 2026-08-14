import Link from "next/link";
import { TimeAgo } from "@/components/TimeAgo";
import { EmptyState } from "@/components/EmptyState";
import { displayAgentId } from "@/lib/agent-id";

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
      <p className="meta page-lede">
        Namespaces where multiple agents contribute shared facts. Created
        programmatically via the shared-memory MCP tools.
      </p>
      <table>
        <thead>
          <tr>
            <th>Pool Name</th>
            <th>Entries</th>
            <th>Contributing Agents</th>
            <th>Created By</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {pools.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/pools/${encodeURIComponent(p.name)}`}>
                  <strong>{p.name}</strong>
                </Link>
              </td>
              <td>{p.entry_count}</td>
              <td>{p.agent_count}</td>
              <td title={p.created_by}>{displayAgentId(p.created_by)}</td>
              <td>
                <TimeAgo date={p.created_at} />
              </td>
            </tr>
          ))}
          {pools.length === 0 && (
            <tr>
              <td colSpan={5}>
                <EmptyState
                  title="No shared pools yet"
                  description="Pools are created programmatically by agents via the shared-memory MCP tools."
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
