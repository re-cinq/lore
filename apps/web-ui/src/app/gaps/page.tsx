export const dynamic = "force-dynamic";

import { query } from "@/lib/db";
import { getMemoryAudit } from "@/lib/api/activity";
import GapsView, {
  type ZeroResultSearchRow,
  type GapMemoryRow,
} from "./GapsView";

export default async function GapsPage() {
  const searches = await getMemoryAudit({
    operation: "search",
    zeroResults: true,
    limit: 20,
  });
  const zeroResultSearches: ZeroResultSearchRow[] =
    searches.status === "ok"
      ? (searches.data.entries as unknown as ZeroResultSearchRow[])
      : [];

  const gapMemories = await query<GapMemoryRow>(`
    SELECT key, value, created_at
    FROM memory.memories
    WHERE agent_id = 'klaus-gap-detection'
      AND is_deleted = FALSE
    ORDER BY created_at DESC
    LIMIT 10
  `);

  return (
    <GapsView
      gapMemories={gapMemories}
      zeroResultSearches={zeroResultSearches}
    />
  );
}
