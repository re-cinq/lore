export const dynamic = "force-dynamic";
import { query } from '@/lib/db';
import PoolsView, { PoolRow } from './PoolsView';

export default async function PoolsPage() {
  const pools = await query<PoolRow>(`
    SELECT sp.id, sp.name, sp.created_by, sp.created_at,
           count(m.id)::int as entry_count,
           count(DISTINCT m.agent_id)::int as agent_count
    FROM memory.shared_pools sp
    LEFT JOIN memory.memories m ON m.pool_id = sp.id AND m.is_deleted = FALSE
    GROUP BY sp.id
    ORDER BY sp.created_at DESC
  `);

  return <PoolsView pools={pools} />;
}
