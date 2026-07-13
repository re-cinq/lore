export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import PoolDetailView, { PoolEntryRow } from "./PoolDetailView";

interface PoolInfo {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

export default async function PoolDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const poolName = decodeURIComponent(name);

  // Fetch pool metadata
  const pools = await query<PoolInfo>(
    `
    SELECT id, name, created_by, created_at
    FROM memory.shared_pools
    WHERE name = $1
  `,
    [poolName],
  );

  if (pools.length === 0) {
    return (
      <PoolDetailView
        poolName={poolName}
        found={false}
        createdBy=""
        createdAt=""
        entries={[]}
      />
    );
  }

  const pool = pools[0];

  // Fetch all entries in this pool
  const entries = await query<PoolEntryRow>(
    `
    SELECT m.id, m.key, m.value, m.agent_id, m.version, m.created_at
    FROM memory.memories m
    WHERE m.pool_id = $1
      AND m.is_deleted = FALSE
      AND (m.expires_at IS NULL OR m.expires_at > now())
    ORDER BY m.created_at DESC
  `,
    [pool.id],
  );

  return (
    <PoolDetailView
      poolName={poolName}
      found={true}
      createdBy={pool.created_by}
      createdAt={pool.created_at}
      entries={entries}
    />
  );
}
