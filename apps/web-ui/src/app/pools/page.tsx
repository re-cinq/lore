export const dynamic = "force-dynamic";
import { listPools } from "@/lib/api/memory";
import PoolsView, { PoolRow } from "./PoolsView";

export default async function PoolsPage() {
  const result = await listPools();
  const pools = (result.status === "ok"
    ? result.data.pools
    : []) as unknown as PoolRow[];

  return <PoolsView pools={pools} />;
}
