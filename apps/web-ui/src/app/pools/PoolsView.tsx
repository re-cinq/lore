import Link from "next/link";
import { TimeAgo } from "@/components/TimeAgo";
import { EmptyState } from "@/components/EmptyState";
import { displayAgentId } from "@/lib/agent-id";
import type { components } from "@/lib/api/schema";

/** One shared pool with its counts — the counts are aggregates, not columns. */
export type PoolRow = components["schemas"]["SharedPoolList"]["pools"][number];

export interface PoolsViewProps {
  pools: PoolRow[];
}

/** One pool. The creator's full agent id lives in the title attribute — the displayed form is shortened to keep the column readable, and the full id is what someone needs when tracking a pool back to its agent. */
function PoolRowCells({ pool }: { pool: PoolRow }) {
  return (
    <tr>
      <td>
        <Link href={`/pools/${encodeURIComponent(pool.name)}`}>
          <strong>{pool.name}</strong>
        </Link>
      </td>
      <td>{pool.entry_count}</td>
      <td>{pool.agent_count}</td>
      <td title={pool.created_by}>{displayAgentId(pool.created_by)}</td>
      <td>
        <TimeAgo date={pool.created_at} />
      </td>
    </tr>
  );
}

/** Nothing to show, and nothing for the reader to do about it: pools are created by agents through the MCP tools, not from this page. */
function EmptyPools() {
  return (
    <tr>
      <td colSpan={5}>
        <EmptyState
          title="No shared pools yet"
          description="Pools are created programmatically by agents via the shared-memory MCP tools."
        />
      </td>
    </tr>
  );
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
          {pools.map((pool) => (
            <PoolRowCells key={pool.id} pool={pool} />
          ))}
          {pools.length === 0 && <EmptyPools />}
        </tbody>
      </table>
    </div>
  );
}
