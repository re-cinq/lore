export const dynamic = "force-dynamic";
import { getPool } from "@/lib/api/memory";
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

  const result = await getPool(poolName);

  if (result.status !== "ok") {
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
  const pool = result.data.pool as unknown as PoolInfo;
  const entries = result.data.entries as unknown as PoolEntryRow[];

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
