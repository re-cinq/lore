export const dynamic = "force-dynamic";
import { getPool } from "@/lib/api/memory";
import PoolDetailView, { PoolEntryRow } from "./PoolDetailView";
import type { components } from "@/lib/api/schema";

type PoolInfo = components["schemas"]["SharedPoolDetail"]["pool"];

/** The pool and its entries, or null. A pool that does not exist and one this deployment cannot reach are the same answer here: the view has a found={false} state that says so without a 404. */
async function readPool(poolName: string) {
  const result = await getPool(poolName);

  if (result.status !== "ok") {
    return null;
  }

  return {
    pool: result.data.pool as unknown as PoolInfo,
    entries: result.data.entries as unknown as PoolEntryRow[],
  };
}

interface PoolDetailPageProps {
  params: Promise<{ name: string }>;
}

export default async function PoolDetailPage({ params }: PoolDetailPageProps) {
  const { name } = await params;
  const poolName = decodeURIComponent(name);

  const found = await readPool(poolName);

  if (!found) {
    return <MissingPool poolName={poolName} />;
  }

  return (
    <PoolDetailView
      poolName={poolName}
      found={true}
      createdBy={found.pool.created_by}
      createdAt={found.pool.created_at}
      entries={found.entries}
    />
  );
}

function MissingPool({ poolName }: { poolName: string }) {
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
